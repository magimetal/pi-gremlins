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
	packageDiscoveryWarning?: string,
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
	packageDiscoveryWarning?: string;
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

const MAX_CHAIN_CARRY_FORWARD_CHARS = 8000;
const MAX_CHAIN_TASK_CHARS = 12000;
const CHAIN_CARRY_FORWARD_TRUNCATION_NOTE =
	"...[truncated by pi-gremlins chain handoff]";
const CHAIN_TASK_TRUNCATION_NOTE =
	"...[task truncated by pi-gremlins chain handoff]";

function clampTextWithNote(
	text: string,
	maxLength: number,
	note: string,
): { text: string; truncated: boolean } {
	if (text.length <= maxLength) {
		return { text, truncated: false };
	}
	const separator = text.includes("\n") ? "\n\n" : " ";
	const suffix = `${separator}${note}`;
	const sliceLength = Math.max(0, maxLength - suffix.length);
	return {
		text: `${text.slice(0, sliceLength).trimEnd()}${suffix}`,
		truncated: true,
	};
}

function applyPreviousOutputToChainTask(
	task: string,
	previousOutput: string,
): string {
	if (!task.includes("{previous}")) return task;
	const boundedCarryForward = clampTextWithNote(
		previousOutput,
		MAX_CHAIN_CARRY_FORWARD_CHARS,
		CHAIN_CARRY_FORWARD_TRUNCATION_NOTE,
	);
	const substitutedTask = task.replace(
		/\{previous\}/g,
		boundedCarryForward.text,
	);
	return clampTextWithNote(
		substitutedTask,
		MAX_CHAIN_TASK_CHARS,
		CHAIN_TASK_TRUNCATION_NOTE,
	).text;
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
	packageDiscoveryWarning,
}: ChainExecutionDependencies): Promise<PiGremlinsToolResult> {
	const results: SingleResult[] = [];
	let previousOutput = "";

	for (let i = 0; i < chain.length; i++) {
		const step = chain[i];
		const taskWithContext = applyPreviousOutputToChainTask(
			step.task,
			previousOutput,
		);

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
			packageDiscoveryWarning,
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
	packageDiscoveryWarning,
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
				packageDiscoveryWarning,
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
	packageDiscoveryWarning,
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
		packageDiscoveryWarning,
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
