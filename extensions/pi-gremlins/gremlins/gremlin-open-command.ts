import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { OverlayHandle } from "@mariozechner/pi-tui";
import {
	SIDE_CHAT_OVERLAY_OPTIONS,
	SideChatOverlayComponent,
	type SideChatOverlayController,
} from "../side-chat/side-chat-overlay.js";
import type { ActiveGremlinSessionRegistry } from "./gremlin-session-registry.js";
import type {
	GremlinSessionTranscriptStore,
	GremlinTranscriptEntry,
} from "./gremlin-session-transcript-store.js";

export const GREMLIN_OPEN_COMMAND = "gremlins:open";

interface GremlinOpenRuntime {
	overlayHandle: OverlayHandle | null;
	overlayPromise: Promise<void> | null;
	requestOverlayRender: (() => void) | null;
	selectedEntry: GremlinTranscriptEntry | null;
	draft: string;
	unsubscribeStore: (() => void) | null;
}

function createRuntime(): GremlinOpenRuntime {
	return {
		overlayHandle: null,
		overlayPromise: null,
		requestOverlayRender: null,
		selectedEntry: null,
		draft: "",
		unsubscribeStore: null,
	};
}

function parseGremlinOpenArgs(args: string): string | undefined {
	const trimmed = (args ?? "").trim();
	return trimmed ? trimmed.split(/\s+/, 1)[0] : undefined;
}

function describeEntry(entry: GremlinTranscriptEntry): string {
	return `${entry.gremlinId} (${entry.agent}, ${entry.status}, ${entry.toolCallId})`;
}

function isSteerable(entry: GremlinTranscriptEntry | null): boolean {
	return entry?.status === "starting" || entry?.status === "active";
}

export function createGremlinOpenCommandHandler(
	store: GremlinSessionTranscriptStore,
	registry: ActiveGremlinSessionRegistry,
): (args: string, ctx: ExtensionCommandContext) => Promise<void> {
	const runtime = createRuntime();

	function requestRender(): void {
		runtime.requestOverlayRender?.();
	}

	function selectEntry(entry: GremlinTranscriptEntry): void {
		runtime.selectedEntry = entry;
		requestRender();
	}

	function resolveEntry(args: string, ctx: ExtensionCommandContext): GremlinTranscriptEntry | null {
		const gremlinId = parseGremlinOpenArgs(args);
		if (!gremlinId) {
			const known = store.listGremlinTranscripts();
			if (known.length === 0) {
				ctx.ui?.notify?.("No known gremlin sessions to open yet.", "warning");
				return null;
			}
			if (known.length === 1) return known[0]!;
			ctx.ui?.notify?.(
				`Multiple gremlin sessions are known; use /gremlins:open <G-id>. Known: ${known.map(describeEntry).join(", ")}`,
				"warning",
			);
			return null;
		}

		const resolved = store.resolveGremlinTranscript(gremlinId);
		if (resolved.status === "missing") {
			ctx.ui?.notify?.(`No known gremlin session found for ${gremlinId}.`, "warning");
			return null;
		}
		if (resolved.status === "ambiguous") {
			ctx.ui?.notify?.(
				`Ambiguous gremlin id ${gremlinId}; ${resolved.matches.length} sessions share that id: ${resolved.matches.map(describeEntry).join(", ")}`,
				"warning",
			);
			return null;
		}
		return resolved.entry;
	}

	async function submitSteering(ctx: ExtensionCommandContext, message: string): Promise<void> {
		const entry = runtime.selectedEntry;
		if (!entry) return;
		if (!isSteerable(entry)) {
			store.recordStatus({
				gremlinId: entry.gremlinId,
				toolCallId: entry.toolCallId,
				text: `steering unavailable: gremlin is ${entry.status}`,
				status: "idle",
			});
			requestRender();
			return;
		}
		const resolved = registry.resolveActiveGremlinSession(entry.gremlinId);
		if (resolved.status === "missing") {
			store.recordStatus({
				gremlinId: entry.gremlinId,
				toolCallId: entry.toolCallId,
				text: "steering unavailable: active session is gone",
				status: "idle",
			});
			requestRender();
			return;
		}
		if (resolved.status === "ambiguous") {
			store.recordStatus({
				gremlinId: entry.gremlinId,
				toolCallId: entry.toolCallId,
				text: `steering rejected: ambiguous active gremlin id (${resolved.matches.length} matches)`,
				status: "idle",
			});
			requestRender();
			return;
		}
		try {
			await resolved.entry.session.steer(message);
			resolved.entry.recordSteeringEvent?.({ status: "queued", message });
			store.recordStatus({
				gremlinId: entry.gremlinId,
				toolCallId: entry.toolCallId,
				text: `you steered: ${message}`,
				status: "thinking",
			});
		} catch (error) {
			const messageText = error instanceof Error ? error.message : String(error);
			resolved.entry.recordSteeringEvent?.({
				status: "rejected",
				message,
				errorMessage: messageText,
			});
			store.recordStatus({
				gremlinId: entry.gremlinId,
				toolCallId: entry.toolCallId,
				text: `steering rejected: ${messageText}`,
				status: "error",
			});
		}
		requestRender();
	}

	function ensureOverlay(ctx: ExtensionCommandContext): void {
		if (!ctx.hasUI || !ctx.ui?.custom) {
			ctx.ui?.notify?.("Gremlin session overlay requires interactive UI.", "warning");
			return;
		}
		if (runtime.overlayHandle) {
			runtime.overlayHandle.setHidden(false);
			runtime.overlayHandle.focus();
			requestRender();
			return;
		}
		const controller: SideChatOverlayController = {
			getMode: () => "gremlin",
			getTranscriptState: () => runtime.selectedEntry?.transcript ?? { rows: [], status: "idle", lastAssistantText: "" },
			getDraft: () => runtime.draft,
			setDraft: (value) => {
				runtime.draft = value;
			},
			submitDraft: (value) => {
				runtime.draft = "";
				void submitSteering(ctx, value);
			},
			close: () => {
				runtime.overlayHandle?.setHidden(true);
			},
			getHeaderText: () => {
				const entry = runtime.selectedEntry;
				if (!entry) return "🧌 gremlin │ no session selected │ Esc closes";
				const steerStatus = isSteerable(entry) ? "steering enabled" : "read-only";
				return `🧌 ${entry.gremlinId} · ${entry.agent} │ ${entry.status} │ ${steerStatus} │ Enter steers · Esc closes`;
			},
			getInputLabel: () => (isSteerable(runtime.selectedEntry) ? "steer ›" : "read-only ›"),
			getEmptyText: () => "No transcript rows captured for this gremlin yet.",
		};
		runtime.unsubscribeStore = store.subscribe(requestRender);
		runtime.overlayPromise = ctx.ui.custom<void>(
			(tui, _theme, _keybindings, done) => {
				runtime.requestOverlayRender = () => tui.requestRender();
				return new SideChatOverlayComponent(tui, controller, done);
			},
			{
				overlay: true,
				overlayOptions: SIDE_CHAT_OVERLAY_OPTIONS,
				onHandle: (handle) => {
					runtime.overlayHandle = handle;
					handle.focus();
				},
			},
		);
		runtime.overlayPromise.finally(() => {
			runtime.overlayHandle = null;
			runtime.overlayPromise = null;
			runtime.requestOverlayRender = null;
			runtime.unsubscribeStore?.();
			runtime.unsubscribeStore = null;
		});
	}

	return async (args, ctx) => {
		const entry = resolveEntry(args, ctx);
		if (!entry) return;
		selectEntry(entry);
		ensureOverlay(ctx);
		requestRender();
	};
}
