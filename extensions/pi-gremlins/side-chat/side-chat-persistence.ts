import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import type { ParentTranscriptSnapshot, SideChatMode } from "./side-chat-session-factory.js";

export const SIDE_CHAT_THREAD_ENTRY_TYPE = "pi-gremlins:side-chat-thread";
export const SIDE_CHAT_RESET_ENTRY_TYPE = "pi-gremlins:side-chat-reset";

export interface SideChatThreadEntryData {
	mode: SideChatMode;
	question: string;
	answer: string;
	capturedAt?: string;
	parentSnapshot?: ParentTranscriptSnapshot;
	timestamp: number;
}

export interface SideChatResetEntryData {
	mode: SideChatMode;
	timestamp: number;
}

export interface SideChatThreadState {
	mode: SideChatMode;
	exchanges: SideChatThreadEntryData[];
	parentSnapshot?: ParentTranscriptSnapshot;
	originCapturedAt?: string;
}

export interface RestoredSideChatThreads {
	chat: SideChatThreadState;
	tangent: SideChatThreadState;
}

type CustomSessionEntry = SessionEntry & {
	type: "custom";
	customType: string;
	data?: unknown;
};

export function createEmptySideChatThread(
	mode: SideChatMode,
): SideChatThreadState {
	return { mode, exchanges: [] };
}

export function createEmptySideChatThreads(): RestoredSideChatThreads {
	return {
		chat: createEmptySideChatThread("chat"),
		tangent: createEmptySideChatThread("tangent"),
	};
}

export function restoreSideChatThreadsFromBranch(
	branchEntries: readonly SessionEntry[] | undefined,
): RestoredSideChatThreads {
	const restored = createEmptySideChatThreads();
	if (!Array.isArray(branchEntries)) return restored;

	const lastResetIndex: Record<SideChatMode, number> = { chat: -1, tangent: -1 };
	branchEntries.forEach((entry, index) => {
		if (!isCustomEntry(entry, SIDE_CHAT_RESET_ENTRY_TYPE)) return;
		const data = entry.data;
		if (!isResetData(data)) return;
		lastResetIndex[data.mode] = index;
	});

	branchEntries.forEach((entry, index) => {
		if (!isCustomEntry(entry, SIDE_CHAT_THREAD_ENTRY_TYPE)) return;
		const data = entry.data;
		if (!isThreadData(data)) return;
		if (index <= lastResetIndex[data.mode]) return;
		const thread = restored[data.mode];
		thread.exchanges.push(data);
		if (!thread.parentSnapshot && data.parentSnapshot) {
			thread.parentSnapshot = data.parentSnapshot;
			thread.originCapturedAt = data.capturedAt ?? data.parentSnapshot.capturedAt;
		}
	});

	return restored;
}

export function buildThreadHistoryPrompt(
	thread: SideChatThreadState,
	userPrompt: string,
): string {
	const trimmed = userPrompt.trim();
	if (thread.exchanges.length === 0) return trimmed;
	const history = thread.exchanges
		.map(
			(exchange, index) =>
				`<exchange index="${index + 1}">\n<user>${escapeHistory(exchange.question)}</user>\n<assistant>${escapeHistory(exchange.answer)}</assistant>\n</exchange>`,
		)
		.join("\n");
	return [
		"<side-chat-thread-history>",
		history,
		"</side-chat-thread-history>",
		"",
		"<side-chat-question>",
		trimmed,
		"</side-chat-question>",
	].join("\n");
}

export function isSideChatCustomEntry(entry: unknown): boolean {
	return (
		isCustomEntry(entry, SIDE_CHAT_THREAD_ENTRY_TYPE) ||
		isCustomEntry(entry, SIDE_CHAT_RESET_ENTRY_TYPE)
	);
}

export function filterSideChatMessagesFromContext(
	messages: AgentMessage[],
): AgentMessage[] {
	return messages.filter((message) => {
		const maybeCustom = message as { customType?: unknown; details?: unknown };
		return (
			maybeCustom.customType !== SIDE_CHAT_THREAD_ENTRY_TYPE &&
			maybeCustom.customType !== SIDE_CHAT_RESET_ENTRY_TYPE
		);
	});
}

function isCustomEntry(entry: unknown, customType: string): entry is CustomSessionEntry {
	return (
		!!entry &&
		typeof entry === "object" &&
		(entry as { type?: unknown }).type === "custom" &&
		(entry as { customType?: unknown }).customType === customType
	);
}

function isResetData(data: unknown): data is SideChatResetEntryData {
	return (
		!!data &&
		typeof data === "object" &&
		((data as { mode?: unknown }).mode === "chat" ||
			(data as { mode?: unknown }).mode === "tangent")
	);
}

function isThreadData(data: unknown): data is SideChatThreadEntryData {
	return (
		isResetData(data) &&
		typeof (data as { question?: unknown }).question === "string" &&
		typeof (data as { answer?: unknown }).answer === "string"
	);
}

function escapeHistory(text: string): string {
	return text.replace(/]]>/g, "]]&gt;");
}
