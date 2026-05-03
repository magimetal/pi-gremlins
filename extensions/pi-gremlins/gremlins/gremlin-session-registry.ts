export interface SteerableGremlinSession {
	steer(message: string): Promise<unknown> | unknown;
}

export type ActiveGremlinSteeringEvent =
	| { status: "queued"; message: string }
	| { status: "rejected"; message: string; errorMessage: string };

export interface ActiveGremlinSessionEntry {
	readonly gremlinId: string;
	readonly normalizedGremlinId: string;
	readonly toolCallId: string;
	readonly agent: string;
	readonly session: SteerableGremlinSession;
	recordSteeringEvent?(event: ActiveGremlinSteeringEvent): void;
}

export type ActiveGremlinSessionHandle = symbol;

export type ResolveActiveGremlinSessionResult =
	| { status: "missing" }
	| { status: "ambiguous"; matches: readonly ActiveGremlinSessionEntry[] }
	| { status: "active"; entry: ActiveGremlinSessionEntry };

export interface ActiveGremlinSessionRegistry {
	registerActiveGremlinSession(entry: {
		gremlinId: string;
		toolCallId: string;
		agent: string;
		session: SteerableGremlinSession;
		recordSteeringEvent?(event: ActiveGremlinSteeringEvent): void;
	}): ActiveGremlinSessionHandle;
	unregisterActiveGremlinSession(handle: ActiveGremlinSessionHandle): boolean;
	resolveActiveGremlinSession(gremlinId: string): ResolveActiveGremlinSessionResult;
	clearActiveGremlinSessions(): void;
}

function normalizeGremlinId(gremlinId: string): string {
	return gremlinId.trim().toLowerCase();
}

export function createActiveGremlinSessionRegistry(): ActiveGremlinSessionRegistry {
	const entries = new Map<ActiveGremlinSessionHandle, ActiveGremlinSessionEntry>();

	return {
		registerActiveGremlinSession(entry) {
			const handle = Symbol(`pi-gremlins:${entry.toolCallId}:${entry.gremlinId}`);
			entries.set(handle, {
				gremlinId: entry.gremlinId,
				normalizedGremlinId: normalizeGremlinId(entry.gremlinId),
				toolCallId: entry.toolCallId,
				agent: entry.agent,
				session: entry.session,
				recordSteeringEvent: entry.recordSteeringEvent,
			});
			return handle;
		},

		unregisterActiveGremlinSession(handle) {
			return entries.delete(handle);
		},

		resolveActiveGremlinSession(gremlinId) {
			const normalizedGremlinId = normalizeGremlinId(gremlinId);
			if (!normalizedGremlinId) return { status: "missing" };
			const matches = [...entries.values()].filter(
				(entry) => entry.normalizedGremlinId === normalizedGremlinId,
			);
			if (matches.length === 0) return { status: "missing" };
			if (matches.length > 1) return { status: "ambiguous", matches };
			return { status: "active", entry: matches[0]! };
		},

		clearActiveGremlinSessions() {
			entries.clear();
		},
	};
}
