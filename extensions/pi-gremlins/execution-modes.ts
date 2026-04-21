import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { AgentConfig } from "./agents.js";
import {
	createPendingResult,
	getFinalOutput,
	getInvocationStatus,
	getSingleResultErrorText,
	getSingleResultStatus,
	type InvocationMode,
	type PiGremlinsDetails,
	type SingleResult,
} from "./execution-shared.js";

export type PiGremlinsToolResult = AgentToolResult<PiGremlinsDetails> & {
	isError?: boolean;
};

export interface TaskExecutionItem {
	agent: string;
	task: string;
	cwd?: string;
}

export interface ChainExecutionItem extends TaskExecutionItem {}

export type RunSingleAgentFn = (
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => PiGremlinsDetails,
) => Promise<SingleResult>;

export type OnUpdateCallback = (
	partial: AgentToolResult<PiGremlinsDetails>,
) => void;

interface ExecutionModeDependencies {
	toolCallId: string;
	ctxCwd: string;
	agents: AgentConfig[];
	signal: AbortSignal | undefined;
	runSingleAgent: RunSingleAgentFn;
	handleInvocationUpdate: OnUpdateCallback;
	makeDetails: (
		mode: InvocationMode,
	) => (results: SingleResult[]) => PiGremlinsDetails;
	updateInvocation: (
		toolCallId: string,
		details: PiGremlinsDetails,
		status: ReturnType<typeof getInvocationStatus>,
	) => void;
}

interface ChainExecutionDependencies extends ExecutionModeDependencies {
	chain: ChainExecutionItem[];
}

interface ParallelExecutionDependencies extends ExecutionModeDependencies {
	tasks: TaskExecutionItem[];
	maxConcurrency: number;
	mapWithConcurrencyLimit: <T, R>(
		items: T[],
		concurrency: number,
		mapper: (item: T, index: number) => Promise<R>,
	) => Promise<R[]>;
}

interface SingleExecutionDependencies extends ExecutionModeDependencies {
	agent: string;
	task: string;
	cwd?: string;
}

export async function executeChainMode({
	toolCallId,
	chain,
	ctxCwd,
	agents,
	signal,
	runSingleAgent,
	handleInvocationUpdate,
	makeDetails,
	updateInvocation,
}: ChainExecutionDependencies): Promise<PiGremlinsToolResult> {
	const results: SingleResult[] = [];
	let previousOutput = "";

	for (let i = 0; i < chain.length; i++) {
		const step = chain[i];
		const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

		const chainUpdate: OnUpdateCallback = (partial) => {
			const currentResult = partial.details?.results[0];
			if (!currentResult) return;
			const allResults = [...results, currentResult];
			handleInvocationUpdate({
				content: partial.content,
				details: makeDetails("chain")(allResults),
			});
		};

		handleInvocationUpdate({
			content: [{ type: "text", text: "(running...)" }],
			details: makeDetails("chain")([
				...results,
				createPendingResult(step.agent, taskWithContext, i + 1, "unknown"),
			]),
		});

		const result = await runSingleAgent(
			ctxCwd,
			agents,
			step.agent,
			taskWithContext,
			step.cwd,
			i + 1,
			signal,
			chainUpdate,
			makeDetails("chain"),
		);
		results.push(result);

		const resultStatus = getSingleResultStatus(result);
		if (resultStatus === "Failed" || resultStatus === "Canceled") {
			const details = makeDetails("chain")(results);
			updateInvocation(
				toolCallId,
				details,
				getInvocationStatus("chain", results),
			);
			if (resultStatus === "Canceled") {
				return {
					content: [
						{
							type: "text",
							text: `Chain canceled at step ${i + 1} (${step.agent}): ${getSingleResultErrorText(result)}`,
						},
					],
					details,
				};
			}
			return {
				content: [
					{
						type: "text",
						text: `Chain stopped at step ${i + 1} (${step.agent}): ${getSingleResultErrorText(result)}`,
					},
				],
				details,
				isError: true,
			};
		}
		previousOutput = getFinalOutput(result.messages, result.viewerEntries);
	}

	const details = makeDetails("chain")(results);
	const finalResult = results.at(-1);
	updateInvocation(toolCallId, details, getInvocationStatus("chain", results));
	return {
		content: [
			{
				type: "text",
				text:
					getFinalOutput(
						finalResult?.messages ?? [],
						finalResult?.viewerEntries ?? [],
					) || "(no output)",
			},
		],
		details,
	};
}

export async function executeParallelMode({
	toolCallId,
	tasks,
	ctxCwd,
	agents,
	signal,
	runSingleAgent,
	handleInvocationUpdate,
	makeDetails,
	updateInvocation,
	maxConcurrency,
	mapWithConcurrencyLimit,
}: ParallelExecutionDependencies): Promise<PiGremlinsToolResult> {
	const allResults: SingleResult[] = tasks.map((task) =>
		createPendingResult(task.agent, task.task, undefined, "unknown"),
	);
	const trackedExitCodes = allResults.map((result) => result.exitCode);
	let runningCount = allResults.length;
	let doneCount = 0;

	const replaceParallelResult = (index: number, nextResult: SingleResult) => {
		const previousExitCode = trackedExitCodes[index];
		if (previousExitCode === -1 && nextResult.exitCode !== -1) {
			runningCount -= 1;
			doneCount += 1;
		} else if (previousExitCode !== -1 && nextResult.exitCode === -1) {
			runningCount += 1;
			doneCount -= 1;
		}
		trackedExitCodes[index] = nextResult.exitCode;
		allResults[index] = nextResult;
	};

	const emitParallelUpdate = () => {
		handleInvocationUpdate({
			content: [
				{
					type: "text",
					text: `Parallel: ${doneCount}/${allResults.length} done, ${runningCount} running...`,
				},
			],
			details: makeDetails("parallel")([...allResults]),
		});
	};

	emitParallelUpdate();

	const results = await mapWithConcurrencyLimit(
		tasks,
		maxConcurrency,
		async (task, index) => {
			const result = await runSingleAgent(
				ctxCwd,
				agents,
				task.agent,
				task.task,
				task.cwd,
				undefined,
				signal,
				(partial) => {
					if (partial.details?.results[0]) {
						replaceParallelResult(index, partial.details.results[0]);
						emitParallelUpdate();
					}
				},
				makeDetails("parallel"),
			);
			replaceParallelResult(index, result);
			emitParallelUpdate();
			return result;
		},
	);

	const statuses = results.map((result) => getSingleResultStatus(result));
	const successCount = statuses.filter(
		(status) => status === "Completed",
	).length;
	const failedCount = statuses.filter((status) => status === "Failed").length;
	const canceledCount = statuses.filter(
		(status) => status === "Canceled",
	).length;
	const summaryParts = [`${successCount}/${results.length} succeeded`];
	if (failedCount > 0) summaryParts.push(`${failedCount} failed`);
	if (canceledCount > 0) summaryParts.push(`${canceledCount} canceled`);
	const summaries = results.map((result, index) => {
		const output = getFinalOutput(result.messages, result.viewerEntries);
		return `[${result.agent}] ${statuses[index].toLowerCase()}: ${output || "(no output)"}`;
	});
	const details = makeDetails("parallel")(results);
	updateInvocation(
		toolCallId,
		details,
		getInvocationStatus("parallel", results),
	);
	return {
		content: [
			{
				type: "text",
				text: `Parallel: ${summaryParts.join(", ")}\n\n${summaries.join("\n\n")}`,
			},
		],
		details,
	};
}

export async function executeSingleMode({
	toolCallId,
	agent,
	task,
	cwd,
	ctxCwd,
	agents,
	signal,
	runSingleAgent,
	handleInvocationUpdate,
	makeDetails,
	updateInvocation,
}: SingleExecutionDependencies): Promise<PiGremlinsToolResult> {
	const result = await runSingleAgent(
		ctxCwd,
		agents,
		agent,
		task,
		cwd,
		undefined,
		signal,
		handleInvocationUpdate,
		makeDetails("single"),
	);
	const details = makeDetails("single")([result]);
	updateInvocation(
		toolCallId,
		details,
		getInvocationStatus("single", [result]),
	);

	const resultStatus = getSingleResultStatus(result);
	if (resultStatus === "Failed") {
		return {
			content: [
				{
					type: "text",
					text: `Agent ${result.stopReason || "failed"}: ${getSingleResultErrorText(result)}`,
				},
			],
			details,
			isError: true,
		};
	}
	if (resultStatus === "Canceled") {
		return {
			content: [
				{
					type: "text",
					text: `Canceled: ${getSingleResultErrorText(result)}`,
				},
			],
			details,
		};
	}

	return {
		content: [
			{
				type: "text",
				text:
					getFinalOutput(result.messages, result.viewerEntries) ||
					"(no output)",
			},
		],
		details,
	};
}
