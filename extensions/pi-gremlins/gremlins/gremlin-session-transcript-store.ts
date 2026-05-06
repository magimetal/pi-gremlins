import type { SideChatTranscriptRow, SideChatTranscriptState } from "../side-chat/side-chat-transcript-state.js";
import { extractTextFromContent } from "../shared/gremlin-content-utils.js";
import type { GremlinStatus } from "../shared/gremlin-schema.js";

export interface GremlinTranscriptEvent {
	type?: string;
	assistantMessageEvent?: { type?: string; delta?: unknown };
	message?: { role?: unknown; content?: unknown };
	toolName?: unknown;
	isError?: boolean;
}

export interface GremlinTranscriptEntry {
	readonly key: string;
	readonly gremlinId: string;
	readonly normalizedGremlinId: string;
	readonly toolCallId: string;
	readonly agent: string;
	readonly createdAt: number;
	status: GremlinStatus;
	transcript: SideChatTranscriptState;
}

export type ResolveGremlinTranscriptResult =
	| { status: "missing" }
	| { status: "ambiguous"; matches: readonly GremlinTranscriptEntry[] }
	| { status: "found"; entry: GremlinTranscriptEntry };

export interface GremlinSessionTranscriptStore {
	upsertSession(input: {
		gremlinId: string;
		toolCallId: string;
		agent: string;
		status?: GremlinStatus;
	}): GremlinTranscriptEntry;
	updateSession(input: {
		gremlinId: string;
		toolCallId: string;
		status?: GremlinStatus;
	}): GremlinTranscriptEntry | undefined;
	recordEvent(input: {
		gremlinId: string;
		toolCallId: string;
		event: GremlinTranscriptEvent;
	}): GremlinTranscriptEntry | undefined;
	recordStatus(input: {
		gremlinId: string;
		toolCallId: string;
		text: string;
		status?: SideChatTranscriptState["status"];
	}): GremlinTranscriptEntry | undefined;
	resolveGremlinTranscript(gremlinId: string): ResolveGremlinTranscriptResult;
	listGremlinTranscripts(): readonly GremlinTranscriptEntry[];
	subscribe(listener: () => void): () => void;
	clearGremlinTranscripts(): void;
}

function normalizeGremlinId(gremlinId: string): string {
	return gremlinId.trim().toLowerCase();
}

function createKey(toolCallId: string, gremlinId: string): string {
	return `${toolCallId}:${normalizeGremlinId(gremlinId)}`;
}

function createTranscriptState(rows: SideChatTranscriptRow[] = []): SideChatTranscriptState {
	return { rows, status: "idle", lastAssistantText: "" };
}

function normalizeToolName(toolName: unknown): string {
	return typeof toolName === "string" && toolName.trim() ? toolName.trim() : "tool";
}

function reduceGremlinTranscriptEvent(
	state: SideChatTranscriptState,
	event: GremlinTranscriptEvent,
): SideChatTranscriptState {
	if (!event || typeof event !== "object") return state;
	switch (event.type) {
		case "turn_start":
			return {
				...state,
				status: "thinking",
				error: undefined,
				rows: [...state.rows, { type: "turn-boundary", phase: "start" }],
			};
		case "turn_end":
			return {
				...state,
				status: "idle",
				rows: [...state.rows, { type: "turn-boundary", phase: "end" }],
			};
		case "message_start":
			return {
				...state,
				status: "replying",
				lastAssistantText: "",
				rows: [...state.rows, { type: "assistant-text", text: "", streaming: true }],
			};
		case "message_update": {
			if (event.assistantMessageEvent?.type !== "text_delta") return state;
			const delta = event.assistantMessageEvent.delta;
			if (typeof delta !== "string" || delta.length === 0) return state;
			const rows = [...state.rows];
			const last = rows[rows.length - 1];
			if (last?.type === "assistant-text" && last.streaming) {
				rows[rows.length - 1] = { ...last, text: last.text + delta };
			} else {
				rows.push({ type: "assistant-text", text: delta, streaming: true });
			}
			return {
				...state,
				status: "replying",
				lastAssistantText: state.lastAssistantText + delta,
				rows,
			};
		}
		case "message_end": {
			const text = extractTextFromContent(event.message?.content).trim();
			const finalText = text || state.lastAssistantText;
			const rows = [...state.rows];
			const last = rows[rows.length - 1];
			if (last?.type === "assistant-text") {
				rows[rows.length - 1] = { ...last, text: finalText || last.text, streaming: false };
			} else if (finalText) {
				rows.push({ type: "assistant-text", text: finalText, streaming: false });
			}
			return { ...state, status: "idle", lastAssistantText: finalText, rows };
		}
		case "tool_execution_start":
			return {
				...state,
				status: "tool",
				rows: [...state.rows, { type: "status", text: `running tool: ${normalizeToolName(event.toolName)}` }],
			};
		case "tool_execution_end":
			return {
				...state,
				status: event.isError ? "error" : "replying",
				rows: [...state.rows, { type: "status", text: `${normalizeToolName(event.toolName)} ${event.isError ? "failed" : "finished"}` }],
			};
		default:
			return state;
	}
}

export function createGremlinSessionTranscriptStore(): GremlinSessionTranscriptStore {
	const entries = new Map<string, GremlinTranscriptEntry>();
	const listeners = new Set<() => void>();

	function notify(): void {
		for (const listener of listeners) listener();
	}

	function get(gremlinId: string, toolCallId: string): GremlinTranscriptEntry | undefined {
		return entries.get(createKey(toolCallId, gremlinId));
	}

	return {
		upsertSession(input) {
			const key = createKey(input.toolCallId, input.gremlinId);
			let entry = entries.get(key);
			if (!entry) {
				entry = {
					key,
					gremlinId: input.gremlinId,
					normalizedGremlinId: normalizeGremlinId(input.gremlinId),
					toolCallId: input.toolCallId,
					agent: input.agent,
					status: input.status ?? "starting",
					createdAt: Date.now(),
					transcript: createTranscriptState([{ type: "status", text: `opened ${input.gremlinId} (${input.agent})` }]),
				};
				entries.set(key, entry);
			} else {
				entry.status = input.status ?? entry.status;
			}
			notify();
			return entry;
		},

		updateSession(input) {
			const entry = get(input.gremlinId, input.toolCallId);
			if (entry && input.status) {
				entry.status = input.status;
				notify();
			}
			return entry;
		},

		recordEvent(input) {
			const entry = get(input.gremlinId, input.toolCallId);
			if (!entry) return undefined;
			entry.transcript = reduceGremlinTranscriptEvent(entry.transcript, input.event);
			notify();
			return entry;
		},

		recordStatus(input) {
			const entry = get(input.gremlinId, input.toolCallId);
			if (!entry) return undefined;
			entry.transcript = {
				...entry.transcript,
				status: input.status ?? entry.transcript.status,
				rows: [...entry.transcript.rows, { type: "status", text: input.text }],
			};
			notify();
			return entry;
		},

		resolveGremlinTranscript(gremlinId) {
			const normalizedGremlinId = normalizeGremlinId(gremlinId);
			if (!normalizedGremlinId) return { status: "missing" };
			const matches = [...entries.values()].filter(
				(entry) => entry.normalizedGremlinId === normalizedGremlinId,
			);
			if (matches.length === 0) return { status: "missing" };
			if (matches.length > 1) return { status: "ambiguous", matches };
			return { status: "found", entry: matches[0]! };
		},

		listGremlinTranscripts() {
			return [...entries.values()].sort((left, right) => right.createdAt - left.createdAt);
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		clearGremlinTranscripts() {
			entries.clear();
			notify();
		},
	};
}
