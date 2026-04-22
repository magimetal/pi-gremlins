import type { GremlinInvocationDetails } from "./gremlin-schema.js";
import {
	formatBatchHeadline,
	formatCollapsedGremlinLine,
	formatExpandedGremlinLines,
} from "./gremlin-render-components.js";

export interface RenderGremlinInvocationOptions {
	expanded?: boolean;
	width?: number;
}

const RENDER_CACHE_LIMIT = 128;
const renderCache = new Map<string, string>();

function clampLine(line: string, width?: number): string {
	if (!width || width <= 0 || line.length <= width) return line;
	if (width <= 1) return "…";
	return `${line.slice(0, Math.max(0, width - 1))}…`;
}

function pushRenderCache(key: string, value: string): string {
	renderCache.set(key, value);
	if (renderCache.size <= RENDER_CACHE_LIMIT) return value;
	const firstKey = renderCache.keys().next().value;
	if (typeof firstKey === "string") renderCache.delete(firstKey);
	return value;
}

function getDetailsRevisionKey(details: GremlinInvocationDetails): string {
	if (typeof details.revision === "number") return `details:${details.revision}`;
	return details.gremlins
		.map((entry, index) => {
			const fallback = [
				entry.gremlinId ?? `g${index + 1}`,
				String(entry.revision ?? ""),
				entry.status,
				entry.currentPhase ?? "",
				entry.latestText ?? "",
				entry.latestToolCall ?? "",
				entry.latestToolResult ?? "",
				entry.errorMessage ?? "",
			].join(":");
			return fallback;
		})
		.join("|");
}

function createRenderCacheKey(
	details: GremlinInvocationDetails,
	options: RenderGremlinInvocationOptions,
): string {
	return [
		options.expanded ? "expanded" : "collapsed",
		String(options.width ?? 0),
		String(details.requestedCount),
		String(details.activeCount),
		String(details.completedCount),
		String(details.failedCount),
		String(details.canceledCount),
		getDetailsRevisionKey(details),
	].join("\u001f");
}

function buildCollapsedLines(details: GremlinInvocationDetails): string[] {
	const lines = [formatBatchHeadline(details)];
	if (details.gremlins.length === 0) {
		lines.push("No gremlins requested.");
	} else {
		for (const entry of details.gremlins) {
			lines.push(formatCollapsedGremlinLine(entry));
		}
	}
	lines.push("Ctrl+O expands inline detail.");
	return lines;
}

function buildExpandedLines(details: GremlinInvocationDetails): string[] {
	const lines = [formatBatchHeadline(details)];
	if (details.gremlins.length === 0) {
		lines.push("No gremlins requested.");
		return lines;
	}

	for (const [index, entry] of details.gremlins.entries()) {
		if (index > 0) lines.push("");
		lines.push(...formatExpandedGremlinLines(entry));
	}
	return lines;
}

export function renderGremlinInvocationText(
	details: GremlinInvocationDetails,
	options: RenderGremlinInvocationOptions = {},
): string {
	const cacheKey = createRenderCacheKey(details, options);
	const cached = renderCache.get(cacheKey);
	if (cached) return cached;

	const lines = options.expanded
		? buildExpandedLines(details)
		: buildCollapsedLines(details);
	const text = lines
		.filter((line, index, array) => !(line === "" && array[index - 1] === ""))
		.map((line) => clampLine(line, options.width))
		.join("\n");
	return pushRenderCache(cacheKey, text);
}
