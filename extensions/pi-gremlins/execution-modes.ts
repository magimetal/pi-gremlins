import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { AgentConfig } from "./agents.js";
import {
	createPendingResult,
	getFinalOutput,
	getInvocationStatus,
	getSingleResultErrorText,
	type InvocationMode,
	isSingleResultError,
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

		if (isSingleResultError(result)) {
			const details = makeDetails("chain")(results);
			updateInvocation(
				toolCallId,
				details,
				getInvocationStatus("chain", results),
			);
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
		previousOutput = getFinalOutput(result.messages);
	}

	const details = makeDetails("chain")(results);
	updateInvocation(toolCallId, details, getInvocationStatus("chain", results));
	return {
		content: [
			{
				type: "text",
				text:
					getFinalOutput(results[results.length - 1]?.messages ?? []) ||
					"(no output)",
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

	const successCount = results.filter((result) => result.exitCode === 0).length;
	const summaries = results.map((result) => {
		const output = getFinalOutput(result.messages);
		return `[${result.agent}] ${result.exitCode === 0 ? "completed" : "failed"}: ${output || "(no output)"}`;
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
				text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
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

	if (isSingleResultError(result)) {
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

	return {
		content: [
			{
				type: "text",
				text: getFinalOutput(result.messages) || "(no output)",
			},
		],
		details,
	};
}
