import type {
	GremlinInvocationDetails,
	GremlinInvocationEntry,
	GremlinRunResult,
} from "./gremlin-schema.js";
import {
	formatBatchHeadline,
	formatCollapsedGremlinLine,
} from "./gremlin-render-components.js";

function summarizeEntry(result: GremlinInvocationEntry): string {
	return formatCollapsedGremlinLine(result);
}

function buildSummaryLines(details: GremlinInvocationDetails): string[] {
	const lines = [formatBatchHeadline(details)];
	for (const gremlin of details.gremlins) {
		lines.push(summarizeEntry(gremlin));
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
