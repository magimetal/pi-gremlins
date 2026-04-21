import { Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import {
	aggregateUsage,
	type DisplayItem,
	formatAgentSourceBadgeText,
	formatStatusBadgeText,
	formatUsageStats,
	getAgentSourceSemantics,
	getDerivedRenderData,
	getInvocationSemantics,
	getSingleResultSemantics,
	getStatusTone,
	type InvocationStatus,
	type PiGremlinsDetails,
	type SingleResult,
} from "./execution-shared.js";

const COLLAPSED_CHILD_COUNT = 4;
const COLLAPSED_EVENT_COUNT = 3;
const DIGEST_MAX_LENGTH = 88;
const VIEWER_HINT_VARIANTS = [
	"viewer · /pi-gremlins:view opens mission control.",
	"viewer · /pi-gremlins:view opens viewer.",
	"viewer · /pi-gremlins:view",
] as const;
const EXPAND_HINT_VARIANTS = [
	"Ctrl+O expands embedded view.",
	"Ctrl+O expands view.",
	"Ctrl+O expands.",
	"Ctrl+O",
] as const;
const WAITING_TEXT = "Waiting for first event.";
const NO_OUTPUT_TEXT = "No output captured.";

type LiveStage = "active" | "pending" | "terminal";

type DigestEntry =
	| { kind: "assistant"; text: string; streaming: boolean }
	| {
			kind: "toolCall";
			text: string;
			toolName: string;
			toolCallId?: string;
	  }
	| {
			kind: "toolResult";
			text: string;
			streaming: boolean;
			isError: boolean;
			toolCallId?: string;
	  };

interface RenderTheme {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
}

interface RenderContext {
	toolCallId?: string;
	width?: number;
	columns?: number;
}

interface RenderResultLike {
	content: Array<{ type?: string; text?: string }>;
	details?: unknown;
}

interface RenderDependencies {
	hasViewerSnapshot: (toolCallId: string | undefined) => boolean;
	formatToolCall: (
		toolName: string,
		args: Record<string, unknown>,
		themeFg: (color: string, text: string) => string,
	) => string;
}

function getRenderWidth(context: RenderContext): number | null {
	const candidate =
		typeof context.width === "number"
			? context.width
			: typeof context.columns === "number"
				? context.columns
				: null;
	return candidate && Number.isFinite(candidate)
		? Math.max(12, Math.floor(candidate))
		: null;
}

function fitsWidth(text: string, width: number | null): boolean {
	return width === null || visibleWidth(text) <= width;
}

function truncateLine(
	text: string,
	width: number,
	suffix: string = "…",
): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	const attempted = truncateToWidth(text, width, suffix);
	if (visibleWidth(attempted) <= width) return attempted;
	if (width <= visibleWidth(suffix)) {
		return suffix.slice(0, width);
	}
	const budget = Math.max(0, width - visibleWidth(suffix));
	return `${text.slice(0, budget).trimEnd()}${suffix}`;
}

function clampLine(text: string, width: number | null): string {
	return width === null ? text : truncateLine(text, width);
}

function pickLineVariant(
	width: number | null,
	variants: readonly string[],
): string {
	for (const variant of variants) {
		if (variant && fitsWidth(variant, width)) return variant;
	}
	return clampLine(variants.at(-1) ?? "", width);
}

function fitMiddleLine(
	prefix: string,
	middle: string,
	suffix: string,
	width: number | null,
): string {
	const full = `${prefix}${middle}${suffix}`;
	if (fitsWidth(full, width)) return full;
	if (width === null) return full;
	const prefixWidth = visibleWidth(prefix);
	const suffixWidth = visibleWidth(suffix);
	if (prefixWidth + suffixWidth < width) {
		const middleWidth = Math.max(1, width - prefixWidth - suffixWidth);
		return `${prefix}${truncateLine(middle, middleWidth)}${suffix}`;
	}
	if (prefixWidth < width) {
		const middleWidth = Math.max(1, width - prefixWidth);
		return `${prefix}${truncateLine(middle, middleWidth)}`;
	}
	return truncateLine(prefix, width);
}

function createViewerHint(
	theme: RenderTheme,
	context: RenderContext,
	hasViewerSnapshot: (toolCallId: string | undefined) => boolean,
): string | null {
	if (!hasViewerSnapshot(context.toolCallId)) return null;
	return theme.fg(
		"muted",
		pickLineVariant(getRenderWidth(context), VIEWER_HINT_VARIANTS),
	);
}

function isPiGremlinsDetails(value: unknown): value is PiGremlinsDetails {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<PiGremlinsDetails>;
	return (
		(candidate.mode === "single" ||
			candidate.mode === "parallel" ||
			candidate.mode === "chain") &&
		Array.isArray(candidate.results) &&
		("agentScope" in candidate || candidate.agentScope === undefined) &&
		"projectAgentsDir" in candidate
	);
}

function appendHintText(text: string, viewerHint: string | null): string {
	return viewerHint ? `${text}\n${viewerHint}` : text;
}

function formatStatusBadge(
	theme: RenderTheme,
	status: ReturnType<typeof getSingleResultSemantics>,
): string {
	return theme.fg(
		getStatusTone(status.status),
		formatStatusBadgeText(status.status),
	);
}

function formatInvocationBadge(
	theme: RenderTheme,
	status: ReturnType<typeof getInvocationSemantics>,
): string {
	return theme.fg(
		getStatusTone(status.status),
		formatStatusBadgeText(status.status),
	);
}

function formatLabelLine(
	theme: RenderTheme,
	label: string,
	text: string,
	tone: string = "dim",
	width: number | null = null,
): string {
	const prefix = theme.fg("muted", `${label} · `);
	if (width === null) {
		return `${prefix}${theme.fg(tone, text)}`;
	}
	const prefixWidth = visibleWidth(prefix);
	if (prefixWidth >= width) {
		return truncateLine(prefix, width);
	}
	const available = Math.max(1, width - prefixWidth);
	return `${prefix}${theme.fg(tone, truncateLine(text, available))}`;
}

function normalizeInlineText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function summarizeInlineText(
	text: string,
	maxLength: number = DIGEST_MAX_LENGTH,
): string {
	const normalized = normalizeInlineText(text);
	if (!normalized) return "";
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function createPlainFg(): (color: string, text: string) => string {
	return (_color: string, text: string) => text;
}

function getSourceBadge(theme: RenderTheme, result: SingleResult): string {
	return theme.fg("muted", formatAgentSourceBadgeText(result.agentSource));
}

function formatSingleHeader(
	theme: RenderTheme,
	result: SingleResult,
	modeLabel: string,
	width: number | null,
): string {
	const status = getSingleResultSemantics(result);
	const sourceBadge = getSourceBadge(theme, result);
	const full = [
		theme.fg(getStatusTone(status.status), status.icon),
		formatStatusBadge(theme, status),
		theme.fg("toolTitle", theme.bold(result.agent)),
		theme.fg("muted", `· ${modeLabel} ·`),
		sourceBadge,
	].join(" ");
	const compact = fitMiddleLine(
		`${formatStatusBadge(theme, status)} `,
		`${theme.fg("toolTitle", theme.bold(result.agent))}${theme.fg("muted", ` · ${modeLabel}`)}`,
		` ${sourceBadge}`,
		width,
	);
	return pickLineVariant(width, [full, compact]);
}

function formatInvocationHeader(
	theme: RenderTheme,
	modeLabel: string,
	detailSummary: string,
	status: ReturnType<typeof getInvocationSemantics>,
	width: number | null,
): string {
	const full = [
		theme.fg(getStatusTone(status.status), status.icon),
		formatInvocationBadge(theme, status),
		theme.fg("toolTitle", theme.bold(modeLabel)),
		detailSummary ? theme.fg("accent", detailSummary) : "",
	]
		.filter(Boolean)
		.join(" ");
	const compact = fitMiddleLine(
		`${formatInvocationBadge(theme, status)} `,
		`${theme.fg("toolTitle", theme.bold(modeLabel))}${detailSummary ? theme.fg("accent", ` ${detailSummary}`) : ""}`,
		"",
		width,
	);
	return pickLineVariant(width, [full, compact]);
}

function buildDigestEntries(
	items: DisplayItem[],
	formatToolCall: RenderDependencies["formatToolCall"],
): DigestEntry[] {
	const entries: DigestEntry[] = [];
	const plainFg = createPlainFg();

	const findPendingToolCallIndex = (
		toolName: string,
		toolCallId?: string,
	): number => {
		if (toolCallId) {
			return entries.findIndex(
				(entry) => entry.kind === "toolCall" && entry.toolCallId === toolCallId,
			);
		}
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const entry = entries[index];
			if (entry.kind === "toolCall" && entry.toolName === toolName) {
				return index;
			}
		}
		return -1;
	};

	for (const item of items) {
		if (item.type === "text") {
			const summary = summarizeInlineText(item.text);
			if (summary) {
				entries.push({
					kind: "assistant",
					text: summary,
					streaming: Boolean(item.streaming),
				});
			}
			continue;
		}

		if (item.type === "toolCall") {
			entries.push({
				kind: "toolCall",
				text: summarizeInlineText(
					formatToolCall(item.name, item.args, plainFg),
				),
				toolName: item.name,
				toolCallId: item.toolCallId,
			});
			continue;
		}

		const summary = summarizeInlineText(item.content);
		const pendingIndex = findPendingToolCallIndex(
			item.toolName,
			item.toolCallId,
		);
		if (pendingIndex !== -1) {
			const pending = entries[pendingIndex];
			if (pending?.kind === "toolCall") {
				entries[pendingIndex] = {
					kind: "toolResult",
					text: summary
						? `${pending.text} → ${summary}`
						: `${pending.text} → (no tool output)`,
					streaming: item.streaming,
					isError: item.isError,
					toolCallId: item.toolCallId,
				};
				continue;
			}
		}
		entries.push({
			kind: "toolResult",
			text: summary
				? `${item.toolName} → ${summary}`
				: `${item.toolName} → (no tool output)`,
			streaming: item.streaming,
			isError: item.isError,
			toolCallId: item.toolCallId,
		});
	}

	return entries;
}

function getLiveStage(result: SingleResult): LiveStage {
	const status = getSingleResultSemantics(result);
	if (status.status !== "Running") return "terminal";
	const derived = getDerivedRenderData(result);
	if (
		derived.displayItems.length > 0 ||
		result.stderr.trim() ||
		result.errorMessage
	) {
		return "active";
	}
	return "pending";
}

function createExpandHint(theme: RenderTheme, width: number | null): string {
	return theme.fg("muted", pickLineVariant(width, EXPAND_HINT_VARIANTS));
}

function createOverflowHint(
	theme: RenderTheme,
	width: number | null,
	remaining: number,
	kind: "steps" | "results",
): string {
	return theme.fg(
		"muted",
		pickLineVariant(width, [
			`… ${remaining} more ${kind} · Ctrl+O to expand`,
			`… ${remaining} more ${kind} · Ctrl+O`,
			`… +${remaining} ${kind} · Ctrl+O`,
			`… +${remaining} · Ctrl+O`,
		]),
	);
}

function describeDigestEntry(
	entry: DigestEntry,
	status: InvocationStatus,
): {
	label: string;
	text: string;
	tone: string;
} {
	if (entry.kind === "assistant") {
		return {
			label: entry.streaming ? "live" : "digest",
			text: entry.text,
			tone: entry.streaming ? "warning" : "toolOutput",
		};
	}
	if (entry.kind === "toolCall") {
		if (status !== "Running") {
			return {
				label: "tool call",
				text: entry.text,
				tone:
					status === "Failed"
						? "error"
						: status === "Canceled"
							? "warning"
							: "dim",
			};
		}
		return {
			label: "active tool",
			text: `${entry.text} → waiting`,
			tone: "warning",
		};
	}
	if (entry.isError) {
		return { label: "error tool", text: entry.text, tone: "error" };
	}
	if (entry.streaming) {
		return { label: "active tool", text: entry.text, tone: "warning" };
	}
	return { label: "tool", text: entry.text, tone: "dim" };
}

export function getResultSummaryLine(
	result: SingleResult,
	formatToolCall: RenderDependencies["formatToolCall"],
): { label: string; text: string; tone: string } {
	const status = getSingleResultSemantics(result);
	const digestEntries = buildDigestEntries(
		getDerivedRenderData(result).displayItems,
		formatToolCall,
	);

	if (status.status === "Failed") {
		if (result.errorMessage) {
			return {
				label: "error",
				text: summarizeInlineText(result.errorMessage),
				tone: "error",
			};
		}
		if (result.stderr.trim()) {
			return {
				label: "stderr",
				text: summarizeInlineText(result.stderr),
				tone: "error",
			};
		}
	}

	if (status.status === "Canceled") {
		return {
			label: "canceled",
			text: summarizeInlineText(
				result.errorMessage || "Run canceled before output.",
			),
			tone: "warning",
		};
	}

	if (status.status === "Running") {
		const liveStage = getLiveStage(result);
		if (digestEntries.length === 0) {
			return {
				label: liveStage === "pending" ? "pending" : "active",
				text:
					summarizeInlineText(result.task) ||
					(liveStage === "pending" ? WAITING_TEXT : "Live output updating."),
				tone: liveStage === "pending" ? "muted" : "warning",
			};
		}
		const described = describeDigestEntry(digestEntries.at(-1), status.status);
		if (liveStage === "pending") {
			return {
				label: "pending",
				text: summarizeInlineText(result.task) || WAITING_TEXT,
				tone: "muted",
			};
		}
		return {
			label: described.label === "digest" ? "active" : described.label,
			text: described.text,
			tone: described.tone,
		};
	}

	if (digestEntries.length === 0) {
		return {
			label: "quiet",
			text: NO_OUTPUT_TEXT,
			tone: "muted",
		};
	}

	return describeDigestEntry(digestEntries.at(-1), status.status);
}

function buildResultTraceLines(
	result: SingleResult,
	theme: RenderTheme,
	formatToolCall: RenderDependencies["formatToolCall"],
	limit: number | undefined,
	width: number | null,
): string[] {
	const digestEntries = buildDigestEntries(
		getDerivedRenderData(result).displayItems,
		formatToolCall,
	);
	const status = getSingleResultSemantics(result).status;
	if (digestEntries.length === 0) {
		return [];
	}
	const toShow = limit ? digestEntries.slice(-limit) : digestEntries;
	const skipped =
		limit && digestEntries.length > limit ? digestEntries.length - limit : 0;
	const lines: string[] = [];
	if (skipped > 0) {
		lines.push(
			theme.fg(
				"muted",
				pickLineVariant(width, [
					`… ${skipped} earlier events`,
					`… +${skipped} earlier`,
				]),
			),
		);
	}
	for (const entry of toShow) {
		const described = describeDigestEntry(entry, status);
		lines.push(
			formatLabelLine(
				theme,
				described.label,
				described.text,
				described.tone,
				width,
			),
		);
	}
	return lines;
}

function buildUsageLine(
	theme: RenderTheme,
	usage: SingleResult["usage"],
	model?: string,
	label: string = "usage",
	width: number | null = null,
): string | null {
	const usageText = formatUsageStats(usage, model);
	if (!usageText) return null;
	return formatLabelLine(theme, label, usageText, "dim", width);
}

function buildSingleView(
	result: SingleResult,
	theme: RenderTheme,
	viewerHint: string | null,
	formatToolCall: RenderDependencies["formatToolCall"],
	{ expanded, width }: { expanded: boolean; width: number | null },
): Text {
	const status = getSingleResultSemantics(result);
	const source = getAgentSourceSemantics(result.agentSource);
	const summary = getResultSummaryLine(result, formatToolCall);
	const summaryLine = formatLabelLine(
		theme,
		summary.label,
		summary.text,
		summary.tone,
		width,
	);
	const digestEntries = buildDigestEntries(
		getDerivedRenderData(result).displayItems,
		formatToolCall,
	);
	const lines = [formatSingleHeader(theme, result, "single", width)];

	lines.push(
		formatLabelLine(
			theme,
			"task",
			summarizeInlineText(result.task),
			"dim",
			width,
		),
	);
	if (result.agentSource !== "user") {
		lines.push(
			formatLabelLine(theme, "trust", source.trustLabel, "dim", width),
		);
	}
	if (
		result.errorMessage &&
		status.status !== "Running" &&
		summary.text !== summarizeInlineText(result.errorMessage)
	) {
		lines.push(
			formatLabelLine(
				theme,
				status.status === "Canceled" ? "canceled" : "error",
				summarizeInlineText(result.errorMessage),
				status.status === "Canceled" ? "warning" : "error",
				width,
			),
		);
	}
	lines.push(summaryLine);

	const traceLines = buildResultTraceLines(
		result,
		theme,
		formatToolCall,
		expanded ? undefined : COLLAPSED_EVENT_COUNT,
		width,
	);
	if (traceLines.length > 0) {
		for (const traceLine of traceLines) {
			if (traceLine === summaryLine) continue;
			lines.push(traceLine);
		}
	}
	if (!expanded && digestEntries.length > COLLAPSED_EVENT_COUNT) {
		lines.push(createExpandHint(theme, width));
	}

	const usageLine = buildUsageLine(
		theme,
		result.usage,
		result.model,
		"usage",
		width,
	);
	if (usageLine) lines.push(usageLine);

	return new Text(appendHintText(lines.join("\n"), viewerHint), 0, 0);
}

function buildModeSummary(results: SingleResult[]): string {
	const completed = results.filter(
		(result) => getSingleResultSemantics(result).status === "Completed",
	).length;
	const failed = results.filter(
		(result) => getSingleResultSemantics(result).status === "Failed",
	).length;
	const canceled = results.filter(
		(result) => getSingleResultSemantics(result).status === "Canceled",
	).length;
	const active = results.filter(
		(result) => getLiveStage(result) === "active",
	).length;
	const pending = results.filter(
		(result) => getLiveStage(result) === "pending",
	).length;
	const parts: string[] = [];
	if (completed > 0) parts.push(`${completed} done`);
	if (failed > 0) parts.push(`${failed} failed`);
	if (canceled > 0) parts.push(`${canceled} canceled`);
	if (active > 0) parts.push(`${active} live`);
	if (pending > 0) parts.push(`${pending} pending`);
	return parts.join(" · ") || `0/${results.length} done`;
}

function getChainSummary(results: SingleResult[]): string {
	const active = results.find((result) => getLiveStage(result) === "active");
	const prefix = active?.step ? `step ${active.step}` : null;
	const summary = buildModeSummary(results);
	return prefix ? `${prefix} · ${summary}` : summary;
}

function getParallelSummary(results: SingleResult[]): string {
	return buildModeSummary(results);
}

function buildActiveOverviewLine(
	results: SingleResult[],
	theme: RenderTheme,
	formatToolCall: RenderDependencies["formatToolCall"],
	width: number | null,
): string | null {
	const activeResult = results.find(
		(result) => getLiveStage(result) === "active",
	);
	const pendingResult = results.find(
		(result) => getLiveStage(result) === "pending",
	);
	const target = activeResult || pendingResult;
	if (!target) return null;
	const summary = getResultSummaryLine(target, formatToolCall);
	const identity = target.step
		? `step ${target.step} ${target.agent}`
		: target.agent;
	return formatLabelLine(
		theme,
		"active",
		`${identity} · ${summary.text}`,
		summary.tone,
		width,
	);
}

function buildChildRow(
	result: SingleResult,
	theme: RenderTheme,
	formatToolCall: RenderDependencies["formatToolCall"],
	{
		expanded,
		kind,
		width,
	}: {
		expanded: boolean;
		kind: "step" | "task";
		width: number | null;
	},
): string[] {
	const status = getSingleResultSemantics(result);
	const summary = getResultSummaryLine(result, formatToolCall);
	const liveStage = getLiveStage(result);
	const sourceBadge = getSourceBadge(theme, result);
	const marker =
		liveStage === "active"
			? theme.fg("warning", "▶")
			: liveStage === "pending"
				? theme.fg("muted", "○")
				: theme.fg(status.isError ? "error" : "muted", "•");
	const identity =
		kind === "step"
			? `step ${result.step ?? "?"} · ${result.agent}`
			: result.agent;
	const lines = [
		fitMiddleLine(
			`${marker} ${formatStatusBadge(theme, status)} `,
			theme.fg("accent", identity),
			` ${sourceBadge}`,
			width,
		),
		formatLabelLine(theme, summary.label, summary.text, summary.tone, width),
	];

	if (expanded) {
		lines.push(
			formatLabelLine(
				theme,
				"task",
				summarizeInlineText(result.task),
				"dim",
				width,
			),
		);
		const usageLine = buildUsageLine(
			theme,
			result.usage,
			result.model,
			"usage",
			width,
		);
		if (usageLine) lines.push(usageLine);
		for (const traceLine of buildResultTraceLines(
			result,
			theme,
			formatToolCall,
			undefined,
			width,
		)) {
			if (traceLine === lines[1]) continue;
			lines.push(traceLine);
		}
	}

	return lines;
}

function buildCollectionView(
	mode: "chain" | "parallel",
	results: SingleResult[],
	theme: RenderTheme,
	viewerHint: string | null,
	formatToolCall: RenderDependencies["formatToolCall"],
	{ expanded, width }: { expanded: boolean; width: number | null },
): Text {
	const invocationStatus = getInvocationSemantics(mode, results);
	const lines = [
		formatInvocationHeader(
			theme,
			mode,
			mode === "chain" ? getChainSummary(results) : getParallelSummary(results),
			invocationStatus,
			width,
		),
	];
	const activeLine = buildActiveOverviewLine(
		results,
		theme,
		formatToolCall,
		width,
	);
	if (activeLine) lines.push(activeLine);

	const visibleResults = expanded
		? results
		: results.slice(0, COLLAPSED_CHILD_COUNT);
	for (const result of visibleResults) {
		lines.push("");
		lines.push(
			...buildChildRow(result, theme, formatToolCall, {
				expanded,
				kind: mode === "chain" ? "step" : "task",
				width,
			}),
		);
	}

	if (!expanded && results.length > COLLAPSED_CHILD_COUNT) {
		lines.push("");
		lines.push(
			createOverflowHint(
				theme,
				width,
				results.length - COLLAPSED_CHILD_COUNT,
				mode === "chain" ? "steps" : "results",
			),
		);
	} else if (!expanded) {
		lines.push("");
		lines.push(createExpandHint(theme, width));
	}

	const usageLine = buildUsageLine(
		theme,
		aggregateUsage(results),
		undefined,
		"usage total",
		width,
	);
	if (usageLine) {
		lines.push("");
		lines.push(usageLine);
	}

	return new Text(appendHintText(lines.join("\n"), viewerHint), 0, 0);
}

export function renderPiGremlinsResult(
	result: RenderResultLike,
	{ expanded }: { expanded: boolean },
	theme: RenderTheme,
	context: RenderContext,
	{ hasViewerSnapshot, formatToolCall }: RenderDependencies,
) {
	const details = isPiGremlinsDetails(result.details)
		? result.details
		: undefined;
	if (!details || details.results.length === 0) {
		const text = result.content[0];
		return new Text(
			text?.type === "text" ? (text.text ?? "(no output)") : "(no output)",
			0,
			0,
		);
	}

	const width = getRenderWidth(context);
	const viewerHint = createViewerHint(theme, context, hasViewerSnapshot);

	if (details.mode === "single" && details.results.length === 1) {
		return buildSingleView(
			details.results[0],
			theme,
			viewerHint,
			formatToolCall,
			{ expanded, width },
		);
	}

	if (details.mode === "chain") {
		return buildCollectionView(
			"chain",
			details.results,
			theme,
			viewerHint,
			formatToolCall,
			{ expanded, width },
		);
	}

	if (details.mode === "parallel") {
		return buildCollectionView(
			"parallel",
			details.results,
			theme,
			viewerHint,
			formatToolCall,
			{ expanded, width },
		);
	}

	const text = result.content[0];
	return new Text(
		text?.type === "text" ? (text.text ?? "(no output)") : "(no output)",
		0,
		0,
	);
}
