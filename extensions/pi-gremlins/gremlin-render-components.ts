import type {
	GremlinInvocationDetails,
	GremlinInvocationEntry,
	GremlinUsage,
} from "./gremlin-schema.js";

const ENTRY_CACHE_LIMIT = 256;
const collapsedLineCache = new Map<string, string>();
const expandedLinesCache = new Map<string, string[]>();

function normalizeText(value?: string): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function pushCacheEntry<T>(cache: Map<string, T>, key: string, value: T): T {
	cache.set(key, value);
	if (cache.size <= ENTRY_CACHE_LIMIT) return value;
	const firstKey = cache.keys().next().value;
	if (typeof firstKey === "string") cache.delete(firstKey);
	return value;
}

function createEntryCacheKey(prefix: string, entry: GremlinInvocationEntry): string {
	return [
		prefix,
		entry.gremlinId ?? "",
		String(entry.revision ?? ""),
		entry.agent,
		entry.source,
		entry.status,
		entry.context,
		entry.cwd ?? "",
		entry.model ?? "",
		entry.thinking ?? "",
		entry.currentPhase ?? "",
		entry.latestText ?? "",
		entry.latestToolCall ?? "",
		entry.latestToolResult ?? "",
		entry.errorMessage ?? "",
		entry.startedAt ? String(entry.startedAt) : "",
		entry.finishedAt ? String(entry.finishedAt) : "",
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

export function formatGremlinActivity(entry: GremlinInvocationEntry): string {
	const phase = normalizeText(entry.currentPhase);
	const latestText = normalizeText(entry.latestText);
	const latestToolCall = normalizeText(entry.latestToolCall);
	const latestToolResult = normalizeText(entry.latestToolResult);
	const errorMessage = normalizeText(entry.errorMessage);
	const context = normalizeText(entry.context);

	if (errorMessage && (entry.status === "failed" || entry.status === "canceled")) {
		return errorMessage;
	}

	const detail =
		(latestText && latestText !== context && latestText) ||
		latestToolResult ||
		latestToolCall ||
		context;
	const parts = dedupeParts([phase, detail]);
	return parts.join(" · ") || "idle";
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

export function formatCollapsedGremlinLine(entry: GremlinInvocationEntry): string {
	const cacheKey = createEntryCacheKey("collapsed", entry);
	const cached = collapsedLineCache.get(cacheKey);
	if (cached) return cached;
	const line = [
		`[${formatGremlinStatus(entry.status)}]`,
		formatGremlinIdentity(entry),
		formatGremlinActivity(entry),
	].join(" · ");
	return pushCacheEntry(collapsedLineCache, cacheKey, line);
}

export function formatExpandedGremlinLines(entry: GremlinInvocationEntry): string[] {
	const cacheKey = createEntryCacheKey("expanded", entry);
	const cached = expandedLinesCache.get(cacheKey);
	if (cached) return cached;

	const lines = [
		`[${formatGremlinStatus(entry.status)}] ${formatGremlinIdentity(entry)}`,
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
