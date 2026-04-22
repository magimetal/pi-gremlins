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
export type ResultLifecycle = "pending" | "completed" | "failed" | "canceled";

export interface StatusSemantics {
	status: InvocationStatus;
	lifecycle: ResultLifecycle;
	label: InvocationStatus;
	badgeText: InvocationStatus;
	icon: string;
	isTerminal: boolean;
	isError: boolean;
}

export interface AgentSourceSemantics {
	source: AgentSource | "unknown";
	badgeText: string;
	trustLabel: string;
}

export interface UsageTelemetrySemantics {
	turns: string;
	input: string;
	output: string;
	cacheRead: string;
	cacheWrite: string;
	cost: string;
	contextTokens: string;
	model: string;
}

export type StatusTone = "warning" | "success" | "error";

export interface ViewerEntryTimestamps {
	createdAt?: number;
	updatedAt?: number;
}

export type ViewerEntry =
	| ({
			type: "assistant-text";
			text: string;
			streaming: boolean;
	  } & ViewerEntryTimestamps)
	| ({
			type: "steer";
			text: string;
			streaming: boolean;
			isError: boolean;
	  } & ViewerEntryTimestamps)
	| ({
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			args: Record<string, unknown>;
	  } & ViewerEntryTimestamps)
	| ({
			type: "tool-result";
			toolCallId: string;
			toolName: string;
			content: string;
			streaming: boolean;
			truncated: boolean;
			isError: boolean;
	  } & ViewerEntryTimestamps);

export interface SingleResult {
	gremlinId: string;
	agent: string;
	agentSource: AgentSource | "unknown";
	task: string;
	exitCode: number;
	lifecycle: ResultLifecycle;
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
	viewerResults?: SingleResult[];
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
	| {
			type: "text";
			text: string;
			streaming?: boolean;
			timestampMs?: number;
	  }
	| {
			type: "steer";
			content: string;
			streaming: boolean;
			isError: boolean;
			timestampMs?: number;
	  }
	| {
			type: "toolCall";
			name: string;
			args: Record<string, unknown>;
			toolCallId?: string;
			timestampMs?: number;
	  }
	| {
			type: "toolResult";
			toolName: string;
			content: string;
			streaming: boolean;
			truncated: boolean;
			isError: boolean;
			toolCallId?: string;
			timestampMs?: number;
	  };

export interface DerivedRenderData {
	revision: number;
	source: "messages" | "viewerEntries";
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

export function getViewerEntryTimestampMs(
	entry: ViewerEntryTimestamps,
): number | undefined {
	return entry.updatedAt ?? entry.createdAt;
}

export function formatViewerEntryTimestamp(
	timestampMs: number | undefined,
): string | null {
	if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) {
		return null;
	}
	const date = new Date(timestampMs);
	const parts = [date.getHours(), date.getMinutes(), date.getSeconds()].map(
		(value) => value.toString().padStart(2, "0"),
	);
	return `[${parts.join(":")}]`;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

export function getUsageTelemetrySegments(
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
): string[] {
	const parts: string[] = [];
	if (usage.turns) {
		parts.push(`${USAGE_TELEMETRY_SEMANTICS.turns}:${usage.turns}`);
	}
	if (usage.input) {
		parts.push(
			`${USAGE_TELEMETRY_SEMANTICS.input}:${formatTokens(usage.input)}`,
		);
	}
	if (usage.output) {
		parts.push(
			`${USAGE_TELEMETRY_SEMANTICS.output}:${formatTokens(usage.output)}`,
		);
	}
	if (usage.cacheRead) {
		parts.push(
			`${USAGE_TELEMETRY_SEMANTICS.cacheRead}:${formatTokens(usage.cacheRead)}`,
		);
	}
	if (usage.cacheWrite) {
		parts.push(
			`${USAGE_TELEMETRY_SEMANTICS.cacheWrite}:${formatTokens(usage.cacheWrite)}`,
		);
	}
	if (usage.cost) {
		parts.push(`${USAGE_TELEMETRY_SEMANTICS.cost}:$${usage.cost.toFixed(4)}`);
	}
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(
			`${USAGE_TELEMETRY_SEMANTICS.contextTokens}:${formatTokens(usage.contextTokens)}`,
		);
	}
	if (model) {
		parts.push(`${USAGE_TELEMETRY_SEMANTICS.model}:${model}`);
	}
	return parts;
}

const USAGE_TELEMETRY_SEMANTICS: UsageTelemetrySemantics = {
	turns: "turns",
	input: "input",
	output: "output",
	cacheRead: "cacheRead",
	cacheWrite: "cacheWrite",
	cost: "cost",
	contextTokens: "context",
	model: "model",
};

export function getUsageTelemetrySemantics(): UsageTelemetrySemantics {
	return USAGE_TELEMETRY_SEMANTICS;
}

export function getAgentSourceSemantics(
	source: AgentSource | "unknown",
): AgentSourceSemantics {
	switch (source) {
		case "user":
			return { source, badgeText: "user", trustLabel: "User agent" };
		case "project":
			return { source, badgeText: "project", trustLabel: "Project agent" };
		case "package":
			return { source, badgeText: "package", trustLabel: "Package agent" };
		default:
			return {
				source: "unknown",
				badgeText: "unknown",
				trustLabel: "Unknown agent source",
			};
	}
}

export function formatAgentSourceBadgeText(
	source: AgentSource | "unknown",
): string {
	return `[${getAgentSourceSemantics(source).badgeText}]`;
}

export function getStatusTone(status: InvocationStatus): StatusTone {
	switch (status) {
		case "Completed":
			return "success";
		case "Failed":
			return "error";
		case "Canceled":
		case "Running":
		default:
			return "warning";
	}
}

export function getStatusSemantics(status: InvocationStatus): StatusSemantics {
	switch (status) {
		case "Running":
			return {
				status,
				lifecycle: "pending",
				label: status,
				badgeText: status,
				icon: "⏳",
				isTerminal: false,
				isError: false,
			};
		case "Completed":
			return {
				status,
				lifecycle: "completed",
				label: status,
				badgeText: status,
				icon: "✓",
				isTerminal: true,
				isError: false,
			};
		case "Canceled":
			return {
				status,
				lifecycle: "canceled",
				label: status,
				badgeText: status,
				icon: "⊘",
				isTerminal: true,
				isError: false,
			};
		case "Failed":
		default:
			return {
				status: "Failed",
				lifecycle: "failed",
				label: "Failed",
				badgeText: "Failed",
				icon: "✗",
				isTerminal: true,
				isError: true,
			};
	}
}

export function formatStatusBadgeText(status: InvocationStatus): string {
	return `[${getStatusSemantics(status).badgeText}]`;
}

export function getSingleResultSemantics(
	result: SingleResult,
): StatusSemantics {
	return getStatusSemantics(getSingleResultStatus(result));
}

export function getInvocationSemantics(
	mode: InvocationMode,
	results: SingleResult[],
): StatusSemantics {
	return getStatusSemantics(getInvocationStatus(mode, results));
}

function buildDerivedRenderDataFromViewerEntries(
	viewerEntries: ViewerEntry[],
): Omit<DerivedRenderData, "revision"> {
	const displayItems: DisplayItem[] = [];
	let finalAssistantOutput = "";
	let finalToolResultOutput = "";

	for (const entry of viewerEntries) {
		if (entry.type === "assistant-text") {
			displayItems.push({
				type: "text",
				text: entry.text,
				streaming: entry.streaming || undefined,
				timestampMs: getViewerEntryTimestampMs(entry),
			});
			if (entry.text.trim()) finalAssistantOutput = entry.text;
			continue;
		}
		if (entry.type === "steer") {
			displayItems.push({
				type: "steer",
				content: entry.text,
				streaming: entry.streaming,
				isError: entry.isError,
				timestampMs: getViewerEntryTimestampMs(entry),
			});
			continue;
		}
		if (entry.type === "tool-call") {
			displayItems.push({
				type: "toolCall",
				name: entry.toolName,
				args: entry.args,
				toolCallId: entry.toolCallId,
				timestampMs: getViewerEntryTimestampMs(entry),
			});
			continue;
		}
		displayItems.push({
			type: "toolResult",
			toolName: entry.toolName,
			content: entry.content,
			streaming: entry.streaming,
			truncated: entry.truncated,
			isError: entry.isError,
			toolCallId: entry.toolCallId,
			timestampMs: getViewerEntryTimestampMs(entry),
		});
		if (entry.content.trim()) finalToolResultOutput = entry.content;
	}

	return {
		source: "viewerEntries",
		finalOutput: finalAssistantOutput || finalToolResultOutput,
		displayItems,
	};
}

function buildDerivedRenderDataFromMessages(
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
					toolCallId: part.id,
				});
			}
		}
	}

	return { source: "messages", finalOutput, displayItems };
}

function buildDerivedRenderData(
	messages: Message[],
	viewerEntries: ViewerEntry[],
): Omit<DerivedRenderData, "revision"> {
	if (viewerEntries.length > 0) {
		return buildDerivedRenderDataFromViewerEntries(viewerEntries);
	}
	return buildDerivedRenderDataFromMessages(messages);
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
	return getUsageTelemetrySegments(usage, model).join(" · ");
}

export function getFinalOutput(
	messages: Message[],
	viewerEntries: ViewerEntry[] = [],
): string {
	return buildDerivedRenderData(messages, viewerEntries).finalOutput;
}

export function getResultFinalOutput(result: SingleResult): string {
	return getDerivedRenderData(result).finalOutput;
}

export function getDerivedRenderData(result: SingleResult): DerivedRenderData {
	const revision = getResultDerivedRevision(result);
	const internal = getInternalResult(result);
	const cached = internal[RESULT_DERIVED_CACHE];
	if (cached && cached.revision === revision) return cached;
	const derived = buildDerivedRenderData(result.messages, result.viewerEntries);
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
	gremlinId: string = "g1",
): SingleResult {
	return initializeResultRevisions({
		gremlinId,
		agent,
		agentSource,
		task,
		exitCode: -1,
		lifecycle: "pending",
		messages: [],
		viewerEntries: [],
		stderr: "",
		usage: createUsageStats(),
		step,
	});
}

export function getSingleResultLifecycle(
	result: SingleResult,
): ResultLifecycle {
	if (result.lifecycle && result.lifecycle !== "pending") {
		return result.lifecycle;
	}
	if (result.stopReason === "aborted") return "canceled";
	if (result.stopReason === "error" && result.exitCode === -1) {
		return "failed";
	}
	if (result.exitCode === -1) return result.lifecycle ?? "pending";
	if (result.exitCode !== 0 || result.stopReason === "error") return "failed";
	return "completed";
}

export function isSingleResultTerminal(result: SingleResult): boolean {
	return getSingleResultLifecycle(result) !== "pending";
}

export function getSingleResultStatus(result: SingleResult): InvocationStatus {
	switch (getSingleResultLifecycle(result)) {
		case "completed":
			return "Completed";
		case "failed":
			return "Failed";
		case "canceled":
			return "Canceled";
		case "pending":
		default:
			return "Running";
	}
}

export function getInvocationStatus(
	mode: InvocationMode,
	results: SingleResult[],
): InvocationStatus {
	if (results.length === 0) return "Running";
	const statuses = results.map((result) => getSingleResultStatus(result));
	if (statuses.includes("Running")) return "Running";
	if (statuses.includes("Failed")) return "Failed";
	if (statuses.includes("Canceled")) return "Canceled";
	void mode;
	return "Completed";
}

export function getSingleResultErrorText(result: SingleResult): string {
	return (
		result.errorMessage ||
		result.stderr ||
		getResultFinalOutput(result) ||
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
		total.contextTokens += result.usage.contextTokens;
		total.turns += result.usage.turns;
	}
	return total;
}
