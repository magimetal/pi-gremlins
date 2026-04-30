import { describe, expect, test } from "bun:test";
import "./v1-contract-harness.js";
import {
	appendSideChatUserMessage,
	createInitialSideChatTranscriptState,
	reduceSideChatTranscriptEvent,
} from "./side-chat-transcript-state.ts";

describe("side-chat transcript reducer", () => {
	test("folds user row and streaming assistant text", () => {
		let state = createInitialSideChatTranscriptState();
		state = appendSideChatUserMessage(state, "hello");
		state = reduceSideChatTranscriptEvent(state, { type: "message_start", message: { role: "assistant" } });
		state = reduceSideChatTranscriptEvent(state, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hel" } });
		state = reduceSideChatTranscriptEvent(state, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "lo" } });
		state = reduceSideChatTranscriptEvent(state, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } });
		expect(state.status).toBe("idle");
		expect(state.lastAssistantText).toBe("hello");
		expect(state.rows).toContainEqual({ type: "user-message", text: "hello" });
		expect(state.rows).toContainEqual({ type: "assistant-text", text: "hello", streaming: false });
	});

	test("records defensive tool events", () => {
		let state = createInitialSideChatTranscriptState();
		state = reduceSideChatTranscriptEvent(state, { type: "tool_execution_start", toolName: "bash" });
		state = reduceSideChatTranscriptEvent(state, { type: "tool_execution_end", toolName: "bash", isError: true });
		expect(state.status).toBe("error");
		expect(state.rows.at(-1)).toEqual({ type: "status", text: "bash failed" });
	});
});
