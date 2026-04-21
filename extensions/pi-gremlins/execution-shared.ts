import type { Message } from "@mariozechner/pi-ai";
import type { AgentScope, AgentSource } from "./agents.js";

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export type InvocationMode = "single" | "parallel" | "chain";
export type InvocationStatus = "Running" | "Completed" | "Failed" | "Canceled";

export type ViewerEntry =
	| { type: "assistant-text"; text: string; streaming: boolean }
	| {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			args: Record<string, unknown>;
	  }
	| {
			type: "tool-result";
			toolCallId: string;
			toolName: string;
			content: string;
			streaming: boolean;
			truncated: boolean;
			isError: boolean;
	  };

export interface SingleResult {
	agent: string;
	agentSource: AgentSource | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	viewerEntries: ViewerEntry[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

export interface PiGremlinsDetails {
	mode: InvocationMode;
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

export interface ViewerToolCallRecord {
	callEntryIndex: number;
	resultEntryIndex?: number;
}

export interface SingleRunViewerState {
	currentAssistantEntryIndex: number | null;
	toolCalls: Map<string, ViewerToolCallRecord>;
}

export type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> };

export interface DerivedRenderData {
	revision: number;
	finalOutput: string;
	displayItems: DisplayItem[];
}

const RESULT_VISIBLE_REVISION = Symbol("pi-gremlins.resultVisibleRevision");
const RESULT_DERIVED_REVISION = Symbol("pi-gremlins.resultDerivedRevision");
const RESULT_DERIVED_CACHE = Symbol("pi-gremlins.resultDerivedCache");
const INVOCATION_SNAPSHOT_REVISION = Symbol(
	"pi-gremlins.invocationSnapshotRevision",
);

interface InternalSingleResult extends SingleResult {
	[RESULT_VISIBLE_REVISION]?: number;
	[RESULT_DERIVED_REVISION]?: number;
	[RESULT_DERIVED_CACHE]?: DerivedRenderData;
}

interface InternalDetails extends PiGremlinsDetails {
	[INVOCATION_SNAPSHOT_REVISION]?: number;
}

function getInternalResult(result: SingleResult): InternalSingleResult {
	return result as InternalSingleResult;
}

function getInternalDetails(details: PiGremlinsDetails): InternalDetails {
	return details as InternalDetails;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function buildDerivedRenderData(
	messages: Message[],
): Omit<DerivedRenderData, "revision"> {
	const displayItems: DisplayItem[] = [];
	let finalOutput = "";

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		for (let j = 0; j < msg.content.length; j++) {
			const part = msg.content[j];
			if (part.type === "text") {
				displayItems.push({ type: "text", text: part.text });
				finalOutput = part.text;
				continue;
			}
			if (part.type === "toolCall") {
				displayItems.push({
					type: "toolCall",
					name: part.name,
					args: part.arguments,
				});
			}
		}
	}

	return { finalOutput, displayItems };
}

export function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns)
		parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

export function getFinalOutput(messages: Message[]): string {
	return buildDerivedRenderData(messages).finalOutput;
}

export function getDerivedRenderData(result: SingleResult): DerivedRenderData {
	const revision = getResultDerivedRevision(result);
	const internal = getInternalResult(result);
	const cached = internal[RESULT_DERIVED_CACHE];
	if (cached && cached.revision === revision) return cached;
	const derived = buildDerivedRenderData(result.messages);
	const nextCache: DerivedRenderData = {
		revision,
		...derived,
	};
	internal[RESULT_DERIVED_CACHE] = nextCache;
	return nextCache;
}

function clearResultDerivedCache(result: SingleResult): void {
	delete getInternalResult(result)[RESULT_DERIVED_CACHE];
}

export function getResultVisibleRevision(result: SingleResult): number {
	return getInternalResult(result)[RESULT_VISIBLE_REVISION] ?? 0;
}

export function getResultDerivedRevision(result: SingleResult): number {
	return getInternalResult(result)[RESULT_DERIVED_REVISION] ?? 0;
}

export function setResultVisibleRevision(
	result: SingleResult,
	revision: number,
): void {
	getInternalResult(result)[RESULT_VISIBLE_REVISION] = revision;
}

export function setResultDerivedRevision(
	result: SingleResult,
	revision: number,
): void {
	getInternalResult(result)[RESULT_DERIVED_REVISION] = revision;
}

export function initializeResultRevisions(
	result: SingleResult,
	{
		visibleRevision = getResultVisibleRevision(result),
		derivedRevision = getResultDerivedRevision(result),
	}: {
		visibleRevision?: number;
		derivedRevision?: number;
	} = {},
): SingleResult {
	setResultVisibleRevision(result, visibleRevision);
	setResultDerivedRevision(result, derivedRevision);
	return result;
}

export function bumpResultVisibleRevision(result: SingleResult): number {
	const nextRevision = getResultVisibleRevision(result) + 1;
	setResultVisibleRevision(result, nextRevision);
	return nextRevision;
}

export function bumpResultDerivedRevision(result: SingleResult): number {
	const nextRevision = getResultDerivedRevision(result) + 1;
	setResultDerivedRevision(result, nextRevision);
	bumpResultVisibleRevision(result);
	clearResultDerivedCache(result);
	return nextRevision;
}

export function getInvocationSnapshotRevision(
	details: PiGremlinsDetails,
): number {
	return getInternalDetails(details)[INVOCATION_SNAPSHOT_REVISION] ?? 0;
}

export function setInvocationSnapshotRevision(
	details: PiGremlinsDetails,
	revision: number,
): void {
	getInternalDetails(details)[INVOCATION_SNAPSHOT_REVISION] = revision;
}

function tryCopyDerivedCache(
	source: SingleResult | undefined,
	target: SingleResult,
): void {
	if (!source) return;
	if (getResultDerivedRevision(source) !== getResultDerivedRevision(target))
		return;
	const cached = getInternalResult(source)[RESULT_DERIVED_CACHE];
	if (!cached) return;
	getInternalResult(target)[RESULT_DERIVED_CACHE] = cached;
}

function cloneSingleResult(result: SingleResult): SingleResult {
	const cloned: SingleResult = {
		...result,
		messages: structuredClone(result.messages),
		viewerEntries: structuredClone(result.viewerEntries),
		usage: { ...result.usage },
	};
	initializeResultRevisions(cloned, {
		visibleRevision: getResultVisibleRevision(result),
		derivedRevision: getResultDerivedRevision(result),
	});
	tryCopyDerivedCache(result, cloned);
	return cloned;
}

export function cloneSingleResultForSnapshot(
	result: SingleResult,
	previousResult?: SingleResult,
): SingleResult {
	const cloned = cloneSingleResult(result);
	tryCopyDerivedCache(previousResult, cloned);
	return cloned;
}

export function createUsageStats(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
}

export function createSingleViewerState(): SingleRunViewerState {
	return {
		currentAssistantEntryIndex: null,
		toolCalls: new Map(),
	};
}

export function createPendingResult(
	agent: string,
	task: string,
	step?: number,
	agentSource: AgentSource | "unknown" = "unknown",
): SingleResult {
	return initializeResultRevisions({
		agent,
		agentSource,
		task,
		exitCode: -1,
		messages: [],
		viewerEntries: [],
		stderr: "",
		usage: createUsageStats(),
		step,
	});
}

export function getSingleResultStatus(result: SingleResult): InvocationStatus {
	if (result.exitCode === -1) return "Running";
	if (result.stopReason === "aborted") return "Canceled";
	if (result.exitCode !== 0 || result.stopReason === "error") return "Failed";
	return "Completed";
}

export function getInvocationStatus(
	mode: InvocationMode,
	results: SingleResult[],
): InvocationStatus {
	if (results.length === 0) return "Running";
	if (results.some((result) => getSingleResultStatus(result) === "Running")) {
		return "Running";
	}
	if (results.some((result) => getSingleResultStatus(result) === "Failed")) {
		return "Failed";
	}
	if (results.some((result) => getSingleResultStatus(result) === "Canceled")) {
		return "Canceled";
	}
	if (mode === "chain" && results.length > 0) return "Completed";
	return "Completed";
}

export function isSingleResultError(result: SingleResult): boolean {
	return (
		result.exitCode !== 0 ||
		result.stopReason === "error" ||
		result.stopReason === "aborted"
	);
}

export function getSingleResultErrorText(result: SingleResult): string {
	return (
		result.errorMessage ||
		result.stderr ||
		getFinalOutput(result.messages) ||
		"(no output)"
	);
}

export function aggregateUsage(results: SingleResult[]): UsageStats {
	const total = createUsageStats();
	for (const result of results) {
		total.input += result.usage.input;
		total.output += result.usage.output;
		total.cacheRead += result.usage.cacheRead;
		total.cacheWrite += result.usage.cacheWrite;
		total.cost += result.usage.cost;
		total.turns += result.usage.turns;
	}
	return total;
}
