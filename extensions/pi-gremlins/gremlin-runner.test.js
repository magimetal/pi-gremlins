import { describe, expect, test } from "bun:test";

function createFakeSession({ onPrompt, onAbort, getContextUsage } = {}) {
	const listeners = new Set();
	let disposed = 0;
	let aborted = 0;
	return {
		session: {
			subscribe(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			async prompt(text) {
				return await onPrompt?.({ text, emit, listeners });
			},
			async abort() {
				aborted += 1;
				await onAbort?.({ emit, listeners });
			},
			dispose() {
				disposed += 1;
			},
			getContextUsage,
		},
		getDisposedCount: () => disposed,
		getAbortedCount: () => aborted,
	};

	function emit(event) {
		for (const listener of listeners) listener(event);
	}
}

describe("gremlin runner v1 contract", () => {
	test("projects child session events into live gremlin state and disposes after completion", async () => {
		const { runSingleGremlin } = await import("./gremlin-runner.ts");
		const updates = [];
		const fake = createFakeSession({
			getContextUsage: () => ({ tokens: 6, contextWindow: 200000, percent: 0.003 }),
			onPrompt: async ({ text, emit }) => {
				expect(text).toContain("Parent system prompt snapshot:");
				expect(text).toContain("raw gremlin body");
				expect(text).toContain("Inspect auth flow");
				emit({ type: "agent_start" });
				emit({ type: "turn_start" });
				emit({
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "draft " },
				});
				emit({
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "answer" },
				});
				emit({
					type: "tool_execution_start",
					toolName: "read",
					args: { path: "/tmp/auth.ts" },
				});
				emit({
					type: "tool_execution_update",
					toolName: "read",
					partialResult: { content: [{ type: "text", text: "reading chunk" }] },
				});
				emit({
					type: "tool_execution_end",
					toolName: "read",
					result: { content: [{ type: "text", text: "file contents" }] },
				});
				emit({
					type: "message_end",
					message: {
						content: [{ type: "text", text: "final answer" }],
						usage: {
							input: 3,
							output: 5,
							cacheRead: 1,
							cacheWrite: 2,
							cost: { total: 0.25 },
							totalTokens: 8,
						},
						model: "openai/gpt-5-mini",
					},
				});
				emit({ type: "agent_end" });
			},
		});

		const result = await runSingleGremlin({
			gremlinId: "g1",
			request: { agent: "researcher", context: "Inspect auth flow" },
			definition: {
				name: "researcher",
				source: "project",
				filePath: "/tmp/researcher.md",
				rawMarkdown: "---\nname: researcher\nmodel: openai/gpt-5-mini\n---\nraw gremlin body",
				frontmatter: { model: "openai/gpt-5-mini" },
			},
			parentSystemPrompt: "system snapshot",
			onUpdate: (update) => updates.push(update),
			createSession: async () => fake,
		});

		expect(result).toMatchObject({
			gremlinId: "g1",
			agent: "researcher",
			source: "project",
			status: "completed",
			currentPhase: "settling",
			latestText: "final answer",
			latestToolCall: "read /tmp/auth.ts",
			latestToolResult: "file contents",
			model: "openai/gpt-5-mini",
			usage: {
				turns: 1,
				input: 3,
				output: 5,
				cacheRead: 1,
				cacheWrite: 2,
				cost: 0.25,
				contextTokens: 6,
			},
		});
		expect(updates.some((update) => update.patch.currentPhase === "prompting")).toBe(
			true,
		);
		expect(updates.some((update) => update.patch.currentPhase === "tool:read")).toBe(
			true,
		);
		expect(fake.getDisposedCount()).toBe(1);
		expect(fake.getAbortedCount()).toBe(0);
	});

	test("keeps streamed latestText whitespace behavior across multiple deltas until final message wins", async () => {
		const { runSingleGremlin } = await import("./gremlin-runner.ts");
		const updates = [];
		const fake = createFakeSession({
			onPrompt: async ({ emit }) => {
				emit({ type: "agent_start" });
				emit({ type: "turn_start" });
				emit({
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "  draft " },
				});
				emit({
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "answer  " },
				});
				emit({
					type: "message_end",
					message: {
						content: [{ type: "text", text: " final answer " }],
						usage: { input: 1, output: 2 },
					},
				});
			},
		});

		const result = await runSingleGremlin({
			gremlinId: "g1",
			request: { agent: "researcher", context: "Inspect auth flow" },
			definition: {
				name: "researcher",
				source: "project",
				filePath: "/tmp/researcher.md",
				rawMarkdown: "---\nname: researcher\n---\nraw gremlin body",
				frontmatter: {},
			},
			parentSystemPrompt: "system snapshot",
			onUpdate: (update) => updates.push(update),
			createSession: async () => fake,
		});

		expect(
			updates
				.filter((update) => update.patch.currentPhase === "streaming")
				.map((update) => update.patch.latestText)
				.filter(Boolean),
		).toEqual(["draft", "draftanswer"]);
		expect(result.latestText).toBe("final answer");
	});

	test("uses current context window tokens instead of cumulative total token usage", async () => {
		const { runSingleGremlin } = await import("./gremlin-runner.ts");
		const fake = createFakeSession({
			getContextUsage: () => ({ tokens: 11, contextWindow: 200000, percent: 0.0055 }),
			onPrompt: async ({ emit }) => {
				emit({
					type: "message_end",
					message: {
						content: [{ type: "text", text: "first answer" }],
						usage: { input: 3, output: 2, totalTokens: 5 },
					},
				});
				emit({
					type: "message_end",
					message: {
						content: [{ type: "text", text: "second answer" }],
						usage: { input: 4, output: 2, totalTokens: 6 },
					},
				});
			},
		});

		const result = await runSingleGremlin({
			gremlinId: "g1",
			request: { agent: "researcher", context: "Inspect auth flow" },
			definition: {
				name: "researcher",
				source: "project",
				filePath: "/tmp/researcher.md",
				rawMarkdown: "---\nname: researcher\n---\nraw gremlin body",
				frontmatter: {},
			},
			parentSystemPrompt: "system snapshot",
			createSession: async () => fake,
		});

		expect(result.usage).toMatchObject({
			turns: 2,
			input: 7,
			output: 4,
			contextTokens: 11,
		});
	});

	test("distinguishes cancel from fail and aborts child session on signal", async () => {
		const { runSingleGremlin } = await import("./gremlin-runner.ts");
		const controller = new AbortController();
		const fake = createFakeSession({
			onPrompt: async () => {
				await new Promise((resolve) => setTimeout(resolve, 30));
			},
		});

		const canceledPromise = runSingleGremlin({
			gremlinId: "g1",
			request: { agent: "researcher", context: "Inspect auth flow" },
			definition: {
				name: "researcher",
				source: "project",
				filePath: "/tmp/researcher.md",
				rawMarkdown: "---\nname: researcher\n---\nraw gremlin body",
				frontmatter: {},
			},
			parentSystemPrompt: "system snapshot",
			signal: controller.signal,
			createSession: async () => fake,
		});
		setTimeout(() => controller.abort(), 5);
		const canceled = await canceledPromise;
		expect(canceled.status).toBe("canceled");
		expect(canceled.errorMessage).toContain("aborted");
		expect(fake.getAbortedCount()).toBe(1);
		expect(fake.getDisposedCount()).toBe(1);

		const failing = createFakeSession({
			onPrompt: async () => {
				throw new Error("runner boom");
			},
		});
		const failed = await runSingleGremlin({
			gremlinId: "g2",
			request: { agent: "reviewer", context: "Review diff" },
			definition: {
				name: "reviewer",
				source: "user",
				filePath: "/tmp/reviewer.md",
				rawMarkdown: "---\nname: reviewer\n---\nreview body",
				frontmatter: {},
			},
			parentSystemPrompt: "system snapshot",
			createSession: async () => failing,
		});
		expect(failed.status).toBe("failed");
		expect(failed.errorMessage).toBe("runner boom");
		expect(failing.getDisposedCount()).toBe(1);
	});
});
