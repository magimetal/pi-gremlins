import type {
	GremlinActivity,
	GremlinActivityKind,
	GremlinInvocationDetails,
	GremlinInvocationEntry,
	GremlinUsage,
} from "./gremlin-schema.js";

const ENTRY_CACHE_LIMIT = 256;
const COLLAPSED_PREVIEW_LIMIT = 96;
const COLLAPSED_CONTEXT_LINE_LIMIT = 3;
const COLLAPSED_ACTIVITY_LINE_LIMIT = 3;
const collapsedLinesCache = new Map<string, string[]>();
const expandedLinesCache = new Map<string, string[]>();

function normalizeText(value?: string): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function normalizePreviewText(value?: string): string | undefined {
	const normalized = normalizeText(value)?.replace(/\s+/g, " ");
	if (!normalized) return undefined;
	if (normalized.length <= COLLAPSED_PREVIEW_LIMIT) return normalized;
	return `${normalized.slice(0, COLLAPSED_PREVIEW_LIMIT - 1).trimEnd()}…`;
}

function pushCacheEntry<T>(cache: Map<string, T>, key: string, value: T): T {
	cache.set(key, value);
	if (cache.size <= ENTRY_CACHE_LIMIT) return value;
	const firstKey = cache.keys().next().value;
	if (typeof firstKey === "string") cache.delete(firstKey);
	return value;
}

function hashString(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function createTextCacheToken(value?: string): string {
	if (!value) return "";
	return `${value.length}:${hashString(value)}`;
}

function createUsageCacheToken(usage?: GremlinUsage): string {
	if (!usage) return "";
	return [
		usage.turns,
		usage.input,
		usage.output,
		usage.cacheRead ?? "",
		usage.cacheWrite ?? "",
		usage.contextTokens ?? "",
		usage.cost ?? "",
	].join(":");
}

function createActivityCacheToken(activity: GremlinActivity): string {
	return [
		activity.kind,
		createTextCacheToken(activity.phase),
		createTextCacheToken(activity.text),
		activity.sequence ?? "",
		activity.timestamp ?? "",
	].join(":");
}

function createActivitiesCacheToken(activities?: GremlinActivity[]): string {
	return activities?.map(createActivityCacheToken).join("\u001e") ?? "";
}

export function createEntryCacheKey(
	prefix: string,
	entry: GremlinInvocationEntry,
): string {
	return [
		prefix,
		createTextCacheToken(entry.gremlinId),
		String(entry.revision ?? ""),
		createTextCacheToken(entry.agent),
		entry.source,
		entry.status,
		createTextCacheToken(entry.intent),
		createTextCacheToken(entry.context),
		createTextCacheToken(entry.cwd),
		createTextCacheToken(entry.model),
		createTextCacheToken(entry.thinking),
		createTextCacheToken(entry.currentPhase),
		createTextCacheToken(entry.latestText),
		createTextCacheToken(entry.latestToolCall),
		createTextCacheToken(entry.latestToolResult),
		createTextCacheToken(entry.errorMessage),
		createActivitiesCacheToken(entry.activities),
		entry.startedAt ? String(entry.startedAt) : "",
		entry.finishedAt ? String(entry.finishedAt) : "",
		createUsageCacheToken(entry.usage),
	].join("\u001f");
}

function dedupeParts(parts: Array<string | undefined>): string[] {
	const lines: string[] = [];
	for (const part of parts) {
		if (!part) continue;
		if (lines.includes(part)) continue;
		lines.push(part);
	}
	return lines;
}

export function formatGremlinStatus(status: GremlinInvocationEntry["status"]): string {
	switch (status) {
		case "queued":
			return "Queued";
		case "starting":
			return "Starting";
		case "active":
			return "Active";
		case "completed":
			return "Completed";
		case "failed":
			return "Failed";
		case "canceled":
			return "Canceled";
	}
}

export function formatUsageSummary(usage?: GremlinUsage): string {
	if (!usage) return "";
	const parts = [
		`turns:${usage.turns}`,
		`input:${usage.input}`,
		`output:${usage.output}`,
	];
	if (typeof usage.cacheRead === "number") parts.push(`cacheRead:${usage.cacheRead}`);
	if (typeof usage.cacheWrite === "number") {
		parts.push(`cacheWrite:${usage.cacheWrite}`);
	}
	if (typeof usage.contextTokens === "number") parts.push(`context:${usage.contextTokens}`);
	if (typeof usage.cost === "number") parts.push(`cost:${usage.cost}`);
	return parts.join(" · ");
}

export function formatGremlinIdentity(entry: GremlinInvocationEntry): string {
	return dedupeParts([
		normalizeText(entry.gremlinId),
		normalizeText(entry.agent),
		normalizeText(entry.source) ? `[${entry.source}]` : undefined,
	]).join(" ");
}

interface GremlinActivityPreview {
	kind: GremlinActivityKind;
	phase?: string;
	text: string;
}

function normalizeActivityPreview(
	activity: GremlinActivity,
): GremlinActivityPreview | undefined {
	const text = normalizePreviewText(activity.text);
	if (!text) return undefined;
	return {
		kind: activity.kind,
		phase: normalizePreviewText(activity.phase),
		text,
	};
}

function getFallbackActivityPreviews(
	entry: GremlinInvocationEntry,
): GremlinActivityPreview[] {
	const phase = normalizePreviewText(entry.currentPhase);
	const latestText = normalizePreviewText(entry.latestText);
	const latestToolCall = normalizePreviewText(entry.latestToolCall);
	const latestToolResult = normalizePreviewText(entry.latestToolResult);
	const errorMessage = normalizePreviewText(entry.errorMessage);
	const context = normalizePreviewText(entry.context);
	const previews: GremlinActivityPreview[] = [];

	if (errorMessage && (entry.status === "failed" || entry.status === "canceled")) {
		previews.push({ kind: "error", phase, text: errorMessage });
	}
	if (latestText && latestText !== context) {
		previews.push({ kind: "text", phase, text: latestText });
	}
	if (latestToolCall) {
		previews.push({ kind: "tool-call", phase, text: latestToolCall });
	}
	if (latestToolResult) {
		previews.push({ kind: "tool-result", phase, text: latestToolResult });
	}
	if (context && previews.length === 0) {
		previews.push({ kind: "task", phase, text: context });
	}
	if (previews.length === 0) {
		previews.push({ kind: "idle", phase, text: "idle" });
	}
	return previews;
}

function getRecentActivityPreviews(
	entry: GremlinInvocationEntry,
): GremlinActivityPreview[] {
	const activityPreviews = (entry.activities ?? [])
		.map(normalizeActivityPreview)
		.filter((preview): preview is GremlinActivityPreview => Boolean(preview));
	if (activityPreviews.length > 0) {
		return activityPreviews.slice(-COLLAPSED_ACTIVITY_LINE_LIMIT);
	}
	return getFallbackActivityPreviews(entry).slice(0, COLLAPSED_ACTIVITY_LINE_LIMIT);
}

function getActivityLabel(kind: GremlinActivityKind): string {
	switch (kind) {
		case "error":
			return "error";
		case "tool-call":
			return "tool call";
		case "tool-result":
			return "tool result";
		case "text":
			return "latest";
		case "task":
			return "task";
		case "idle":
			return "idle";
	}
}

function formatActivityPreviewLine(preview: GremlinActivityPreview): string {
	return dedupeParts([getActivityLabel(preview.kind), preview.phase, preview.text]).join(" · ");
}

function formatContextPreviewLines(context: string): string[] {
	return context
		.split(/\r?\n/)
		.map((line) => normalizePreviewText(line))
		.filter((line): line is string => Boolean(line))
		.slice(0, COLLAPSED_CONTEXT_LINE_LIMIT)
		.map((line) => `task · ${line}`);
}

function formatIntentPreviewLine(intent?: string): string | undefined {
	const preview = normalizePreviewText(intent);
	return preview ? `intent · ${preview}` : undefined;
}

export function formatBatchHeadline(details: GremlinInvocationDetails): string {
	return [
		"Gremlins🧌",
		`requested:${details.requestedCount}`,
		`active:${details.activeCount}`,
		`completed:${details.completedCount}`,
		`failed:${details.failedCount}`,
		`canceled:${details.canceledCount}`,
	].join(" · ");
}

export function formatCollapsedGremlinLines(entry: GremlinInvocationEntry): string[] {
	const cacheKey = createEntryCacheKey("collapsed", entry);
	const cached = collapsedLinesCache.get(cacheKey);
	if (cached) return cached;

	const lines = [`[${formatGremlinStatus(entry.status)}] · ${formatGremlinIdentity(entry)}`];
	const intentLine = formatIntentPreviewLine(entry.intent);
	if (intentLine) lines.push(intentLine);
	lines.push(...formatContextPreviewLines(entry.context));
	lines.push(...getRecentActivityPreviews(entry).map(formatActivityPreviewLine));
	const usage = formatUsageSummary(entry.usage);
	if (usage) lines.push(`usage · ${usage}`);

	return pushCacheEntry(collapsedLinesCache, cacheKey, lines);
}

export function formatExpandedGremlinLines(entry: GremlinInvocationEntry): string[] {
	const cacheKey = createEntryCacheKey("expanded", entry);
	const cached = expandedLinesCache.get(cacheKey);
	if (cached) return cached;

	const lines = [
		`[${formatGremlinStatus(entry.status)}] ${formatGremlinIdentity(entry)}`,
		...dedupeParts([formatIntentPreviewLine(entry.intent)]),
		`task · ${entry.context}`,
	];
	const metaLines = dedupeParts([
		normalizeText(entry.cwd) ? `cwd · ${entry.cwd}` : undefined,
		normalizeText(entry.model) ? `model · ${entry.model}` : undefined,
		normalizeText(entry.thinking) ? `thinking · ${entry.thinking}` : undefined,
		normalizeText(entry.currentPhase) ? `phase · ${entry.currentPhase}` : undefined,
		normalizeText(entry.latestText) ? `latest · ${entry.latestText}` : undefined,
		normalizeText(entry.latestToolCall)
			? `tool call · ${entry.latestToolCall}`
			: undefined,
		normalizeText(entry.latestToolResult)
			? `tool result · ${entry.latestToolResult}`
			: undefined,
		normalizeText(entry.errorMessage) ? `error · ${entry.errorMessage}` : undefined,
	]);
	lines.push(...metaLines);
	const usage = formatUsageSummary(entry.usage);
	if (usage) lines.push(`usage · ${usage}`);

	return pushCacheEntry(expandedLinesCache, cacheKey, lines);
}
