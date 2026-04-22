import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import {
	cloneSingleResultForSnapshot,
	getInvocationSnapshotRevision,
	getInvocationStatus,
	getResultVisibleRevision,
	type InvocationStatus,
	initializeResultRevisions,
	type PiGremlinsDetails,
	type SingleResult,
	setInvocationSnapshotRevision,
} from "./execution-shared.js";

const DEFAULT_MAX_INVOCATION_SNAPSHOTS = 24;

export interface InvocationSnapshot extends PiGremlinsDetails {
	toolCallId: string;
	status: InvocationStatus;
	updatedAt: number;
}

function isSameResultSnapshotSlot(
	previousResult: SingleResult | undefined,
	nextResult: SingleResult,
): boolean {
	if (!previousResult) return false;
	return (
		previousResult.gremlinId === nextResult.gremlinId &&
		previousResult.agent === nextResult.agent &&
		previousResult.agentSource === nextResult.agentSource &&
		previousResult.task === nextResult.task &&
		previousResult.step === nextResult.step
	);
}

export function createInvocationSnapshot(
	toolCallId: string,
	details: PiGremlinsDetails,
	status = getInvocationStatus(details.mode, details.results),
	previousSnapshot?: InvocationSnapshot,
): InvocationSnapshot {
	const snapshotResults = details.viewerResults ?? details.results;
	const previousResults = previousSnapshot?.results ?? [];
	const nextResults = snapshotResults.map((result, index) => {
		initializeResultRevisions(result);
		const previousResult = previousResults[index];
		if (
			isSameResultSnapshotSlot(previousResult, result) &&
			getResultVisibleRevision(previousResult) ===
				getResultVisibleRevision(result)
		) {
			return previousResult;
		}
		return cloneSingleResultForSnapshot(result, previousResult);
	});

	const snapshotChanged =
		!previousSnapshot ||
		previousSnapshot.mode !== details.mode ||
		previousSnapshot.agentScope !== details.agentScope ||
		previousSnapshot.projectAgentsDir !== details.projectAgentsDir ||
		previousSnapshot.status !== status ||
		previousResults.length !== nextResults.length ||
		nextResults.some((result, index) => result !== previousResults[index]);

	if (!snapshotChanged && previousSnapshot) {
		return previousSnapshot;
	}

	const snapshot: InvocationSnapshot = {
		toolCallId,
		status,
		updatedAt: Date.now(),
		...details,
		results: nextResults,
	};
	setInvocationSnapshotRevision(
		snapshot,
		(previousSnapshot ? getInvocationSnapshotRevision(previousSnapshot) : 0) +
			1,
	);
	return snapshot;
}

function isTerminalInvocationStatus(status: InvocationStatus): boolean {
	return status !== "Running";
}

function isProgressOnlyInvocationUpdate(
	previousSnapshot: InvocationSnapshot | undefined,
	nextSnapshot: InvocationSnapshot,
	status = nextSnapshot.status,
): boolean {
	return (
		Boolean(previousSnapshot) &&
		!isTerminalInvocationStatus(status) &&
		previousSnapshot === nextSnapshot
	);
}

export function createInvocationUpdateController(
	readSnapshot: (toolCallId: string) => InvocationSnapshot | undefined,
	publishSnapshot: (toolCallId: string, snapshot: InvocationSnapshot) => void,
	emitUpdate: (partial: AgentToolResult<PiGremlinsDetails>) => void,
) {
	const pendingProgressUpdates = new Map<
		string,
		AgentToolResult<PiGremlinsDetails>
	>();

	const flushPendingProgress = (toolCallId: string) => {
		const pending = pendingProgressUpdates.get(toolCallId);
		if (!pending) return;
		pendingProgressUpdates.delete(toolCallId);
		emitUpdate(pending);
	};

	return {
		applyPartial(
			toolCallId: string,
			partial: AgentToolResult<PiGremlinsDetails>,
		): AgentToolResult<PiGremlinsDetails> {
			if (!partial.details) {
				emitUpdate(partial);
				return partial;
			}

			const previousSnapshot = readSnapshot(toolCallId);
			const status = getInvocationStatus(
				partial.details.mode,
				partial.details.results,
			);
			const snapshot = createInvocationSnapshot(
				toolCallId,
				partial.details,
				status,
				previousSnapshot,
			);
			const normalizedPartial: AgentToolResult<PiGremlinsDetails> = {
				...partial,
				details: snapshot,
			};

			if (isProgressOnlyInvocationUpdate(previousSnapshot, snapshot, status)) {
				pendingProgressUpdates.set(toolCallId, normalizedPartial);
				return normalizedPartial;
			}

			flushPendingProgress(toolCallId);
			publishSnapshot(toolCallId, snapshot);
			emitUpdate(normalizedPartial);
			return normalizedPartial;
		},

		publishDetails(
			toolCallId: string,
			details: PiGremlinsDetails,
			status = getInvocationStatus(details.mode, details.results),
		): InvocationSnapshot {
			if (isTerminalInvocationStatus(status)) {
				flushPendingProgress(toolCallId);
			}
			const previousSnapshot = readSnapshot(toolCallId);
			const snapshot = createInvocationSnapshot(
				toolCallId,
				details,
				status,
				previousSnapshot,
			);
			if (snapshot !== previousSnapshot) {
				publishSnapshot(toolCallId, snapshot);
			}
			return snapshot;
		},
	};
}

export function pruneInvocationRegistry(
	invocationRegistry: Map<string, InvocationSnapshot>,
	protectedInvocationIds: Set<string>,
	maxSnapshots = DEFAULT_MAX_INVOCATION_SNAPSHOTS,
): void {
	if (invocationRegistry.size <= maxSnapshots) return;

	const runningIds = new Set<string>();
	for (const [invocationId, snapshot] of invocationRegistry.entries()) {
		if (snapshot.status === "Running") {
			runningIds.add(invocationId);
		}
	}

	const pinnedIds = new Set<string>([
		...runningIds,
		...Array.from(protectedInvocationIds).filter(Boolean),
	]);
	const terminalIds = Array.from(invocationRegistry.entries())
		.filter(([invocationId, snapshot]) => {
			return snapshot.status !== "Running" && !pinnedIds.has(invocationId);
		})
		.map(([invocationId]) => invocationId);
	const deletableCount =
		invocationRegistry.size - Math.max(maxSnapshots, pinnedIds.size);
	if (deletableCount <= 0) return;
	for (const invocationId of terminalIds.slice(0, deletableCount)) {
		invocationRegistry.delete(invocationId);
	}
}
