/**
 * pi-gremlins tool for isolated gremlin runs.
 *
 * Spawns a separate `pi` process for each pi-gremlins invocation,
 * preserving single, parallel, and chain modes with fresh isolated context.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type {
	AssistantMessage,
	Message,
	ToolResultMessage,
	UserMessage,
} from "@mariozechner/pi-ai";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ResolvedPaths } from "@mariozechner/pi-coding-agent";
import {
	DefaultPackageManager,
	type ExtensionAPI,
	type ExtensionCommandContext,
	getAgentDir,
	SettingsManager,
	withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";
import {
	Container,
	type Focusable,
	Key,
	type KeybindingsManager,
	matchesKey,
	type OverlayHandle,
	Text,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
	type AgentConfig,
	type AgentScope,
	discoverAgentsWithPackages,
	resolveAgentByName,
} from "./agents.js";
import {
	executeChainMode,
	executeParallelMode,
	executeSingleMode,
	type OnUpdateCallback,
	type PiGremlinsToolResult,
} from "./execution-modes.js";
import {
	aggregateUsage,
	bumpResultDerivedRevision,
	bumpResultVisibleRevision,
	cloneSingleResultForSnapshot,
	createPendingResult,
	createSingleViewerState,
	createUsageStats,
	formatAgentSourceBadgeText,
	formatStatusBadgeText,
	getAgentSourceSemantics,
	getDerivedRenderData,
	getFinalOutput,
	getInvocationSnapshotRevision,
	getInvocationStatus,
	getResultVisibleRevision,
	getSingleResultErrorText,
	getSingleResultStatus,
	getStatusTone,
	getUsageTelemetrySegments,
	type InvocationMode,
	type InvocationStatus,
	initializeResultRevisions,
	type PiGremlinsDetails,
	type SingleResult,
	type SingleRunViewerState,
	setInvocationSnapshotRevision,
	type ViewerEntry,
	type ViewerToolCallRecord,
} from "./execution-shared.js";
import {
	getResultSummaryLine,
	renderPiGremlinsResult,
} from "./result-rendering.js";
import { getViewerOpenAction } from "./viewer-open-action.js";
import {
	buildSelectedResultBodyLines,
	getNavigatedViewerSelection,
	getRefreshedViewerSelection,
	getResultContextLabel,
	getViewerBodyHeight,
	getViewerChromeState,
	getViewerDialogHeight,
	getViewerNavigationHint,
	getViewerOverlayOptions,
	isViewerScrollToEndKey,
	isViewerScrollToStartKey,
	normalizeViewerTabs,
	VIEWER_SCROLL_LINE_STEP,
} from "./viewer-result-navigation.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const NO_INVOCATION_TEXT = "No pi-gremlins run available in this session.";
const VIEWER_TITLE = "pi-gremlins mission control";

function formatAvailableAgents(agents: AgentConfig[]): string {
	return (
		agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") ||
		"none"
	);
}

function formatAgentLookupError(
	agentName: string,
	agents: AgentConfig[],
	ambiguousMatches: AgentConfig[],
): string {
	if (ambiguousMatches.length > 1) {
		return `Ambiguous gremlin: "${agentName}". Matching gremlins: ${formatAvailableAgents(ambiguousMatches)}. Use exact casing.
${getAgentSetupHint()}`;
	}

	return `Unknown gremlin: "${agentName}". Available gremlins: ${formatAvailableAgents(agents)}.
${getAgentSetupHint()}`;
}

function getAgentSetupHint(): string {
	return 'Create gremlin definitions in ~/.pi/agent/agents/ or .pi/agents/. Project-local gremlins require agentScope: "both" or "project".';
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview =
				command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg(
					"warning",
					`:${startLine}${endLine ? `-${endLine}` : ""}`,
				);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return (
				themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath))
			);
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "find ") +
				themeFg("accent", pattern) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview =
				argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

interface InvocationSnapshot extends PiGremlinsDetails {
	toolCallId: string;
	status: InvocationStatus;
	updatedAt: number;
}

interface ViewerOverlayRuntime {
	invocationId: string;
	handle?: OverlayHandle;
	refresh?: () => void;
	close?: () => void;
	finish?: () => void;
	closed?: boolean;
}

function coerceRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function extractMessageText(
	message: AssistantMessage | UserMessage | ToolResultMessage,
): string {
	const { content } = message;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return part.type === "text" && typeof part.text === "string";
		})
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function summarizeToolResult(
	value: unknown,
	maxLength = 1200,
): { content: string; truncated: boolean } {
	let content = "";
	if (value && typeof value === "object") {
		const toolValue = value as {
			content?: Array<{ type?: string; text?: string }>;
			error?: unknown;
			message?: unknown;
		};
		if (Array.isArray(toolValue.content)) {
			content = toolValue.content
				.filter((part) => part.type === "text" && typeof part.text === "string")
				.map((part) => part.text ?? "")
				.join("\n")
				.trim();
		}
		if (!content && typeof toolValue.error === "string")
			content = toolValue.error;
		if (!content && typeof toolValue.message === "string")
			content = toolValue.message;
	}
	if (!content) {
		if (typeof value === "string") content = value;
		else if (value !== undefined) {
			try {
				content = JSON.stringify(value, null, 2);
			} catch {
				content = String(value);
			}
		}
	}
	if (!content) content = "(no tool output)";
	const truncated = content.length > maxLength;
	return {
		content: truncated ? `${content.slice(0, maxLength - 3)}...` : content,
		truncated,
	};
}

function upsertAssistantViewerEntry(
	result: SingleResult,
	state: SingleRunViewerState,
	text: string,
	streaming: boolean,
): boolean {
	if (!text) return false;
	const entryIndex = state.currentAssistantEntryIndex;
	if (entryIndex !== null) {
		const existing = result.viewerEntries[entryIndex];
		if (existing?.type === "assistant-text") {
			if (existing.text === text && existing.streaming === streaming)
				return false;
			existing.text = text;
			existing.streaming = streaming;
			return true;
		}
	}
	state.currentAssistantEntryIndex =
		result.viewerEntries.push({ type: "assistant-text", text, streaming }) - 1;
	return true;
}

function finishAssistantViewerEntry(
	result: SingleResult,
	state: SingleRunViewerState,
	{ clearIndex = true }: { clearIndex?: boolean } = {},
): boolean {
	const entryIndex = state.currentAssistantEntryIndex;
	let changed = false;
	if (entryIndex !== null) {
		const existing = result.viewerEntries[entryIndex];
		if (existing?.type === "assistant-text" && existing.streaming) {
			existing.streaming = false;
			changed = true;
		}
	}
	if (clearIndex) state.currentAssistantEntryIndex = null;
	return changed;
}

function ensureToolCallViewerEntry(
	result: SingleResult,
	state: SingleRunViewerState,
	toolCallId: string,
	toolName: string,
	args: Record<string, unknown>,
): { record: ViewerToolCallRecord; changed: boolean } {
	const existing = state.toolCalls.get(toolCallId);
	if (existing) {
		const entry = result.viewerEntries[existing.callEntryIndex];
		if (
			entry?.type === "tool-call" &&
			Object.keys(entry.args).length === 0 &&
			Object.keys(args).length > 0
		) {
			entry.args = args;
			return { record: existing, changed: true };
		}
		return { record: existing, changed: false };
	}
	const callEntryIndex =
		result.viewerEntries.push({
			type: "tool-call",
			toolCallId,
			toolName,
			args,
		}) - 1;
	const record: ViewerToolCallRecord = { callEntryIndex };
	state.toolCalls.set(toolCallId, record);
	return { record, changed: true };
}

function upsertToolResultViewerEntry(
	result: SingleResult,
	state: SingleRunViewerState,
	toolCallId: string,
	toolName: string,
	args: Record<string, unknown>,
	content: string,
	streaming: boolean,
	truncated: boolean,
	isError: boolean,
): boolean {
	const { record, changed: toolCallChanged } = ensureToolCallViewerEntry(
		result,
		state,
		toolCallId,
		toolName,
		args,
	);
	if (record.resultEntryIndex !== undefined) {
		const existing = result.viewerEntries[record.resultEntryIndex];
		if (existing?.type === "tool-result") {
			if (
				existing.content === content &&
				existing.streaming === streaming &&
				existing.truncated === truncated &&
				existing.isError === isError
			) {
				return toolCallChanged;
			}
			existing.content = content;
			existing.streaming = streaming;
			existing.truncated = truncated;
			existing.isError = isError;
			return true;
		}
	}
	record.resultEntryIndex =
		result.viewerEntries.push({
			type: "tool-result",
			toolCallId,
			toolName,
			content,
			streaming,
			truncated,
			isError,
		}) - 1;
	return true;
}

function applyChildEventToSingleResult(
	result: SingleResult,
	state: SingleRunViewerState,
	event: Record<string, unknown>,
): boolean {
	const eventType = typeof event.type === "string" ? event.type : null;
	if (!eventType) return false;

	if (eventType === "turn_start") {
		return finishAssistantViewerEntry(result, state);
	}

	if (eventType === "turn_end") {
		return finishAssistantViewerEntry(result, state, { clearIndex: false });
	}

	if (
		eventType === "message_start" ||
		eventType === "message_update" ||
		eventType === "message_end"
	) {
		const messageValue = event.message;
		if (!messageValue || typeof messageValue !== "object") return false;
		const message = messageValue as Message;
		if (message.role === "assistant") {
			let contentBearingChanged = false;
			const text = extractMessageText(message as AssistantMessage);
			if (text) {
				contentBearingChanged =
					upsertAssistantViewerEntry(
						result,
						state,
						text,
						eventType !== "message_end",
					) || contentBearingChanged;
			}
			for (const part of message.content) {
				if (part.type === "toolCall") {
					contentBearingChanged =
						ensureToolCallViewerEntry(
							result,
							state,
							part.id,
							part.name,
							coerceRecord(part.arguments),
						).changed || contentBearingChanged;
				}
			}
			if (eventType === "message_end") {
				contentBearingChanged =
					finishAssistantViewerEntry(result, state) || contentBearingChanged;
			}
			return contentBearingChanged;
		}
		if (message.role === "toolResult" && eventType === "message_end") {
			const toolResult = message as ToolResultMessage;
			const summary = summarizeToolResult(toolResult);
			return upsertToolResultViewerEntry(
				result,
				state,
				toolResult.toolCallId,
				toolResult.toolName,
				{},
				summary.content,
				false,
				summary.truncated,
				Boolean(toolResult.isError),
			);
		}
		return false;
	}

	if (eventType === "tool_execution_start") {
		const toolCallId =
			typeof event.toolCallId === "string" ? event.toolCallId : null;
		const toolName = typeof event.toolName === "string" ? event.toolName : null;
		if (!toolCallId || !toolName) return false;
		return ensureToolCallViewerEntry(
			result,
			state,
			toolCallId,
			toolName,
			coerceRecord(event.args),
		).changed;
	}

	if (
		eventType === "tool_execution_update" ||
		eventType === "tool_execution_end"
	) {
		const toolCallId =
			typeof event.toolCallId === "string" ? event.toolCallId : null;
		const toolName = typeof event.toolName === "string" ? event.toolName : null;
		if (!toolCallId || !toolName) return false;
		const summary = summarizeToolResult(
			eventType === "tool_execution_update"
				? event.partialResult
				: event.result,
		);
		return upsertToolResultViewerEntry(
			result,
			state,
			toolCallId,
			toolName,
			coerceRecord(event.args),
			summary.content,
			eventType === "tool_execution_update",
			summary.truncated,
			Boolean(eventType === "tool_execution_end" && event.isError),
		);
	}

	if (eventType === "tool_result_end") {
		const messageValue = event.message;
		if (!messageValue || typeof messageValue !== "object") return false;
		const toolResult = messageValue as ToolResultMessage;
		const summary = summarizeToolResult(toolResult);
		return upsertToolResultViewerEntry(
			result,
			state,
			toolResult.toolCallId,
			toolResult.toolName,
			{},
			summary.content,
			false,
			summary.truncated,
			Boolean(toolResult.isError),
		);
	}

	return false;
}

function formatViewerStatusBadge(
	theme: {
		fg: (color: any, text: string) => string;
		bold: (text: string) => string;
	},
	status: InvocationStatus,
): string {
	return theme.fg(getStatusTone(status), formatStatusBadgeText(status));
}

function formatViewerSourceBadge(
	theme: {
		fg: (color: any, text: string) => string;
		bold: (text: string) => string;
	},
	result: SingleResult,
): string {
	return theme.fg("muted", formatAgentSourceBadgeText(result.agentSource));
}

function pushViewerTextBlock(
	lines: string[],
	theme: {
		fg: (color: any, text: string) => string;
		bold: (text: string) => string;
	},
	label: string,
	text: string,
	tone: string,
	badges: string[] = [],
): void {
	const normalized = text.trim();
	const badgeSuffix = badges.length > 0 ? ` ${badges.join(" ")}` : "";
	if (!normalized) {
		lines.push(theme.fg(tone, `${label}${badgeSuffix}`));
		return;
	}
	const contentLines = normalized.split("\n");
	const [firstLine, ...rest] = contentLines;
	lines.push(theme.fg(tone, `${label} · ${firstLine}${badgeSuffix}`));
	for (const line of rest) {
		lines.push(theme.fg(tone, `  ${line}`));
	}
}

function buildViewerStateLines(
	result: SingleResult,
	status: InvocationStatus,
	theme: {
		fg: (color: any, text: string) => string;
		bold: (text: string) => string;
	},
): string[] {
	switch (status) {
		case "Running":
			return [theme.fg("warning", "running · Awaiting first gremlin event.")];
		case "Failed":
			return [theme.fg("error", `error · ${getSingleResultErrorText(result)}`)];
		case "Canceled":
			return [
				theme.fg("warning", `canceled · ${getSingleResultErrorText(result)}`),
			];
		case "Completed":
		default:
			return [theme.fg("muted", "quiet · No output captured.")];
	}
}

function buildViewerFallbackLines(
	result: SingleResult,
	status: InvocationStatus,
	theme: {
		fg: (color: any, text: string) => string;
		bold: (text: string) => string;
	},
): string[] {
	const derived = getDerivedRenderData(result);
	const finalOutput = derived.finalOutput.trim();
	if (finalOutput) {
		const lines: string[] = [];
		pushViewerTextBlock(lines, theme, "assistant", finalOutput, "toolOutput");
		return lines;
	}
	if (derived.displayItems.length > 0) {
		const summary = getResultSummaryLine(result, (toolName, args, themeFg) =>
			formatToolCall(toolName, args, themeFg),
		);
		return [theme.fg(summary.tone, `${summary.label} · ${summary.text}`)];
	}
	return buildViewerStateLines(result, status, theme);
}

function buildViewerEntryLines(
	entries: ViewerEntry[],
	theme: {
		fg: (color: any, text: string) => string;
		bold: (text: string) => string;
	},
): string[] {
	const lines: string[] = [];
	for (const entry of entries) {
		if (entry.type === "assistant-text") {
			pushViewerTextBlock(
				lines,
				theme,
				"assistant",
				entry.text.trim() || "Awaiting assistant output.",
				entry.streaming ? "warning" : "toolOutput",
				entry.streaming ? [theme.fg("warning", "[live]")] : [],
			);
			continue;
		}
		if (entry.type === "tool-call") {
			lines.push(
				theme.fg("muted", "tool call · ") +
					formatToolCall(entry.toolName, entry.args, theme.fg.bind(theme)),
			);
			continue;
		}
		const badges: string[] = [];
		if (entry.streaming) badges.push(theme.fg("warning", "[live]"));
		if (entry.truncated) badges.push(theme.fg("muted", "[truncated]"));
		if (entry.isError) badges.push(theme.fg("error", "[error]"));
		pushViewerTextBlock(
			lines,
			theme,
			entry.isError ? "tool error" : "tool result",
			entry.toolName,
			entry.isError ? "error" : entry.streaming ? "warning" : "dim",
			badges,
		);
		if (entry.content.trim()) {
			for (const line of entry.content.split("\n")) {
				lines.push(
					(entry.isError ? theme.fg("error", "  ") : theme.fg("dim", "  ")) +
						(entry.isError ? theme.fg("error", line) : theme.fg("dim", line)),
				);
			}
		} else if (entry.streaming) {
			lines.push(theme.fg("warning", "  streaming…"));
		}
	}
	return lines;
}

function buildInvocationBodyLines(
	snapshot: InvocationSnapshot | undefined,
	selectedResultIndex: number,
	theme: {
		fg: (color: any, text: string) => string;
		bold: (text: string) => string;
	},
): string[] {
	if (!snapshot) {
		return [
			theme.fg(
				"muted",
				"stale · Invocation no longer available in this session.",
			),
		];
	}
	if (snapshot.results.length === 0) {
		return snapshot.status === "Running"
			? [theme.fg("warning", "running · Awaiting first gremlin event.")]
			: [theme.fg("muted", "quiet · No gremlin results recorded.")];
	}

	const resolvedResultIndex = Math.max(
		0,
		Math.min(selectedResultIndex, snapshot.results.length - 1),
	);
	const result = snapshot.results[resolvedResultIndex];
	const resultStatus = getSingleResultStatus(result);
	const bodyLines =
		result.viewerEntries.length > 0
			? buildViewerEntryLines(result.viewerEntries, theme)
			: buildViewerFallbackLines(result, resultStatus, theme);
	const lines = buildSelectedResultBodyLines(
		theme.fg("muted", "task · ") + theme.fg("dim", result.task),
		bodyLines,
	);
	if (result.agentSource !== "user") {
		const source = getAgentSourceSemantics(result.agentSource);
		lines.splice(
			1,
			0,
			theme.fg("muted", "trust · ") + theme.fg("dim", source.trustLabel),
		);
	}
	return lines;
}

function buildViewerTitleLine(
	theme: {
		fg: (color: any, text: string) => string;
		bold: (text: string) => string;
	},
	status: InvocationStatus,
	mode: InvocationMode,
): string {
	return [
		theme.fg("accent", theme.bold(VIEWER_TITLE)),
		theme.fg("muted", "·"),
		formatViewerStatusBadge(theme, status),
		theme.fg("muted", mode),
	].join(" ");
}

function buildViewerMetadataLine(
	theme: {
		fg: (color: any, text: string) => string;
		bold: (text: string) => string;
	},
	result: SingleResult | undefined,
): string {
	if (!result) {
		return theme.fg("muted", "focus · awaiting result selection");
	}
	return [
		theme.fg("muted", "focus ·"),
		theme.fg("toolTitle", theme.bold(result.agent)),
		formatViewerSourceBadge(theme, result),
		theme.fg("muted", "· result"),
		formatViewerStatusBadge(theme, getSingleResultStatus(result)),
	].join(" ");
}

function buildViewerTelemetryLine(
	theme: {
		fg: (color: any, text: string) => string;
		bold: (text: string) => string;
	},
	snapshot: InvocationSnapshot | undefined,
	selectedResultIndex: number,
): string {
	if (!snapshot || snapshot.results.length === 0) {
		return theme.fg("muted", "telemetry · idle");
	}
	const resolvedResultIndex = Math.max(
		0,
		Math.min(selectedResultIndex, snapshot.results.length - 1),
	);
	const selectedResult = snapshot.results[resolvedResultIndex];
	const usage =
		snapshot.results.length > 1
			? aggregateUsage(snapshot.results)
			: selectedResult.usage;
	const models = [
		...new Set(snapshot.results.map((result) => result.model).filter(Boolean)),
	];
	const selectedModel = selectedResult.model?.trim() || undefined;
	const model =
		snapshot.results.length === 1
			? selectedModel
			: models.length === 1
				? models[0]
				: selectedModel
					? `${selectedModel} (focus)`
					: models.length > 1
						? "mixed"
						: undefined;
	const segments = getUsageTelemetrySegments(usage, model);
	if (segments.length === 0) {
		return theme.fg("muted", "telemetry · idle");
	}
	return (
		theme.fg("muted", "telemetry · ") + theme.fg("dim", segments.join(" · "))
	);
}

function buildViewerInvocationLine(
	theme: {
		fg: (color: any, text: string) => string;
		bold: (text: string) => string;
	},
	toolCallId: string | undefined,
): string {
	return (
		theme.fg("muted", "invocation · ") +
		theme.fg("dim", toolCallId ?? "(missing)")
	);
}

interface ViewerBodyCacheEntry {
	revision: number;
	selectedResultIndex: number;
	lines: string[];
}

interface ViewerWrapCacheEntry {
	revision: number;
	selectedResultIndex: number;
	innerWidth: number;
	lines: string[];
}

function isSameResultSnapshotSlot(
	previousResult: SingleResult | undefined,
	nextResult: SingleResult,
): boolean {
	if (!previousResult) return false;
	return (
		previousResult.agent === nextResult.agent &&
		previousResult.agentSource === nextResult.agentSource &&
		previousResult.task === nextResult.task &&
		previousResult.step === nextResult.step
	);
}

export function createInvocationSnapshot(
	toolCallId: string,
	details: PiGremlinsDetails,
	status = getInvocationStatus(details.mode, details.results),
	previousSnapshot?: InvocationSnapshot,
): InvocationSnapshot {
	const previousResults = previousSnapshot?.results ?? [];
	const nextResults = details.results.map((result, index) => {
		initializeResultRevisions(result);
		const previousResult = previousResults[index];
		if (
			isSameResultSnapshotSlot(previousResult, result) &&
			getResultVisibleRevision(previousResult) ===
				getResultVisibleRevision(result)
		) {
			return previousResult;
		}
		return cloneSingleResultForSnapshot(result, previousResult);
	});

	const snapshotChanged =
		!previousSnapshot ||
		previousSnapshot.mode !== details.mode ||
		previousSnapshot.agentScope !== details.agentScope ||
		previousSnapshot.projectAgentsDir !== details.projectAgentsDir ||
		previousSnapshot.status !== status ||
		previousResults.length !== nextResults.length ||
		nextResults.some((result, index) => result !== previousResults[index]);

	if (!snapshotChanged && previousSnapshot) {
		return previousSnapshot;
	}

	const snapshot: InvocationSnapshot = {
		toolCallId,
		status,
		updatedAt: Date.now(),
		...details,
		results: nextResults,
	};
	setInvocationSnapshotRevision(
		snapshot,
		(previousSnapshot ? getInvocationSnapshotRevision(previousSnapshot) : 0) +
			1,
	);
	return snapshot;
}

function isTerminalInvocationStatus(status: InvocationStatus): boolean {
	return status !== "Running";
}

function isProgressOnlyInvocationUpdate(
	previousSnapshot: InvocationSnapshot | undefined,
	nextSnapshot: InvocationSnapshot,
	status = nextSnapshot.status,
): boolean {
	return (
		Boolean(previousSnapshot) &&
		!isTerminalInvocationStatus(status) &&
		previousSnapshot === nextSnapshot
	);
}

export function createInvocationUpdateController(
	readSnapshot: (toolCallId: string) => InvocationSnapshot | undefined,
	publishSnapshot: (toolCallId: string, snapshot: InvocationSnapshot) => void,
	emitUpdate: (partial: AgentToolResult<PiGremlinsDetails>) => void,
) {
	const pendingProgressUpdates = new Map<
		string,
		AgentToolResult<PiGremlinsDetails>
	>();

	const flushPendingProgress = (toolCallId: string) => {
		const pending = pendingProgressUpdates.get(toolCallId);
		if (!pending) return;
		pendingProgressUpdates.delete(toolCallId);
		emitUpdate(pending);
	};

	return {
		applyPartial(
			toolCallId: string,
			partial: AgentToolResult<PiGremlinsDetails>,
		): AgentToolResult<PiGremlinsDetails> {
			if (!partial.details) {
				emitUpdate(partial);
				return partial;
			}

			const previousSnapshot = readSnapshot(toolCallId);
			const status = getInvocationStatus(
				partial.details.mode,
				partial.details.results,
			);
			const snapshot = createInvocationSnapshot(
				toolCallId,
				partial.details,
				status,
				previousSnapshot,
			);
			const normalizedPartial: AgentToolResult<PiGremlinsDetails> = {
				...partial,
				details: snapshot,
			};

			if (isProgressOnlyInvocationUpdate(previousSnapshot, snapshot, status)) {
				pendingProgressUpdates.set(toolCallId, normalizedPartial);
				return normalizedPartial;
			}

			flushPendingProgress(toolCallId);
			publishSnapshot(toolCallId, snapshot);
			emitUpdate(normalizedPartial);
			return normalizedPartial;
		},

		publishDetails(
			toolCallId: string,
			details: PiGremlinsDetails,
			status = getInvocationStatus(details.mode, details.results),
		): InvocationSnapshot {
			if (isTerminalInvocationStatus(status)) {
				flushPendingProgress(toolCallId);
			}
			const previousSnapshot = readSnapshot(toolCallId);
			const snapshot = createInvocationSnapshot(
				toolCallId,
				details,
				status,
				previousSnapshot,
			);
			if (snapshot !== previousSnapshot) {
				publishSnapshot(toolCallId, snapshot);
			}
			return snapshot;
		},
	};
}

export function getCachedInvocationBodyLines(
	cache: ViewerBodyCacheEntry | null,
	snapshot: InvocationSnapshot | undefined,
	selectedResultIndex: number,
	theme: {
		fg: (color: any, text: string) => string;
		bold: (text: string) => string;
	},
): { cache: ViewerBodyCacheEntry; lines: string[]; cacheHit: boolean } {
	const revision = snapshot ? getInvocationSnapshotRevision(snapshot) : 0;
	if (
		cache &&
		cache.revision === revision &&
		cache.selectedResultIndex === selectedResultIndex
	) {
		return { cache, lines: cache.lines, cacheHit: true };
	}
	const lines = buildInvocationBodyLines(snapshot, selectedResultIndex, theme);
	return {
		cache: { revision, selectedResultIndex, lines },
		lines,
		cacheHit: false,
	};
}

export function getCachedWrappedBodyLines(
	cache: ViewerWrapCacheEntry | null,
	bodyLines: string[],
	revision: number,
	selectedResultIndex: number,
	innerWidth: number,
): { cache: ViewerWrapCacheEntry; lines: string[]; cacheHit: boolean } {
	if (
		cache &&
		cache.revision === revision &&
		cache.selectedResultIndex === selectedResultIndex &&
		cache.innerWidth === innerWidth
	) {
		return { cache, lines: cache.lines, cacheHit: true };
	}
	const lines: string[] = [];
	for (const line of bodyLines) {
		if (!line) {
			lines.push("");
			continue;
		}
		lines.push(
			...wrapTextWithAnsi(normalizeViewerTabs(line), Math.max(1, innerWidth)),
		);
	}
	return {
		cache: { revision, selectedResultIndex, innerWidth, lines },
		lines,
		cacheHit: false,
	};
}

export class PiGremlinsViewerOverlay extends Container implements Focusable {
	private readonly tui: TUI;
	private readonly theme: {
		fg: (color: any, text: string) => string;
		bold: (text: string) => string;
	};
	private readonly keybindings: KeybindingsManager;
	private readonly readSnapshot: () => InvocationSnapshot | undefined;
	private readonly onDismiss: () => void;
	private bodyLines: string[] = [];
	private bodyCache: ViewerBodyCacheEntry | null = null;
	private wrapCache: ViewerWrapCacheEntry | null = null;
	private titleLine = VIEWER_TITLE;
	private invocationLine = "";
	private metadataLine = "";
	private telemetryLine = "";
	private resultCount = 0;
	private snapshotMode: InvocationMode = "single";
	private selectedResult: SingleResult | undefined;
	private selectedResultIndex = 0;
	private scrollOffset = 0;
	private viewportHeight = 8;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	constructor(
		tui: TUI,
		theme: {
			fg: (color: any, text: string) => string;
			bold: (text: string) => string;
		},
		keybindings: KeybindingsManager,
		readSnapshot: () => InvocationSnapshot | undefined,
		onDismiss: () => void,
	) {
		super();
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.readSnapshot = readSnapshot;
		this.onDismiss = onDismiss;
		this.refresh();
	}

	private contentLine(
		content: string,
		dialogWidth: number,
		showFrame: boolean,
	): string {
		const innerWidth = Math.max(1, dialogWidth - (showFrame ? 2 : 0));
		const normalizedContent = normalizeViewerTabs(content);
		const truncated = truncateToWidth(normalizedContent, innerWidth, "…");
		const padding = Math.max(0, innerWidth - visibleWidth(truncated));
		if (!showFrame) return `${truncated}${" ".repeat(padding)}`;
		return `${this.theme.fg("borderMuted", "│")}${truncated}${" ".repeat(padding)}${this.theme.fg("borderMuted", "│")}`;
	}

	private borderLine(innerWidth: number, edge: "top" | "bottom"): string {
		const left = edge === "top" ? "┌" : "└";
		const right = edge === "top" ? "┐" : "┘";
		return this.theme.fg(
			"borderMuted",
			`${left}${"─".repeat(innerWidth)}${right}`,
		);
	}

	private ruleLine(innerWidth: number): string {
		return this.theme.fg("borderMuted", `├${"─".repeat(innerWidth)}┤`);
	}

	private getDialogHeight(): number {
		return getViewerDialogHeight(process.stdout.rows ?? 30);
	}

	private moveSelection(direction: -1 | 1): void {
		const snapshot = this.readSnapshot();
		const nextSelection = getNavigatedViewerSelection(
			{
				selectedResultIndex: this.selectedResultIndex,
				scrollOffset: this.scrollOffset,
			},
			snapshot?.results.length ?? 0,
			direction,
		);
		if (!nextSelection.changed) return;
		this.selectedResultIndex = nextSelection.selectedResultIndex;
		this.scrollOffset = nextSelection.scrollOffset;
		this.refresh();
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.onDismiss();
			return;
		}
		if (matchesKey(data, Key.left)) {
			this.moveSelection(-1);
			return;
		}
		if (matchesKey(data, Key.right)) {
			this.moveSelection(1);
			return;
		}
		if (matchesKey(data, Key.pageUp)) {
			this.scrollOffset = Math.max(
				0,
				this.scrollOffset - this.viewportHeight + 1,
			);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.pageDown)) {
			this.scrollOffset += this.viewportHeight - 1;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.up)) {
			this.scrollOffset = Math.max(
				0,
				this.scrollOffset - VIEWER_SCROLL_LINE_STEP,
			);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.scrollOffset += VIEWER_SCROLL_LINE_STEP;
			this.tui.requestRender();
			return;
		}
		if (isViewerScrollToStartKey(data)) {
			this.scrollOffset = 0;
			this.tui.requestRender();
			return;
		}
		if (isViewerScrollToEndKey(data)) {
			this.scrollOffset = Number.MAX_SAFE_INTEGER;
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const dialogWidth = Math.max(36, width);
		const innerWidth = Math.max(34, dialogWidth - 2);
		const snapshot = this.readSnapshot();
		const revision = snapshot ? getInvocationSnapshotRevision(snapshot) : 0;
		const wrappedBodyState = getCachedWrappedBodyLines(
			this.wrapCache,
			this.bodyLines,
			revision,
			this.selectedResultIndex,
			innerWidth,
		);
		this.wrapCache = wrappedBodyState.cache;
		const wrappedBody = wrappedBodyState.lines;
		const dialogHeight = this.getDialogHeight();
		const chromeState = getViewerChromeState(
			this.resultCount,
			dialogHeight,
			dialogWidth,
		);
		const bodyHeight = getViewerBodyHeight(
			dialogHeight,
			this.resultCount,
			dialogWidth,
		);
		this.viewportHeight = Math.max(1, bodyHeight);
		const maxScroll = Math.max(0, wrappedBody.length - bodyHeight);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));
		const visibleBody = wrappedBody.slice(
			this.scrollOffset,
			this.scrollOffset + bodyHeight,
		);
		const resultContextLine =
			this.selectedResult && chromeState.showResultContext
				? (getResultContextLabel(
						this.snapshotMode,
						this.selectedResultIndex,
						this.resultCount,
						{
							agent: this.selectedResult.agent,
							status: getSingleResultStatus(this.selectedResult),
							step: this.selectedResult.step,
							sourceBadge: formatViewerSourceBadge(
								this.theme,
								this.selectedResult,
							),
						},
						innerWidth,
					) ?? "")
				: "";
		const navigationHintLine = chromeState.showNavigationHint
			? (getViewerNavigationHint(this.resultCount, innerWidth) ?? "")
			: "";
		const lines: string[] = [];
		if (chromeState.showFrame) {
			lines.push(this.borderLine(innerWidth, "top"));
		}
		lines.push(
			this.contentLine(this.titleLine, dialogWidth, chromeState.showFrame),
		);
		if (chromeState.showMetadata) {
			lines.push(
				this.contentLine(this.metadataLine, dialogWidth, chromeState.showFrame),
			);
		}
		if (chromeState.showTelemetry) {
			lines.push(
				this.contentLine(
					this.telemetryLine,
					dialogWidth,
					chromeState.showFrame,
				),
			);
		}
		if (chromeState.showInvocation) {
			lines.push(
				this.contentLine(
					this.invocationLine,
					dialogWidth,
					chromeState.showFrame,
				),
			);
		}
		if (chromeState.showResultContext && resultContextLine) {
			lines.push(
				this.contentLine(resultContextLine, dialogWidth, chromeState.showFrame),
			);
		}
		if (chromeState.showTopRule) {
			lines.push(this.ruleLine(innerWidth));
		}
		for (const line of visibleBody) {
			lines.push(this.contentLine(line, dialogWidth, chromeState.showFrame));
		}
		for (let i = visibleBody.length; i < bodyHeight; i++) {
			lines.push(this.contentLine("", dialogWidth, chromeState.showFrame));
		}
		if (chromeState.showBottomRule) {
			lines.push(this.ruleLine(innerWidth));
		}
		if (chromeState.showNavigationHint && navigationHintLine) {
			lines.push(
				this.contentLine(
					navigationHintLine,
					dialogWidth,
					chromeState.showFrame,
				),
			);
		}
		if (chromeState.showFrame) {
			lines.push(this.borderLine(innerWidth, "bottom"));
		}
		return lines.slice(0, dialogHeight);
	}

	refresh(): void {
		const snapshot = this.readSnapshot();
		const resultCount = snapshot?.results.length ?? 0;
		const nextSelection = getRefreshedViewerSelection(
			{
				selectedResultIndex: this.selectedResultIndex,
				scrollOffset: this.scrollOffset,
			},
			resultCount,
		);
		this.selectedResultIndex = nextSelection.selectedResultIndex;
		this.scrollOffset = nextSelection.scrollOffset;
		this.resultCount = resultCount;
		this.snapshotMode = snapshot?.mode ?? "single";
		this.selectedResult =
			snapshot && resultCount > 0
				? snapshot.results[this.selectedResultIndex]
				: undefined;
		this.titleLine = buildViewerTitleLine(
			this.theme,
			snapshot?.status ?? "Running",
			this.snapshotMode,
		);
		this.metadataLine = buildViewerMetadataLine(
			this.theme,
			this.selectedResult,
		);
		this.telemetryLine = buildViewerTelemetryLine(
			this.theme,
			snapshot,
			this.selectedResultIndex,
		);
		this.invocationLine = buildViewerInvocationLine(
			this.theme,
			snapshot?.toolCallId,
		);
		const bodyState = getCachedInvocationBodyLines(
			this.bodyCache,
			snapshot,
			this.selectedResultIndex,
			this.theme,
		);
		this.bodyCache = bodyState.cache;
		this.bodyLines = bodyState.lines;
		this.tui.requestRender();
	}
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

async function writePromptToTempFile(
	agentName: string,
	prompt: string,
): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "pi-gremlins-"),
	);
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, {
			encoding: "utf-8",
			mode: 0o600,
		});
	});
	return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];

	// Bun standalone binaries set argv[1] to a virtual FS path (e.g. /$bunfs/root/pi)
	// that only resolves inside the running Bun process. Skip it — the binary IS the entry point.
	const isBunVirtualPath = currentScript?.startsWith("/$bunfs/");

	if (currentScript && !isBunVirtualPath && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		// Standalone binary (e.g. pi compiled with Bun) — invoke directly
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => PiGremlinsDetails,
): Promise<SingleResult> {
	const agentLookup = resolveAgentByName(agents, agentName);
	const agent = agentLookup.agent;

	if (!agent) {
		return initializeResultRevisions({
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			viewerEntries: [],
			stderr: formatAgentLookupError(
				agentName,
				agents,
				agentLookup.ambiguousMatches,
			),
			usage: createUsageStats(),
			step,
		});
	}

	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.thinking) args.push("--thinking", agent.thinking);
	if (agent.tools && agent.tools.length > 0) {
		args.push("--tools", agent.tools.join(","));
	}

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const currentResult: SingleResult = initializeResultRevisions({
		agent: agent.name,
		agentSource: agent.source,
		task,
		exitCode: -1,
		messages: [],
		viewerEntries: [],
		stderr: "",
		usage: createUsageStats(),
		model: agent.model,
		step,
	});
	const viewerState = createSingleViewerState();

	const emitUpdate = () => {
		onUpdate?.({
			content: [
				{
					type: "text",
					text:
						getFinalOutput(
							currentResult.messages,
							currentResult.viewerEntries,
						) || "(running...)",
				},
			],
			details: makeDetails([currentResult]),
		});
	};

	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		args.push(`Task: ${task}`);
		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: cwd ?? defaultCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: Record<string, unknown>;
				try {
					event = JSON.parse(line) as Record<string, unknown>;
				} catch {
					return;
				}

				const contentBearingChildMutation = applyChildEventToSingleResult(
					currentResult,
					viewerState,
					event,
				);

				if (
					contentBearingChildMutation &&
					(event.type === "message_start" ||
						event.type === "message_update" ||
						event.type === "turn_end" ||
						event.type === "tool_execution_start" ||
						event.type === "tool_execution_update" ||
						event.type === "tool_execution_end")
				) {
					bumpResultDerivedRevision(currentResult);
					emitUpdate();
					return;
				}

				if (event.type === "message_end" && event.message) {
					const message = event.message as Message;
					currentResult.messages.push(message);
					if (message.role === "assistant") {
						const usage = message.usage;
						currentResult.usage.turns += 1;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!currentResult.model && message.model) {
							currentResult.model = message.model;
						}
						if (message.stopReason) {
							currentResult.stopReason = message.stopReason;
						}
						if (message.errorMessage) {
							currentResult.errorMessage = message.errorMessage;
						}
					}
					bumpResultDerivedRevision(currentResult);
					emitUpdate();
					return;
				}

				if (event.type === "tool_result_end" && event.message) {
					currentResult.messages.push(event.message as Message);
					bumpResultDerivedRevision(currentResult);
					emitUpdate();
					return;
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				currentResult.stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", () => {
				resolve(1);
			});

			if (signal) {
				const killProc = () => {
					wasAborted = true;
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		});

		if (currentResult.exitCode !== exitCode) {
			currentResult.exitCode = exitCode;
			bumpResultVisibleRevision(currentResult);
		} else {
			currentResult.exitCode = exitCode;
		}
		if (wasAborted) {
			currentResult.stopReason = "aborted";
			currentResult.errorMessage = "pi-gremlins run was aborted";
			bumpResultVisibleRevision(currentResult);
		}
		if (finishAssistantViewerEntry(currentResult, viewerState)) {
			bumpResultDerivedRevision(currentResult);
		}
		return currentResult;
	} finally {
		if (tmpPromptPath) {
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		}
		if (tmpPromptDir) {
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
		}
	}
}

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(
		Type.String({ description: "Working directory for the agent process" }),
	),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({
		description: "Task with optional {previous} placeholder for prior output",
	}),
	cwd: Type.Optional(
		Type.String({ description: "Working directory for the agent process" }),
	),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description:
		'Which gremlin directories to use. Default: "user". Use "both" to include project-local .pi/agents gremlins.',
	default: "user",
});

const PiGremlinsParams = Type.Object({
	agent: Type.Optional(
		Type.String({
			description: "Name of the agent to invoke (for single mode)",
		}),
	),
	task: Type.Optional(
		Type.String({ description: "Task to delegate (for single mode)" }),
	),
	tasks: Type.Optional(
		Type.Array(TaskItem, {
			description: "Array of {agent, task} for parallel execution",
		}),
	),
	chain: Type.Optional(
		Type.Array(ChainItem, {
			description: "Array of {agent, task} for sequential execution",
		}),
	),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({
			description:
				"Prompt before running project-local gremlins. Default: true.",
			default: true,
		}),
	),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for the agent process (single mode)",
		}),
	),
});

/**
 * Try to resolve package paths including the agents resource.
 * Returns null if the pi version does not support ResolvedPaths.agents.
 */
async function tryResolvePackagePaths(
	cwd: string,
): Promise<ResolvedPaths | undefined> {
	try {
		const agentDir = getAgentDir();
		const settingsManager = SettingsManager.create(cwd, agentDir);
		const packageManager = new DefaultPackageManager({
			cwd,
			agentDir,
			settingsManager,
		});
		const resolved = await packageManager.resolve();
		// Check if this pi version has agents support
		if (
			"agents" in resolved &&
			Array.isArray((resolved as Record<string, unknown>).agents)
		) {
			return resolved;
		}
	} catch {
		// Incompatible pi version or missing API
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	const invocationRegistry = new Map<string, InvocationSnapshot>();
	let latestToolCallId: string | null = null;
	let viewerOverlayRuntime: ViewerOverlayRuntime | null = null;

	const hasViewerSnapshot = (toolCallId: string | undefined): boolean => {
		return toolCallId ? invocationRegistry.has(toolCallId) : false;
	};

	const publishInvocationSnapshot = (
		toolCallId: string,
		snapshot: InvocationSnapshot,
	): void => {
		invocationRegistry.set(toolCallId, snapshot);
		if (viewerOverlayRuntime?.invocationId === toolCallId) {
			viewerOverlayRuntime.refresh?.();
		}
	};

	const focusViewerOverlay = () => {
		const handle = viewerOverlayRuntime?.handle;
		if (!handle) return;
		handle.setHidden(false);
		handle.focus();
		viewerOverlayRuntime?.refresh?.();
	};

	const dismissViewerOverlay = () => {
		viewerOverlayRuntime?.close?.();
		viewerOverlayRuntime = null;
	};

	const clearViewerState = () => {
		dismissViewerOverlay();
		latestToolCallId = null;
		invocationRegistry.clear();
	};

	const openViewer = async (ctx: ExtensionCommandContext) => {
		if (!ctx.hasUI) return;
		switch (getViewerOpenAction(viewerOverlayRuntime)) {
			case "focus-existing":
				focusViewerOverlay();
				return;
			case "await-existing":
				return;
			case "open-new":
			default:
				break;
		}
		const targetInvocationId = latestToolCallId;
		if (!targetInvocationId || !invocationRegistry.has(targetInvocationId)) {
			ctx.ui.notify(NO_INVOCATION_TEXT, "warning");
			return;
		}

		const runtime: ViewerOverlayRuntime = { invocationId: targetInvocationId };
		const closeRuntime = () => {
			if (runtime.closed) return;
			runtime.closed = true;
			runtime.handle?.hide();
			if (viewerOverlayRuntime === runtime) viewerOverlayRuntime = null;
			runtime.finish?.();
		};

		runtime.close = closeRuntime;
		viewerOverlayRuntime = runtime;

		void ctx.ui
			.custom<void>(
				async (tui, theme, keybindings, done) => {
					runtime.finish = () => {
						done();
					};
					const overlay = new PiGremlinsViewerOverlay(
						tui,
						theme,
						keybindings,
						() => invocationRegistry.get(targetInvocationId),
						() => {
							dismissViewerOverlay();
						},
					);
					overlay.focused = runtime.handle?.isFocused() ?? true;
					runtime.refresh = () => {
						overlay.focused = runtime.handle?.isFocused() ?? false;
						overlay.refresh();
					};
					runtime.close = () => {
						closeRuntime();
					};
					if (runtime.closed) done();
					return overlay;
				},
				{
					overlay: true,
					overlayOptions: getViewerOverlayOptions(),
					onHandle: (handle) => {
						runtime.handle = handle;
						handle.focus();
						if (runtime.closed) closeRuntime();
					},
				},
			)
			.catch((error) => {
				if (viewerOverlayRuntime === runtime) viewerOverlayRuntime = null;
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			});
	};

	pi.on("session_start", () => {
		clearViewerState();
	});

	pi.on("session_shutdown", () => {
		clearViewerState();
	});

	pi.registerTool({
		name: "pi-gremlins",
		label: "pi-gremlins",
		description: [
			"Summon specialized gremlins with isolated context.",
			"Modes: single (one gremlin), parallel (many gremlins), chain (gremlins passing {previous} output along).",
			"Gremlin definitions still come from ~/.pi/agent/agents by default.",
			'Use agentScope: "both" or "project" to include repo-local .pi/agents gremlins.',
		].join(" "),
		parameters: PiGremlinsParams,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			const resolvedPaths = await tryResolvePackagePaths(ctx.cwd);
			const discovery = discoverAgentsWithPackages(
				ctx.cwd,
				agentScope,
				resolvedPaths,
			);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
			const mode: InvocationMode = hasChain
				? "chain"
				: hasTasks
					? "parallel"
					: "single";

			const makeDetails =
				(mode: InvocationMode) =>
				(results: SingleResult[]): PiGremlinsDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
				});
			const invocationUpdates = createInvocationUpdateController(
				(invocationId) => invocationRegistry.get(invocationId),
				publishInvocationSnapshot,
				(partial) => onUpdate?.(partial),
			);
			const updateInvocation = (
				invocationId: string,
				details: PiGremlinsDetails,
				status = getInvocationStatus(details.mode, details.results),
			) => {
				return invocationUpdates.publishDetails(invocationId, details, status);
			};
			const handleInvocationUpdate = (
				partial: AgentToolResult<PiGremlinsDetails>,
			) => invocationUpdates.applyPartial(toolCallId, partial);
			const finalizeResult = (
				result: PiGremlinsToolResult,
			): PiGremlinsToolResult => {
				const snapshot = invocationRegistry.get(toolCallId);
				if (!snapshot) return result;
				return { ...result, details: snapshot };
			};

			if (modeCount !== 1) {
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nAvailable gremlins: ${formatAvailableAgents(agents)}\n${getAgentSetupHint()}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			if (
				(agentScope === "project" || agentScope === "both") &&
				confirmProjectAgents &&
				ctx.hasUI
			) {
				const requestedAgentNames = new Set<string>();
				if (params.chain)
					for (const step of params.chain) requestedAgentNames.add(step.agent);
				if (params.tasks)
					for (const t of params.tasks) requestedAgentNames.add(t.agent);
				if (params.agent) requestedAgentNames.add(params.agent);

				const projectAgentsRequested = Array.from(
					new Map(
						Array.from(requestedAgentNames)
							.map((name) => resolveAgentByName(agents, name).agent)
							.filter(
								(agent): agent is AgentConfig => agent?.source === "project",
							)
							.map((agent) => [agent.filePath, agent]),
					).values(),
				);

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((a) => a.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run project-local gremlins?",
						`Gremlins: ${names}\nSource: ${dir}\n\nProject gremlins are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [
								{
									type: "text",
									text: "Canceled: project-local gremlins not approved.",
								},
							],
							details: makeDetails(
								hasChain ? "chain" : hasTasks ? "parallel" : "single",
							)([]),
						};
				}
			}

			if (params.tasks && params.tasks.length > MAX_PARALLEL_TASKS) {
				const details = makeDetails("parallel")([]);
				return {
					content: [
						{
							type: "text",
							text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
						},
					],
					details,
				};
			}

			latestToolCallId = toolCallId;
			updateInvocation(toolCallId, makeDetails(mode)([]), "Running");
			if (params.agent && params.task) {
				updateInvocation(
					toolCallId,
					makeDetails("single")([
						createPendingResult(
							params.agent,
							params.task,
							undefined,
							"unknown",
						),
					]),
					"Running",
				);
			}

			if (params.chain && params.chain.length > 0) {
				return finalizeResult(
					await executeChainMode({
						toolCallId,
						chain: params.chain,
						ctxCwd: ctx.cwd,
						agents,
						signal,
						runSingleAgent,
						handleInvocationUpdate,
						makeDetails,
						updateInvocation,
					}),
				);
			}

			if (params.tasks && params.tasks.length > 0) {
				return finalizeResult(
					await executeParallelMode({
						toolCallId,
						tasks: params.tasks,
						ctxCwd: ctx.cwd,
						agents,
						signal,
						runSingleAgent,
						handleInvocationUpdate,
						makeDetails,
						updateInvocation,
						maxConcurrency: MAX_CONCURRENCY,
						mapWithConcurrencyLimit,
					}),
				);
			}

			if (params.agent && params.task) {
				return finalizeResult(
					await executeSingleMode({
						toolCallId,
						agent: params.agent,
						task: params.task,
						cwd: params.cwd,
						ctxCwd: ctx.cwd,
						agents,
						signal,
						runSingleAgent,
						handleInvocationUpdate,
						makeDetails,
						updateInvocation,
					}),
				);
			}

			return {
				content: [
					{
						type: "text",
						text: `Invalid parameters. Available gremlins: ${formatAvailableAgents(agents)}\n${getAgentSetupHint()}`,
					},
				],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme, _context) {
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("pi-gremlins ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					// Clean up {previous} placeholder for display
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					const preview =
						cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", step.agent) +
						theme.fg("dim", ` ${preview}`);
				}
				if (args.chain.length > 3)
					text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("pi-gremlins ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of args.tasks.slice(0, 3)) {
					const preview =
						t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
					text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3)
					text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			const preview = args.task
				? args.task.length > 60
					? `${args.task.slice(0, 60)}...`
					: args.task
				: "...";
			let text =
				theme.fg("toolTitle", theme.bold("pi-gremlins ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, context) {
			return renderPiGremlinsResult(result, { expanded }, theme, context, {
				hasViewerSnapshot,
				formatToolCall,
			});
		},
	});

	pi.registerCommand("pi-gremlins:view", {
		description:
			"Open popup viewer for latest pi-gremlins run in this session.",
		handler: async (_args, ctx) => {
			await openViewer(ctx);
		},
	});
}
