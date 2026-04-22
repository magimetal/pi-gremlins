import { wrapTextWithAnsi } from "@mariozechner/pi-tui";
import {
	aggregateUsage,
	formatAgentSourceBadgeText,
	formatStatusBadgeText,
	formatViewerEntryTimestamp,
	getAgentSourceSemantics,
	getDerivedRenderData,
	getResultVisibleRevision,
	getSingleResultErrorText,
	getSingleResultStatus,
	getStatusTone,
	getUsageTelemetrySegments,
	type InvocationMode,
	type InvocationStatus,
	type SingleResult,
	type ViewerEntry,
} from "./execution-shared.js";
import type { InvocationSnapshot } from "./invocation-state.js";
import { getResultSummaryLine } from "./result-rendering.js";
import { formatToolCall } from "./tool-call-formatting.js";
import {
	buildSelectedResultBodyLines,
	normalizeViewerTabs,
} from "./viewer-result-navigation.js";

export const VIEWER_TITLE = "Gremlins🧌 mission control";

type ViewerTheme = {
	fg: (color: any, text: string) => string;
	bold: (text: string) => string;
};

export interface ViewerBodyCacheEntry {
	resultKey: string;
	revision: number;
	lines: string[];
}

export interface ViewerWrapCacheEntry {
	resultKey: string;
	revision: number;
	innerWidth: number;
	lines: string[];
}

function formatViewerStatusBadge(
	theme: ViewerTheme,
	status: InvocationStatus,
): string {
	return theme.fg(getStatusTone(status), formatStatusBadgeText(status));
}

function formatViewerSourceBadge(
	theme: ViewerTheme,
	result: SingleResult,
): string {
	return theme.fg("muted", formatAgentSourceBadgeText(result.agentSource));
}

function formatViewerEntryLabel(
	label: string,
	entry: Pick<ViewerEntry, "createdAt" | "updatedAt">,
): string {
	const timestamp = formatViewerEntryTimestamp(
		entry.updatedAt ?? entry.createdAt,
	);
	return timestamp ? `${timestamp} ${label}` : label;
}

function pushViewerTextBlock(
	lines: string[],
	theme: ViewerTheme,
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
	theme: ViewerTheme,
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
	theme: ViewerTheme,
): string[] {
	const derived = getDerivedRenderData(result);
	const finalOutput = derived.finalOutput.trim();
	if (finalOutput) {
		const lines: string[] = [];
		pushViewerTextBlock(lines, theme, "assistant", finalOutput, "toolOutput");
		return lines;
	}
	if (derived.displayItems.length > 0) {
		const summary = getResultSummaryLine(result, formatToolCall);
		return [theme.fg(summary.tone, `${summary.label} · ${summary.text}`)];
	}
	return buildViewerStateLines(result, status, theme);
}

function buildViewerEntryLines(
	entries: ViewerEntry[],
	theme: ViewerTheme,
): string[] {
	const lines: string[] = [];
	for (const entry of entries) {
		if (entry.type === "assistant-text") {
			pushViewerTextBlock(
				lines,
				theme,
				formatViewerEntryLabel("assistant", entry),
				entry.text.trim() || "Awaiting assistant output.",
				entry.streaming ? "warning" : "toolOutput",
				entry.streaming ? [theme.fg("warning", "[live]")] : [],
			);
			continue;
		}
		if (entry.type === "tool-call") {
			lines.push(
				theme.fg("muted", `${formatViewerEntryLabel("tool call", entry)} · `) +
					formatToolCall(entry.toolName, entry.args, theme.fg.bind(theme)),
			);
			continue;
		}
		if (entry.type === "steer") {
			const badges: string[] = [];
			if (entry.streaming) badges.push(theme.fg("warning", "[live]"));
			if (entry.isError) badges.push(theme.fg("error", "[error]"));
			let steerTone = "accent";
			if (entry.isError) steerTone = "error";
			else if (entry.streaming) steerTone = "warning";
			pushViewerTextBlock(
				lines,
				theme,
				formatViewerEntryLabel(entry.isError ? "steer error" : "steer", entry),
				entry.text,
				steerTone,
				badges,
			);
			continue;
		}
		if (entry.type !== "tool-result") continue;
		const badges: string[] = [];
		if (entry.streaming) badges.push(theme.fg("warning", "[live]"));
		if (entry.truncated) badges.push(theme.fg("muted", "[truncated]"));
		if (entry.isError) badges.push(theme.fg("error", "[error]"));
		const toolResultLabel = entry.isError ? "tool error" : "tool result";
		let toolResultTone = "dim";
		if (entry.isError) toolResultTone = "error";
		else if (entry.streaming) toolResultTone = "warning";
		pushViewerTextBlock(
			lines,
			theme,
			formatViewerEntryLabel(toolResultLabel, entry),
			entry.toolName,
			toolResultTone,
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
	theme: ViewerTheme,
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
		if (snapshot.status === "Running") {
			return [theme.fg("warning", "running · Awaiting first gremlin event.")];
		}
		return [theme.fg("muted", "quiet · No gremlin results recorded.")];
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

function getSelectedResultCacheState(
	snapshot: InvocationSnapshot | undefined,
	selectedResultIndex: number,
): { resultKey: string; revision: number } {
	if (!snapshot) {
		return { resultKey: `missing:${selectedResultIndex}`, revision: 0 };
	}
	if (snapshot.results.length === 0) {
		return {
			resultKey: `${snapshot.toolCallId}:empty:${snapshot.status}`,
			revision: snapshot.updatedAt,
		};
	}
	const resolvedResultIndex = Math.max(
		0,
		Math.min(selectedResultIndex, snapshot.results.length - 1),
	);
	const result = snapshot.results[resolvedResultIndex];
	return {
		resultKey: [
			snapshot.toolCallId,
			selectedResultIndex,
			result.gremlinId,
			result.agent,
			result.agentSource,
			result.task,
			result.step ?? "",
		].join(":"),
		revision: getResultVisibleRevision(result),
	};
}

export function buildViewerTitleLine(
	theme: ViewerTheme,
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

export function buildViewerMetadataLine(
	theme: ViewerTheme,
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
		theme.fg("muted", `· ${result.gremlinId}`),
	].join(" ");
}

export function buildViewerTelemetryLine(
	theme: ViewerTheme,
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
	let model: string | undefined;
	if (snapshot.results.length === 1) {
		model = selectedModel;
	} else if (models.length === 1) {
		model = models[0];
	} else if (selectedModel) {
		model = `${selectedModel} (focus)`;
	} else if (models.length > 1) {
		model = "mixed";
	}
	const segments = getUsageTelemetrySegments(usage, model);
	if (segments.length === 0) {
		return theme.fg("muted", "telemetry · idle");
	}
	return (
		theme.fg("muted", "telemetry · ") + theme.fg("dim", segments.join(" · "))
	);
}

export function buildViewerInvocationLine(
	theme: ViewerTheme,
	toolCallId: string | undefined,
): string {
	return (
		theme.fg("muted", "invocation · ") +
		theme.fg("dim", toolCallId ?? "(missing)")
	);
}

export function getCachedInvocationBodyLines(
	cache: ViewerBodyCacheEntry | null,
	snapshot: InvocationSnapshot | undefined,
	selectedResultIndex: number,
	theme: ViewerTheme,
): { cache: ViewerBodyCacheEntry; lines: string[]; cacheHit: boolean } {
	const cacheState = getSelectedResultCacheState(snapshot, selectedResultIndex);
	if (
		cache &&
		cache.resultKey === cacheState.resultKey &&
		cache.revision === cacheState.revision
	) {
		return { cache, lines: cache.lines, cacheHit: true };
	}
	const lines = buildInvocationBodyLines(snapshot, selectedResultIndex, theme);
	return {
		cache: {
			resultKey: cacheState.resultKey,
			revision: cacheState.revision,
			lines,
		},
		lines,
		cacheHit: false,
	};
}

export function getCachedWrappedBodyLines(
	cache: ViewerWrapCacheEntry | null,
	bodyCache: ViewerBodyCacheEntry,
	innerWidth: number,
): { cache: ViewerWrapCacheEntry; lines: string[]; cacheHit: boolean } {
	if (
		cache &&
		cache.resultKey === bodyCache.resultKey &&
		cache.revision === bodyCache.revision &&
		cache.innerWidth === innerWidth
	) {
		return { cache, lines: cache.lines, cacheHit: true };
	}
	const lines: string[] = [];
	for (const line of bodyCache.lines) {
		if (!line) {
			lines.push("");
			continue;
		}
		lines.push(
			...wrapTextWithAnsi(normalizeViewerTabs(line), Math.max(1, innerWidth)),
		);
	}
	return {
		cache: {
			resultKey: bodyCache.resultKey,
			revision: bodyCache.revision,
			innerWidth,
			lines,
		},
		lines,
		cacheHit: false,
	};
}
