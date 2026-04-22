import type {
	GremlinInvocationDetails,
	GremlinInvocationEntry,
	GremlinRequest,
} from "./gremlin-schema.js";

export interface GremlinProgressStore {
	snapshot(): GremlinInvocationDetails;
	update(gremlinId: string, patch: Partial<GremlinInvocationEntry>): GremlinInvocationDetails;
	complete(gremlinId: string, result: GremlinInvocationEntry): GremlinInvocationDetails;
	get(gremlinId: string): GremlinInvocationEntry | undefined;
}

function createInitialEntry(
	request: GremlinRequest,
	index: number,
): GremlinInvocationEntry {
	const now = Date.now();
	return {
		gremlinId: `g${index + 1}`,
		agent: request.agent,
		source: "unknown",
		status: "queued",
		context: request.context,
		cwd: request.cwd,
		currentPhase: "queued",
		latestText: "",
		startedAt: now,
		revision: 0,
	};
}

function countByStatus(entries: GremlinInvocationEntry[]) {
	return {
		activeCount: entries.filter(
			(entry) =>
				entry.status === "queued" ||
				entry.status === "starting" ||
				entry.status === "active",
		).length,
		completedCount: entries.filter((entry) => entry.status === "completed").length,
		failedCount: entries.filter((entry) => entry.status === "failed").length,
		canceledCount: entries.filter((entry) => entry.status === "canceled").length,
	};
}

export function createGremlinProgressStore(
	requests: GremlinRequest[],
): GremlinProgressStore {
	const entries = requests.map(createInitialEntry);
	let revision = 0;

	const snapshot = (): GremlinInvocationDetails => ({
		requestedCount: entries.length,
		...countByStatus(entries),
		gremlins: entries.map((entry) => ({ ...entry })),
		revision,
	});

	const findEntry = (gremlinId: string) =>
		entries.find((entry) => entry.gremlinId === gremlinId);

	return {
		snapshot,
		get(gremlinId) {
			const entry = findEntry(gremlinId);
			return entry ? { ...entry } : undefined;
		},
		update(gremlinId, patch) {
			const target = findEntry(gremlinId);
			if (target) {
				revision += 1;
				Object.assign(target, patch, {
					revision: (target.revision ?? 0) + 1,
				});
			}
			return snapshot();
		},
		complete(gremlinId, result) {
			const target = findEntry(gremlinId);
			if (target) {
				revision += 1;
				Object.assign(target, result, {
					gremlinId,
					finishedAt: result.finishedAt ?? Date.now(),
					revision: (target.revision ?? 0) + 1,
				});
			}
			return snapshot();
		},
	};
}
