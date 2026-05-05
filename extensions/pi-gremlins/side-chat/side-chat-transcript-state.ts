import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { extractTextFromContent } from "../shared/gremlin-content-utils.js";

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
	toolName?: unknown;
	args?: unknown;
	isError?: boolean;
	result?: unknown;
};

const SIDE_CHAT_TOOL_INPUT_SUMMARY_MAX_LENGTH = 160;
const REDACTED_TOOL_INPUT_VALUE = "[redacted]";
const SENSITIVE_TOOL_INPUT_KEYS = [
	"apikey",
	"api_key",
	"authorization",
	"auth",
	"bearer",
	"cookie",
	"credential",
	"password",
	"passwd",
	"pem",
	"privatekey",
	"private_key",
	"pwd",
	"secret",
	"token",
];
const SENSITIVE_TOOL_INPUT_VALUE_PATTERNS = [
	/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/i,
	/\bAuthorization\s*:\s*\S+/i,
	/\bCookie\s*:\s*\S+/i,
	/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
	/\b(?:ghp|gho|github_pat|sk|pk|xox[baprs])-?[A-Za-z0-9_\-]{12,}\b/i,
];

function normalizeSideChatToolName(toolName: unknown): string {
	return typeof toolName === "string" && toolName.trim().length > 0 ? toolName : "unknown";
}

function isPlainToolArgs(args: unknown): args is Record<string, unknown> {
	return args !== null && typeof args === "object" && !Array.isArray(args);
}

function isSensitiveToolInputKey(key: string): boolean {
	const normalized = key.replace(/[\s.-]/g, "_").toLowerCase();
	const compact = normalized.replace(/_/g, "");
	return SENSITIVE_TOOL_INPUT_KEYS.some((sensitiveKey) => {
		const sensitiveCompact = sensitiveKey.replace(/_/g, "");
		return normalized.includes(sensitiveKey) || compact.includes(sensitiveCompact);
	});
}

function isSensitiveToolInputValue(value: string): boolean {
	return SENSITIVE_TOOL_INPUT_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function scalarToolInputValue(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	return undefined;
}

function safeToolInputScalar(key: string, value: unknown): string | undefined {
	const scalar = scalarToolInputValue(value);
	if (scalar === undefined) return undefined;
	if (isSensitiveToolInputKey(key) || isSensitiveToolInputValue(scalar)) return REDACTED_TOOL_INPUT_VALUE;
	return scalar;
}

function truncateSideChatToolInputSummary(summary: string): string {
	if (summary.length <= SIDE_CHAT_TOOL_INPUT_SUMMARY_MAX_LENGTH) return summary;
	return `${summary.slice(0, SIDE_CHAT_TOOL_INPUT_SUMMARY_MAX_LENGTH - 1)}…`;
}

function summarizeGenericToolArgs(args: Record<string, unknown>): string | undefined {
	const scalarEntries = Object.keys(args)
		.sort((left, right) => left.localeCompare(right))
		.flatMap((key) => {
			const value = safeToolInputScalar(key, args[key]);
			return value === undefined ? [] : [`${key}=${value}`];
		});
	return scalarEntries.length === 1 ? scalarEntries[0] : undefined;
}

function summarizeSideChatToolInput(toolName: string, args: unknown): string | undefined {
	if (!isPlainToolArgs(args)) return undefined;
	if (toolName === "read") {
		return safeToolInputScalar("path", args.path) ?? safeToolInputScalar("file", args.file);
	}
	if (toolName === "bash") {
		return safeToolInputScalar("command", args.command);
	}
	return summarizeGenericToolArgs(args);
}

function formatSideChatToolStartStatus(event: SideChatTranscriptEvent): string {
	const toolName = normalizeSideChatToolName(event.toolName);
	const summary = summarizeSideChatToolInput(toolName, event.args);
	return summary ? `running tool: ${toolName} ${truncateSideChatToolInputSummary(summary)}` : `running tool: ${toolName}`;
}

function formatSideChatToolEndStatus(event: SideChatTranscriptEvent): string {
	const toolName = normalizeSideChatToolName(event.toolName);
	return `${toolName === "unknown" ? "tool" : toolName} ${event.isError ? "failed" : "finished"}`;
}

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
					{ type: "status", text: formatSideChatToolStartStatus(event) },
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
						text: formatSideChatToolEndStatus(event),
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
