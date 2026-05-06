import { describe, expect, test } from "bun:test";

describe("gremlin session transcript store", () => {
	test("captures full streaming transcript rows beyond activity-tail semantics", async () => {
		const { createGremlinSessionTranscriptStore } = await import("../../gremlins/gremlin-session-transcript-store.ts");
		const store = createGremlinSessionTranscriptStore();
		store.upsertSession({ gremlinId: "g1", toolCallId: "tool-a", agent: "researcher" });
		for (let index = 0; index < 15; index += 1) {
			store.recordEvent({ gremlinId: "g1", toolCallId: "tool-a", event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `chunk-${index} ` } } });
		}
		store.recordEvent({ gremlinId: "g1", toolCallId: "tool-a", event: { type: "message_end", message: { content: [{ type: "text", text: "final answer" }] } } });
		store.updateSession({ gremlinId: "g1", toolCallId: "tool-a", status: "completed" });

		const resolved = store.resolveGremlinTranscript("G1");
		expect(resolved.status).toBe("found");
		expect(resolved.entry.status).toBe("completed");
		expect(resolved.entry.transcript.rows.at(-1)).toMatchObject({ type: "assistant-text", text: "final answer", streaming: false });
	});

	test("rejects duplicate local gremlin ids as ambiguous instead of guessing", async () => {
		const { createGremlinSessionTranscriptStore } = await import("../../gremlins/gremlin-session-transcript-store.ts");
		const store = createGremlinSessionTranscriptStore();
		store.upsertSession({ gremlinId: "g1", toolCallId: "tool-a", agent: "a" });
		store.upsertSession({ gremlinId: "G1", toolCallId: "tool-b", agent: "b" });
		expect(store.resolveGremlinTranscript("g1")).toMatchObject({ status: "ambiguous" });
	});

	test("tool transcript status omits args so sensitive values are not rendered", async () => {
		const { createGremlinSessionTranscriptStore } = await import("../../gremlins/gremlin-session-transcript-store.ts");
		const store = createGremlinSessionTranscriptStore();
		store.upsertSession({ gremlinId: "g1", toolCallId: "tool-a", agent: "researcher" });
		store.recordEvent({ gremlinId: "g1", toolCallId: "tool-a", event: { type: "tool_execution_start", toolName: "bash", args: { command: "echo token=secret123" } } });
		const text = store.resolveGremlinTranscript("g1").entry.transcript.rows.map((row) => row.text ?? "").join("\n");
		expect(text).toContain("running tool: bash");
		expect(text).not.toContain("secret123");
	});
});
