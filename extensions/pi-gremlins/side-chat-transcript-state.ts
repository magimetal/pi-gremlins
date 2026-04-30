import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";

export type SideChatTranscriptRow =
	| { type: "turn-boundary"; turnIndex?: number; phase: "start" | "end" }
	| { type: "user-message"; text: string }
	| { type: "assistant-text"; text: string; streaming: boolean }
	| { type: "status"; text: string };

export interface SideChatTranscriptState {
	rows: SideChatTranscriptRow[];
	status: "idle" | "thinking" | "replying" | "tool" | "error";
	error?: string;
	lastAssistantText: string;
}

export type SideChatTranscriptEvent = {
	type?: string;
	turnIndex?: number;
	message?: Partial<AgentMessage> & { role?: unknown; content?: unknown };
	assistantMessageEvent?: { type?: string; delta?: unknown };
	toolName?: string;
	isError?: boolean;
	result?: unknown;
};

export function createInitialSideChatTranscriptState(
	seedRows: SideChatTranscriptRow[] = [],
): SideChatTranscriptState {
	return {
		rows: [...seedRows],
		status: "idle",
		lastAssistantText: "",
	};
}

export function appendSideChatUserMessage(
	state: SideChatTranscriptState,
	text: string,
): SideChatTranscriptState {
	return {
		...state,
		rows: [...state.rows, { type: "user-message", text }],
		status: "thinking",
		error: undefined,
	};
}

export function appendSideChatError(
	state: SideChatTranscriptState,
	message: string,
): SideChatTranscriptState {
	return {
		...state,
		rows: [...state.rows, { type: "status", text: `error: ${message}` }],
		status: "error",
		error: message,
	};
}

export function reduceSideChatTranscriptEvent(
	state: SideChatTranscriptState,
	event: SideChatTranscriptEvent,
): SideChatTranscriptState {
	if (!event || typeof event !== "object") return state;
	switch (event.type) {
		case "turn_start":
			return {
				...state,
				status: "thinking",
				error: undefined,
				rows: [
					...state.rows,
					{ type: "turn-boundary", phase: "start", turnIndex: event.turnIndex },
				],
			};
		case "turn_end":
			return {
				...state,
				status: "idle",
				rows: [
					...state.rows,
					{ type: "turn-boundary", phase: "end", turnIndex: event.turnIndex },
				],
			};
		case "message_start":
			if (event.message?.role !== "assistant") return state;
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
			if (event.message?.role !== "assistant") return state;
			const text = extractTextFromContent(event.message.content).trim();
			const finalText = text || state.lastAssistantText;
			const rows = [...state.rows];
			const last = rows[rows.length - 1];
			if (last?.type === "assistant-text") {
				rows[rows.length - 1] = {
					...last,
					text: finalText || last.text,
					streaming: false,
				};
			} else {
				rows.push({ type: "assistant-text", text: finalText, streaming: false });
			}
			return { ...state, status: "idle", lastAssistantText: finalText, rows };
		}
		case "tool_execution_start":
			return {
				...state,
				status: "tool",
				rows: [
					...state.rows,
					{ type: "status", text: `running tool: ${event.toolName ?? "unknown"}` },
				],
			};
		case "tool_execution_end":
			return {
				...state,
				status: event.isError ? "error" : "replying",
				rows: [
					...state.rows,
					{
						type: "status",
						text: `${event.toolName ?? "tool"} ${event.isError ? "failed" : "finished"}`,
					},
				],
			};
		default:
			return state;
	}
}

export function sideChatRowsFromThread(
	thread: Array<{ question: string; answer: string }>,
): SideChatTranscriptRow[] {
	return thread.flatMap((entry) => [
		{ type: "user-message" as const, text: entry.question },
		{ type: "assistant-text" as const, text: entry.answer, streaming: false },
	]);
}

export function extractTextFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			if ((item as { type?: string }).type !== "text") return [];
			const text = (item as TextContent).text;
			return typeof text === "string" ? [text] : [];
		})
		.join("");
}
