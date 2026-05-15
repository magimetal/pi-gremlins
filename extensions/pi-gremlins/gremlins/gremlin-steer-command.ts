import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ActiveGremlinSessionRegistry } from "./gremlin-session-registry.js";

export const GREMLIN_STEER_COMMAND = "gremlins:steer";

export interface ParsedGremlinSteerArgs {
	gremlinId: string;
	message: string;
}

export type ParseGremlinSteerArgsResult =
	| { ok: true; value: ParsedGremlinSteerArgs }
	| { ok: false; reason: "missing-id" | "missing-message" };

export function parseGremlinSteerArgs(args: string): ParseGremlinSteerArgsResult {
	const raw = typeof args === "string" ? args : "";
	const leadingTrimmed = raw.replace(/^\s+/, "");
	if (!leadingTrimmed) return { ok: false, reason: "missing-id" };
	const idMatch = /^(\S+)/.exec(leadingTrimmed);
	const gremlinId = idMatch?.[1] ?? "";
	if (!gremlinId) return { ok: false, reason: "missing-id" };
	const remainder = leadingTrimmed.slice(gremlinId.length).replace(/^\s+/, "");
	if (!remainder.trim()) return { ok: false, reason: "missing-message" };
	return { ok: true, value: { gremlinId, message: remainder } };
}

export function createGremlinSteerCommandHandler(
	registry: ActiveGremlinSessionRegistry,
): (args: string, ctx: ExtensionCommandContext) => Promise<void> {
	return async (args, ctx) => {
		const parsed = parseGremlinSteerArgs(args);
		if (parsed.ok === false) {
			const usage = "Usage: /gremlins:steer <G-id> <message>";
			ctx.ui?.notify?.(
				parsed.reason === "missing-id"
					? `${usage}. Provide an active gremlin id such as G1.`
					: `${usage}. Provide a steering message for the active gremlin.`,
				"warning",
			);
			return;
		}

		const { gremlinId, message: steeringMessage } = parsed.value;
		const resolved = registry.resolveActiveGremlinSession(gremlinId);
		if (resolved.status === "missing") {
			ctx.ui?.notify?.(
				`No active gremlin found for ${gremlinId}. Completed, canceled, failed, setup-failed, stale, or disposed gremlins cannot be steered.`,
				"warning",
			);
			return;
		}
		if (resolved.status === "ambiguous") {
			ctx.ui?.notify?.(
				`Ambiguous active gremlin id ${gremlinId}; ${resolved.matches.length} active sessions share that id. Wait for one run to finish, then try again.`,
				"warning",
			);
			return;
		}

		try {
			await resolved.entry.session.steer(steeringMessage);
			resolved.entry.recordSteeringEvent?.({
				status: "queued",
				message: steeringMessage,
			});
			ctx.ui?.notify?.(
				`Steering queued for ${resolved.entry.gremlinId} (${resolved.entry.agent}).`,
				"info",
			);
		} catch (error) {
			const messageText = error instanceof Error ? error.message : String(error);
			resolved.entry.recordSteeringEvent?.({
				status: "rejected",
				message: steeringMessage,
				errorMessage: messageText,
			});
			ctx.ui?.notify?.(
				`Failed to steer ${resolved.entry.gremlinId} (${resolved.entry.agent}): ${messageText}`,
				"error",
			);
		}
	};
}
