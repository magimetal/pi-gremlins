import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { AgentConfig } from "./agents.js";
import {
	createPendingResult,
	getResultFinalOutput,
	getSingleResultErrorText,
	getSingleResultStatus,
	type InvocationMode,
	type InvocationStatus,
	isSingleResultTerminal,
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

export interface SteerableGremlinSession {
	steer: (message: string) => Promise<void>;
}

export interface SteerableSessionCallbacks {
	register: (gremlinId: string, session: SteerableGremlinSession) => void;
	unregister: (gremlinId: string) => void;
}

export type RunSingleAgentFn = (
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	gremlinId: string,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => PiGremlinsDetails,
	packageDiscoveryWarning?: string,
	steerableSessionCallbacks?: SteerableSessionCallbacks,
) => Promise<SingleResult>;

export type OnUpdateCallback = (
	partial: AgentToolResult<PiGremlinsDetails>,
) => void;

interface ExecutionModeDependencies {
	ctxCwd: string;
	agents: AgentConfig[];
	signal: AbortSignal | undefined;
	runSingleAgent: RunSingleAgentFn;
	handleInvocationUpdate: OnUpdateCallback;
	readInvocationStatus: () => InvocationStatus | undefined;
	publishInvocationDetails: (
		details: PiGremlinsDetails,
		status?: InvocationStatus,
	) => void;
	makeDetails: (
		mode: InvocationMode,
	) => (results: SingleResult[]) => PiGremlinsDetails;
	allocateGremlinId: () => string;
	packageDiscoveryWarning?: string;
	steerableSessionCallbacks?: SteerableSessionCallbacks;
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

interface SingleExecutionDependencies
	extends Omit<ExecutionModeDependencies, "allocateGremlinId"> {
	agent: string;
	task: string;
	cwd?: string;
	gremlinId: string;
}

const MAX_CHAIN_CARRY_FORWARD_CHARS = 8000;
const MAX_CHAIN_TASK_CHARS = 12000;
const CHAIN_CARRY_FORWARD_TRUNCATION_NOTE =
	"...[truncated by Gremlins🧌 chain handoff]";
const CHAIN_TASK_TRUNCATION_NOTE =
	"...[task truncated by Gremlins🧌 chain handoff]";

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

function emitTerminalOrSyncSnapshot(
	status: InvocationStatus,
	partial: AgentToolResult<PiGremlinsDetails>,
	handleInvocationUpdate: OnUpdateCallback,
	readInvocationStatus: () => InvocationStatus | undefined,
	publishInvocationDetails: (
		details: PiGremlinsDetails,
		status?: InvocationStatus,
	) => void,
): void {
	if (partial.details && readInvocationStatus() === status) {
		publishInvocationDetails(partial.details, status);
		return;
	}
	handleInvocationUpdate(partial);
}

export async function executeChainMode({
	chain,
	ctxCwd,
	agents,
	signal,
	runSingleAgent,
	handleInvocationUpdate,
	readInvocationStatus,
	publishInvocationDetails,
	makeDetails,
	allocateGremlinId,
	packageDiscoveryWarning,
	steerableSessionCallbacks,
}: ChainExecutionDependencies): Promise<PiGremlinsToolResult> {
	const chainRuns = chain.map((step, index) => ({
		...step,
		stepNumber: index + 1,
		gremlinId: allocateGremlinId(),
	}));
	const viewerResults: SingleResult[] = chainRuns.map((step) =>
		createPendingResult(
			step.agent,
			step.task,
			step.stepNumber,
			"unknown",
			step.gremlinId,
		),
	);
	const buildLiveChainDetails = (
		results: SingleResult[],
	): PiGremlinsDetails => ({
		...makeDetails("chain")(results),
		viewerResults,
	});
	const liveResults: SingleResult[] = [];
	const replaceLiveResult = (index: number, result: SingleResult) => {
		liveResults[index] = result;
		if (liveResults.length <= index) {
			liveResults.length = index + 1;
		}
	};
	const results: SingleResult[] = [];
	let previousOutput = "";

	for (let i = 0; i < chainRuns.length; i++) {
		const step = chainRuns[i];
		const taskWithContext = applyPreviousOutputToChainTask(
			step.task,
			previousOutput,
		);
		const pendingResult = createPendingResult(
			step.agent,
			taskWithContext,
			step.stepNumber,
			"unknown",
			step.gremlinId,
		);
		viewerResults[i] = pendingResult;

		const chainUpdate: OnUpdateCallback = (partial) => {
			const currentResult = partial.details?.results[0];
			if (!currentResult) return;
			viewerResults[i] = currentResult;
			replaceLiveResult(i, currentResult);
			handleInvocationUpdate({
				content: partial.content,
				details: buildLiveChainDetails(liveResults),
			});
		};

		replaceLiveResult(i, pendingResult);
		handleInvocationUpdate({
			content: [{ type: "text", text: "(running...)" }],
			details: buildLiveChainDetails(liveResults),
		});

		const result = await runSingleAgent(
			ctxCwd,
			agents,
			step.agent,
			taskWithContext,
			step.cwd,
			step.stepNumber,
			step.gremlinId,
			signal,
			chainUpdate,
			makeDetails("chain"),
			packageDiscoveryWarning,
			steerableSessionCallbacks,
		);
		results.push(result);
		viewerResults[i] = result;
		replaceLiveResult(i, result);

		const resultStatus = getSingleResultStatus(result);
		if (resultStatus === "Failed" || resultStatus === "Canceled") {
			const details = makeDetails("chain")(results);
			if (resultStatus === "Canceled") {
				const terminalPartial = {
					content: [
						{
							type: "text" as const,
							text: `Chain canceled at step ${step.stepNumber} (${step.agent}): ${getSingleResultErrorText(result)}`,
						},
					],
					details,
				};
				emitTerminalOrSyncSnapshot(
					resultStatus,
					terminalPartial,
					handleInvocationUpdate,
					readInvocationStatus,
					publishInvocationDetails,
				);
				return terminalPartial;
			}
			const terminalPartial = {
				content: [
					{
						type: "text" as const,
						text: `Chain stopped at step ${step.stepNumber} (${step.agent}): ${getSingleResultErrorText(result)}`,
					},
				],
				details,
			};
			emitTerminalOrSyncSnapshot(
				resultStatus,
				terminalPartial,
				handleInvocationUpdate,
				readInvocationStatus,
				publishInvocationDetails,
			);
			return {
				...terminalPartial,
				isError: true,
			};
		}
		previousOutput = getResultFinalOutput(result);
	}

	const details = makeDetails("chain")(results);
	const finalResult = results.at(-1);
	const terminalPartial = {
		content: [
			{
				type: "text" as const,
				text: finalResult
					? getResultFinalOutput(finalResult) || "(no output)"
					: "(no output)",
			},
		],
		details,
	};
	emitTerminalOrSyncSnapshot(
		"Completed",
		terminalPartial,
		handleInvocationUpdate,
		readInvocationStatus,
		publishInvocationDetails,
	);
	return terminalPartial;
}

export async function executeParallelMode({
	tasks,
	ctxCwd,
	agents,
	signal,
	runSingleAgent,
	handleInvocationUpdate,
	publishInvocationDetails,
	makeDetails,
	allocateGremlinId,
	maxConcurrency,
	mapWithConcurrencyLimit,
	packageDiscoveryWarning,
	steerableSessionCallbacks,
}: ParallelExecutionDependencies): Promise<PiGremlinsToolResult> {
	const taskRuns = tasks.map((task) => ({
		...task,
		gremlinId: allocateGremlinId(),
	}));
	const allResults: SingleResult[] = taskRuns.map((task) =>
		createPendingResult(
			task.agent,
			task.task,
			undefined,
			"unknown",
			task.gremlinId,
		),
	);
	const trackedTerminalStates = allResults.map((result) =>
		isSingleResultTerminal(result),
	);
	let runningCount = allResults.length;
	let doneCount = 0;

	const replaceParallelResult = (index: number, nextResult: SingleResult) => {
		const previousResult = allResults[index];
		const previousStatus = getSingleResultStatus(previousResult);
		const nextStatus = getSingleResultStatus(nextResult);
		const previousTerminal = trackedTerminalStates[index];
		const nextTerminal = isSingleResultTerminal(nextResult);
		if (!previousTerminal && nextTerminal) {
			runningCount -= 1;
			doneCount += 1;
		} else if (previousTerminal && !nextTerminal) {
			runningCount += 1;
			doneCount -= 1;
		}
		trackedTerminalStates[index] = nextTerminal;
		allResults[index] = nextResult;
		return previousStatus !== nextStatus;
	};

	const emitParallelUpdate = () => {
		handleInvocationUpdate({
			content: [
				{
					type: "text",
					text: `Parallel: ${doneCount}/${allResults.length} done, ${runningCount} running...`,
				},
			],
			details: makeDetails("parallel")(allResults),
		});
	};

	emitParallelUpdate();

	const results = await mapWithConcurrencyLimit(
		taskRuns,
		maxConcurrency,
		async (task, index) => {
			const result = await runSingleAgent(
				ctxCwd,
				agents,
				task.agent,
				task.task,
				task.cwd,
				undefined,
				task.gremlinId,
				signal,
				(partial) => {
					if (partial.details?.results[0]) {
						replaceParallelResult(index, partial.details.results[0]);
						emitParallelUpdate();
					}
				},
				makeDetails("parallel"),
				packageDiscoveryWarning,
				steerableSessionCallbacks,
			);
			const statusChanged = replaceParallelResult(index, result);
			if (statusChanged) {
				emitParallelUpdate();
			} else {
				publishInvocationDetails(makeDetails("parallel")(allResults));
			}
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
		const output = getResultFinalOutput(result);
		return `[${result.gremlinId} ${result.agent}] ${statuses[index].toLowerCase()}: ${output || "(no output)"}`;
	});
	const details = makeDetails("parallel")(results);
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
	agent,
	task,
	cwd,
	ctxCwd,
	agents,
	signal,
	runSingleAgent,
	handleInvocationUpdate,
	readInvocationStatus,
	publishInvocationDetails,
	makeDetails,
	packageDiscoveryWarning,
	gremlinId,
	steerableSessionCallbacks,
}: SingleExecutionDependencies): Promise<PiGremlinsToolResult> {
	const result = await runSingleAgent(
		ctxCwd,
		agents,
		agent,
		task,
		cwd,
		undefined,
		gremlinId,
		signal,
		handleInvocationUpdate,
		makeDetails("single"),
		packageDiscoveryWarning,
		steerableSessionCallbacks,
	);
	const details = makeDetails("single")([result]);
	const resultStatus = getSingleResultStatus(result);
	if (resultStatus === "Failed") {
		const terminalPartial = {
			content: [
				{
					type: "text" as const,
					text: `Agent ${result.stopReason || "failed"}: ${getSingleResultErrorText(result)}`,
				},
			],
			details,
		};
		emitTerminalOrSyncSnapshot(
			resultStatus,
			terminalPartial,
			handleInvocationUpdate,
			readInvocationStatus,
			publishInvocationDetails,
		);
		return {
			...terminalPartial,
			isError: true,
		};
	}
	if (resultStatus === "Canceled") {
		const terminalPartial = {
			content: [
				{
					type: "text" as const,
					text: `Canceled: ${getSingleResultErrorText(result)}`,
				},
			],
			details,
		};
		emitTerminalOrSyncSnapshot(
			resultStatus,
			terminalPartial,
			handleInvocationUpdate,
			readInvocationStatus,
			publishInvocationDetails,
		);
		return terminalPartial;
	}

	const terminalPartial = {
		content: [
			{
				type: "text" as const,
				text: getResultFinalOutput(result) || "(no output)",
			},
		],
		details,
	};
	emitTerminalOrSyncSnapshot(
		"Completed",
		terminalPartial,
		handleInvocationUpdate,
		readInvocationStatus,
		publishInvocationDetails,
	);
	return terminalPartial;
}
