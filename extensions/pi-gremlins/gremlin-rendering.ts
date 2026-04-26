import { pushLimitedCache } from "./gremlin-cache-utils.js";
import type { GremlinInvocationDetails } from "./gremlin-schema.js";
import {
	createEntryCacheKey,
	formatBatchHeadline,
	formatCollapsedGremlinLines,
	formatExpandedGremlinLines,
} from "./gremlin-render-components.js";

interface GremlinRenderTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

export interface RenderGremlinInvocationOptions {
	expanded?: boolean;
	width?: number;
}

const RENDER_CACHE_LIMIT = 128;
const RENDER_SEGMENT_CACHE_LIMIT = 256;
const renderCache = new Map<string, string>();
const renderSegmentCache = new Map<string, string>();

function clampLine(line: string, width?: number): string {
	if (!width || width <= 0 || line.length <= width) return line;
	if (width <= 1) return "…";
	return `${line.slice(0, Math.max(0, width - 1))}…`;
}

function pushRenderCache(key: string, value: string): string {
	return pushLimitedCache(renderCache, RENDER_CACHE_LIMIT, key, value);
}

function pushRenderSegmentCache(key: string, value: string): string {
	return pushLimitedCache(
		renderSegmentCache,
		RENDER_SEGMENT_CACHE_LIMIT,
		key,
		value,
	);
}

function getDetailsRevisionKey(details: GremlinInvocationDetails): string {
	const entryKeys = details.gremlins
		.map((entry) => createEntryCacheKey("details-entry", entry))
		.join("|");
	if (typeof details.revision === "number") {
		return [`details:${details.revision}`, entryKeys].join("\u001e");
	}
	return entryKeys;
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

function renderLines(lines: string[], width?: number): string {
	return lines
		.filter((line, index, array) => !(line === "" && array[index - 1] === ""))
		.map((line) => clampLine(line, width))
		.join("\n");
}

function getStaticRenderSegment(line: string, width?: number): string {
	const cacheKey = ["static", String(width ?? 0), line].join("\u001f");
	const cached = renderSegmentCache.get(cacheKey);
	if (cached) return cached;
	return pushRenderSegmentCache(cacheKey, renderLines([line], width));
}

function getCollapsedEntrySegment(
	entry: GremlinInvocationDetails["gremlins"][number],
	width?: number,
): string {
	const cacheKey = [
		"collapsed-entry",
		String(width ?? 0),
		createEntryCacheKey("collapsed-entry", entry),
	].join("\u001f");
	const cached = renderSegmentCache.get(cacheKey);
	if (cached) return cached;
	return pushRenderSegmentCache(
		cacheKey,
		renderLines(formatCollapsedGremlinLines(entry), width),
	);
}

function getExpandedEntrySegment(
	entry: GremlinInvocationDetails["gremlins"][number],
	width?: number,
): string {
	const cacheKey = [
		"expanded-entry",
		String(width ?? 0),
		createEntryCacheKey("expanded-entry", entry),
	].join("\u001f");
	const cached = renderSegmentCache.get(cacheKey);
	if (cached) return cached;
	return pushRenderSegmentCache(
		cacheKey,
		renderLines(formatExpandedGremlinLines(entry), width),
	);
}

function buildCollapsedText(details: GremlinInvocationDetails, width?: number): string {
	const segments = [getStaticRenderSegment(formatBatchHeadline(details), width)];
	if (details.gremlins.length === 0) {
		segments.push(getStaticRenderSegment("No gremlins requested.", width));
	} else {
		for (const entry of details.gremlins) {
			segments.push(getCollapsedEntrySegment(entry, width));
		}
	}
	segments.push(getStaticRenderSegment("Ctrl+O expands inline detail.", width));
	return segments.join("\n");
}

function buildExpandedText(details: GremlinInvocationDetails, width?: number): string {
	const segments = [getStaticRenderSegment(formatBatchHeadline(details), width)];
	if (details.gremlins.length === 0) {
		segments.push(getStaticRenderSegment("No gremlins requested.", width));
		return segments.join("\n");
	}

	for (const entry of details.gremlins) {
		segments.push(getExpandedEntrySegment(entry, width));
	}
	return segments.join("\n\n");
}

function getStatusColor(line: string): string | undefined {
	if (line.startsWith("[Completed]")) return "success";
	if (line.startsWith("[Failed]")) return "error";
	if (line.startsWith("[Canceled]")) return "warning";
	if (line.startsWith("[Active]")) return "accent";
	if (line.startsWith("[Starting]")) return "accent";
	if (line.startsWith("[Queued]")) return "muted";
	return undefined;
}

function styleLine(
	line: string,
	theme: GremlinRenderTheme,
	options: RenderGremlinInvocationOptions,
): string {
	if (!line) return line;
	if (line.startsWith("Gremlins🧌")) return theme.fg("accent", theme.bold(line));
	if (line === "Ctrl+O expands inline detail.") return theme.fg("dim", line);
	if (line === "No gremlins requested.") return theme.fg("muted", line);
	if (line.startsWith("intent · ")) return theme.fg("muted", line);
	if (line.startsWith("task · ")) return theme.fg("text", line);
	if (line.startsWith("tool call · ")) return theme.fg("accent", line);
	if (line.startsWith("tool result · ")) return theme.fg("toolOutput", line);
	if (line.startsWith("latest · ")) return theme.fg("text", line);
	if (line.startsWith("error · ")) return theme.fg("error", line);
	if (line.startsWith("idle · ")) return theme.fg("dim", line);
	if (line.startsWith("usage · ")) return theme.fg("dim", line);
	if (
		line.startsWith("cwd · ") ||
		line.startsWith("model · ") ||
		line.startsWith("thinking · ") ||
		line.startsWith("phase · ")
	) {
		return theme.fg(options.expanded ? "muted" : "dim", line);
	}
	const statusColor = getStatusColor(line);
	if (statusColor) return theme.fg(statusColor, line);
	return line;
}

export function styleGremlinInvocationText(
	text: string,
	theme?: GremlinRenderTheme,
	options: RenderGremlinInvocationOptions = {},
): string {
	if (!theme) return text;
	return text
		.split("\n")
		.map((line) => styleLine(line, theme, options))
		.join("\n");
}

export function renderGremlinInvocationText(
	details: GremlinInvocationDetails,
	options: RenderGremlinInvocationOptions = {},
): string {
	const cacheKey = createRenderCacheKey(details, options);
	const cached = renderCache.get(cacheKey);
	if (cached) return cached;

	const text = options.expanded
		? buildExpandedText(details, options.width)
		: buildCollapsedText(details, options.width);
	return pushRenderCache(cacheKey, text);
}
