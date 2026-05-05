import { describe, expect, test } from "bun:test";
import "../fixtures/v1-contract-harness.js";
import {
	appendSideChatUserMessage,
	createInitialSideChatTranscriptState,
	reduceSideChatTranscriptEvent,
} from "../../side-chat/side-chat-transcript-state.ts";

const toolStartText = (event) => {
	const state = reduceSideChatTranscriptEvent(createInitialSideChatTranscriptState(), event);
	return state.rows.at(-1)?.text;
};

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

	test("summarizes read path and file inputs", () => {
		expect(toolStartText({
			type: "tool_execution_start",
			toolName: "read",
			args: { path: "extensions/pi-gremlins/side-chat/side-chat-transcript-state.ts" },
		})).toBe("running tool: read extensions/pi-gremlins/side-chat/side-chat-transcript-state.ts");
		expect(toolStartText({
			type: "tool_execution_start",
			toolName: "read",
			args: { file: "README.md" },
		})).toBe("running tool: read README.md");
	});

	test("summarizes bash command input", () => {
		expect(toolStartText({
			type: "tool_execution_start",
			toolName: "bash",
			args: { command: "npm test -- side-chat" },
		})).toBe("running tool: bash npm test -- side-chat");
	});

	test("truncates long summaries without exposing full tail", () => {
		const longPath = `src/${"deep/".repeat(50)}secret-tail.ts`;
		const text = toolStartText({ type: "tool_execution_start", toolName: "read", args: { path: longPath } });
		expect(text).toStartWith("running tool: read src/deep/deep/deep/");
		expect(text).toEndWith("…");
		expect(text.length).toBeLessThanOrEqual(180);
		expect(text).not.toContain("secret-tail.ts");
	});

	test("redacts sensitive keys and sensitive-looking values before display", () => {
		const sensitiveCases = [
			{ token: "ghp_abcdefghijklmnopqrstuvwxyz123456" },
			{ password: "hunter2" },
			{ apiKey: "sk-live-abcdefghijklmnopqrstuvwxyz123456" },
			{ authorization: "Bearer abcdefghijklmnopqrstuvwxyz123456" },
			{ cookie: "session=abcdefghijklmnopqrstuvwxyz123456" },
			{ query: "-----BEGIN PRIVATE KEY-----\nvery-secret\n-----END PRIVATE KEY-----" },
		];
		for (const args of sensitiveCases) {
			const text = toolStartText({ type: "tool_execution_start", toolName: "grep", args });
			expect(text).toContain("[redacted]");
			expect(text).not.toContain("hunter2");
			expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
			expect(text).not.toContain("very-secret");
		}
	});

	test("summarizes straightforward generic scalar input", () => {
		expect(toolStartText({
			type: "tool_execution_start",
			toolName: "grep",
			args: { query: "side-chat" },
		})).toBe("running tool: grep query=side-chat");
	});

	test("falls back for unsupported, missing, malformed, and ambiguous start inputs", () => {
		expect(toolStartText({ type: "tool_execution_start", toolName: "custom", args: { nested: { path: "README.md" } } })).toBe("running tool: custom");
		expect(toolStartText({ type: "tool_execution_start", toolName: "custom" })).toBe("running tool: custom");
		expect(toolStartText({ type: "tool_execution_start", toolName: "custom", args: "not-object" })).toBe("running tool: custom");
		expect(toolStartText({ type: "tool_execution_start" })).toBe("running tool: unknown");
		expect(toolStartText({ type: "tool_execution_start", toolName: "" })).toBe("running tool: unknown");
		expect(toolStartText({ type: "tool_execution_start", toolName: 42 })).toBe("running tool: unknown");
	});
});
