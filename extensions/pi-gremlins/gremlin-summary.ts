import type {
	GremlinInvocationDetails,
	GremlinInvocationEntry,
	GremlinRunResult,
} from "./gremlin-schema.js";
import {
	formatBatchHeadline,
	formatCollapsedGremlinLines,
} from "./gremlin-render-components.js";

const HEADLINE_CACHE_LIMIT = 64;
const headlineCache = new Map<string, string>();
const summaryLineCache = new WeakMap<GremlinInvocationEntry, { revision: number; lines: string[] }>();

function pushCacheEntry<T>(cache: Map<string, T>, limit: number, key: string, value: T): T {
	cache.set(key, value);
	if (cache.size <= limit) return value;
	const firstKey = cache.keys().next().value;
	if (typeof firstKey === "string") cache.delete(firstKey);
	return value;
}

function getHeadlineCacheKey(details: GremlinInvocationDetails): string {
	return [
		String(details.requestedCount),
		String(details.activeCount),
		String(details.completedCount),
		String(details.failedCount),
		String(details.canceledCount),
	].join("\u001f");
}

function summarizeEntry(result: GremlinInvocationEntry): string[] {
	const entryRevision = result.revision ?? 0;
	const cached = summaryLineCache.get(result);
	if (cached?.revision === entryRevision) return cached.lines;
	const lines = formatCollapsedGremlinLines(result);
	summaryLineCache.set(result, { revision: entryRevision, lines });
	return lines;
}

function summarizeHeadline(details: GremlinInvocationDetails): string {
	const cacheKey = getHeadlineCacheKey(details);
	const cached = headlineCache.get(cacheKey);
	if (cached) return cached;
	return pushCacheEntry(
		headlineCache,
		HEADLINE_CACHE_LIMIT,
		cacheKey,
		formatBatchHeadline(details),
	);
}

function buildSummaryLines(details: GremlinInvocationDetails): string[] {
	const lines = [summarizeHeadline(details)];
	for (const gremlin of details.gremlins) {
		lines.push(...summarizeEntry(gremlin));
	}
	return lines;
}

export function buildGremlinBatchSummary(results: GremlinRunResult[]): string {
	const details: GremlinInvocationDetails = {
		requestedCount: results.length,
		activeCount: results.filter(
			(result) =>
				result.status === "queued" ||
				result.status === "starting" ||
				result.status === "active",
		).length,
		completedCount: results.filter((result) => result.status === "completed").length,
		failedCount: results.filter((result) => result.status === "failed").length,
		canceledCount: results.filter((result) => result.status === "canceled").length,
		gremlins: results,
	};
	return buildSummaryLines(details).join("\n");
}

export function buildGremlinProgressSummary(
	details: GremlinInvocationDetails,
): string {
	return buildSummaryLines(details).join("\n");
}
