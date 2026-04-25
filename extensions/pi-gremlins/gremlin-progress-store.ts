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
		intent: request.intent ?? "",
		agent: request.agent,
		source: "unknown",
		status: "queued",
		context: request.context,
		cwd: request.cwd,
		currentPhase: "queued",
		latestText: "",
		activities: [],
		usage: { turns: 0, input: 0, output: 0 },
		startedAt: now,
		revision: 0,
	};
}

function isActiveStatus(status: GremlinInvocationEntry["status"]): boolean {
	return status === "queued" || status === "starting" || status === "active";
}

function cloneUsage(usage: GremlinInvocationEntry["usage"]) {
	return usage ? Object.freeze({ ...usage }) : undefined;
}

function cloneActivities(activities: GremlinInvocationEntry["activities"]) {
	return activities
		? (Object.freeze(
				activities.map((activity) => Object.freeze({ ...activity })),
			) as GremlinInvocationEntry["activities"])
		: undefined;
}

function createEntrySnapshot(
	entry: GremlinInvocationEntry,
): GremlinInvocationEntry {
	return Object.freeze({
		...entry,
		activities: cloneActivities(entry.activities),
		usage: cloneUsage(entry.usage),
	});
}

function createStatusCounts(entries: GremlinInvocationEntry[]) {
	const counts = {
		activeCount: 0,
		completedCount: 0,
		failedCount: 0,
		canceledCount: 0,
	};
	for (const entry of entries) {
		if (isActiveStatus(entry.status)) counts.activeCount += 1;
		if (entry.status === "completed") counts.completedCount += 1;
		if (entry.status === "failed") counts.failedCount += 1;
		if (entry.status === "canceled") counts.canceledCount += 1;
	}
	return counts;
}

function updateStatusCounts(
	counts: ReturnType<typeof createStatusCounts>,
	previousStatus: GremlinInvocationEntry["status"],
	nextStatus: GremlinInvocationEntry["status"],
) {
	if (previousStatus === nextStatus) return;
	if (isActiveStatus(previousStatus)) counts.activeCount -= 1;
	if (previousStatus === "completed") counts.completedCount -= 1;
	if (previousStatus === "failed") counts.failedCount -= 1;
	if (previousStatus === "canceled") counts.canceledCount -= 1;
	if (isActiveStatus(nextStatus)) counts.activeCount += 1;
	if (nextStatus === "completed") counts.completedCount += 1;
	if (nextStatus === "failed") counts.failedCount += 1;
	if (nextStatus === "canceled") counts.canceledCount += 1;
}

export function createGremlinProgressStore(
	requests: GremlinRequest[],
): GremlinProgressStore {
	const entries = requests.map(createInitialEntry);
	const entryById = new Map(entries.map((entry) => [entry.gremlinId ?? "", entry]));
	const statusCounts = createStatusCounts(entries);
	const entrySnapshots = new Map<
		string,
		{ revision: number; snapshot: GremlinInvocationEntry }
	>();
	let revision = 0;
	let cachedSnapshot: GremlinInvocationDetails | undefined;

	const invalidateSnapshot = () => {
		cachedSnapshot = undefined;
	};

	const snapshotEntry = (entry: GremlinInvocationEntry): GremlinInvocationEntry => {
		const gremlinId = entry.gremlinId ?? "";
		const entryRevision = entry.revision ?? 0;
		const cached = entrySnapshots.get(gremlinId);
		if (cached && cached.revision === entryRevision) return cached.snapshot;
		const snapshot = createEntrySnapshot(entry);
		entrySnapshots.set(gremlinId, { revision: entryRevision, snapshot });
		return snapshot;
	};

	const snapshot = (): GremlinInvocationDetails => {
		if (cachedSnapshot) return cachedSnapshot;
		cachedSnapshot = Object.freeze({
			requestedCount: entries.length,
			activeCount: statusCounts.activeCount,
			completedCount: statusCounts.completedCount,
			failedCount: statusCounts.failedCount,
			canceledCount: statusCounts.canceledCount,
			gremlins: Object.freeze(entries.map(snapshotEntry)) as GremlinInvocationEntry[],
			revision,
		}) as GremlinInvocationDetails;
		return cachedSnapshot;
	};

	const applyEntryPatch = (
		gremlinId: string,
		patch: Partial<GremlinInvocationEntry>,
		fallbackFinishedAt?: number,
	) => {
		const target = entryById.get(gremlinId);
		if (!target) return snapshot();
		const previousStatus = target.status;
		const nextStatus = patch.status ?? previousStatus;
		revision += 1;
		Object.assign(target, patch, {
			gremlinId,
			finishedAt: fallbackFinishedAt ?? patch.finishedAt ?? target.finishedAt,
			revision: (target.revision ?? 0) + 1,
		});
		updateStatusCounts(statusCounts, previousStatus, nextStatus);
		invalidateSnapshot();
		return snapshot();
	};

	return {
		snapshot,
		get(gremlinId) {
			const entry = entryById.get(gremlinId);
			if (!entry) return undefined;
			const snapshot = snapshotEntry(entry);
			return {
				...snapshot,
				activities: snapshot.activities
					? snapshot.activities.map((activity) => ({ ...activity }))
					: undefined,
				usage: snapshot.usage ? { ...snapshot.usage } : undefined,
			};
		},
		update(gremlinId, patch) {
			return applyEntryPatch(gremlinId, patch);
		},
		complete(gremlinId, result) {
			return applyEntryPatch(gremlinId, result, result.finishedAt ?? Date.now());
		},
	};
}
