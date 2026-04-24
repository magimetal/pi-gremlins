import { createGremlinProgressStore } from "./gremlin-progress-store.js";
import { buildGremlinBatchSummary, buildGremlinProgressSummary } from "./gremlin-summary.js";
import type {
	GremlinInvocationDetails,
	GremlinRequest,
	GremlinRunResult,
} from "./gremlin-schema.js";

export interface RunGremlinBatchItem {
	gremlin: GremlinRequest;
	index: number;
	gremlinId: string;
	signal: AbortSignal;
	onUpdate?: (patch: Partial<GremlinRunResult>) => void;
}

export interface RunGremlinBatchOptions {
	gremlins: GremlinRequest[];
	signal?: AbortSignal;
	runGremlin: (item: RunGremlinBatchItem) => Promise<GremlinRunResult>;
	onUpdate?: (details: GremlinInvocationDetails) => void;
}

export interface GremlinBatchResult {
	mode: "single" | "parallel";
	results: GremlinRunResult[];
	anyError: boolean;
	summary: string;
}

function createTerminalResult(
	gremlin: GremlinRequest,
	gremlinId: string,
	error: unknown,
	aborted: boolean,
): GremlinRunResult {
	const errorMessage = error instanceof Error ? error.message : String(error);
	return {
		gremlinId,
		agent: gremlin.agent,
		source: "unknown",
		status: aborted ? "canceled" : "failed",
		context: gremlin.context,
		cwd: gremlin.cwd,
		currentPhase: "settling",
		errorMessage,
		activities: [{ kind: "error", phase: "settling", text: errorMessage }],
		usage: { turns: 0, input: 0, output: 0 },
		finishedAt: Date.now(),
	};
}

export async function runGremlinBatch({
	gremlins,
	signal,
	runGremlin,
	onUpdate,
}: RunGremlinBatchOptions): Promise<GremlinBatchResult> {
	const progressStore = createGremlinProgressStore(gremlins);
	const childControllers = new Map<string, AbortController>();
	const publishDetails = (details: GremlinInvocationDetails) => {
		onUpdate?.(details);
		return details;
	};
	const snapshotAndPublish = () => publishDetails(progressStore.snapshot());
	const abortChildren = () => {
		for (const controller of childControllers.values()) {
			controller.abort();
		}
	};
	const parentAbortListener = () => {
		abortChildren();
		snapshotAndPublish();
	};
	if (signal) {
		if (signal.aborted) abortChildren();
		signal.addEventListener("abort", parentAbortListener, { once: true });
	}

	snapshotAndPublish();
	const settlements = await Promise.allSettled(
		gremlins.map((gremlin, index) => {
			const gremlinId = `g${index + 1}`;
			const childController = new AbortController();
			if (signal?.aborted) childController.abort();
			childControllers.set(gremlinId, childController);
			return runGremlin({
				gremlin,
				index,
				gremlinId,
				signal: childController.signal,
				onUpdate: (patch) => {
					publishDetails(progressStore.update(gremlinId, patch));
				},
			})
				.then((result) => {
					publishDetails(progressStore.complete(gremlinId, result));
					return result;
				})
				.finally(() => {
					childControllers.delete(gremlinId);
				});
		}),
	);

	if (signal) {
		signal.removeEventListener("abort", parentAbortListener);
	}

	const results = settlements.map((settlement, index) => {
		const gremlinId = `g${index + 1}`;
		const gremlin = gremlins[index];
		if (settlement.status === "fulfilled") return settlement.value;
		const result = createTerminalResult(
			gremlin,
			gremlinId,
			settlement.reason,
			signal?.aborted ?? false,
		);
		publishDetails(progressStore.complete(gremlinId, result));
		return result;
	});
	const finalDetails = snapshotAndPublish();

	return {
		mode: gremlins.length === 1 ? "single" : "parallel",
		results,
		anyError: results.some(
			(result) => result.status === "failed" || result.status === "canceled",
		),
		summary:
			buildGremlinBatchSummary(results) || buildGremlinProgressSummary(finalDetails),
	};
}
