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
				expect(text).not.toContain("Parent system prompt snapshot:");
				expect(text).not.toContain("raw gremlin body");
				expect(text).toContain("Caller intent:");
				expect(text).toContain("Inspect implementation independently");
				expect(text).toContain("Caller context:");
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
			request: { intent: "Inspect implementation independently", agent: "researcher", context: "Inspect auth flow" },
			definition: {
				name: "researcher",
				source: "project",
				filePath: "/tmp/researcher.md",
				rawMarkdown: "---\nname: researcher\nmodel: openai/gpt-5-mini\n---\nraw gremlin body",
				frontmatter: { model: "openai/gpt-5-mini" },
			},
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
		expect(result.activities?.slice(-3)).toMatchObject([
			{ kind: "tool-result", phase: "tool:read", text: "reading chunk" },
			{ kind: "tool-result", phase: "streaming", text: "file contents" },
			{ kind: "text", phase: "settling", text: "final answer" },
		]);
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
			request: { intent: "Inspect implementation independently", agent: "researcher", context: "Inspect auth flow" },
			definition: {
				name: "researcher",
				source: "project",
				filePath: "/tmp/researcher.md",
				rawMarkdown: "---\nname: researcher\n---\nraw gremlin body",
				frontmatter: {},
			},
			onUpdate: (update) => updates.push(update),
			createSession: async () => fake,
		});

		expect(
			updates
				.filter((update) => update.patch.currentPhase === "streaming")
				.map((update) => update.patch.latestText)
				.filter(Boolean),
		).toEqual(["draftanswer"]);
		expect(result.latestText).toBe("final answer");
	});

	test("coalesces many tiny text deltas while retaining final latestText", async () => {
		const { runSingleGremlin } = await import("./gremlin-runner.ts");
		const updates = [];
		const fake = createFakeSession({
			onPrompt: async ({ emit }) => {
				emit({ type: "turn_start" });
				for (let index = 0; index < 200; index++) {
					emit({
						type: "message_update",
						assistantMessageEvent: { type: "text_delta", delta: "x" },
					});
				}
				emit({
					type: "message_end",
					message: { content: [{ type: "text", text: "final answer" }] },
				});
			},
		});

		const result = await runSingleGremlin({
			gremlinId: "g1",
			request: { intent: "Inspect implementation independently", agent: "researcher", context: "Inspect auth flow" },
			definition: {
				name: "researcher",
				source: "project",
				filePath: "/tmp/researcher.md",
				rawMarkdown: "---\nname: researcher\n---\nraw gremlin body",
				frontmatter: {},
			},
			onUpdate: (update) => updates.push(update),
			createSession: async () => fake,
		});

		const streamingUpdates = updates.filter(
			(update) => update.patch.currentPhase === "streaming" && update.patch.latestText,
		);
		expect(streamingUpdates.length).toBeLessThanOrEqual(4);
		expect(result.latestText).toBe("final answer");
	});

	test("stores activity text previews instead of full streaming snapshots", async () => {
		const { runSingleGremlin } = await import("./gremlin-runner.ts");
		const largeText = "large response chunk ".repeat(80);
		const fake = createFakeSession({
			onPrompt: async ({ emit }) => {
				emit({
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: largeText },
				});
			},
		});

		const result = await runSingleGremlin({
			gremlinId: "g1",
			request: { intent: "Inspect implementation independently", agent: "researcher", context: "Inspect auth flow" },
			definition: {
				name: "researcher",
				source: "project",
				filePath: "/tmp/researcher.md",
				rawMarkdown: "---\nname: researcher\n---\nraw gremlin body",
				frontmatter: {},
			},
			createSession: async () => fake,
		});

		expect(result.latestText).toBe(largeText.trimEnd());
		expect(result.activities?.[0].text.length).toBeLessThan(largeText.length);
		expect(result.activities?.[0].text.endsWith("…")).toBe(true);
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
			request: { intent: "Inspect implementation independently", agent: "researcher", context: "Inspect auth flow" },
			definition: {
				name: "researcher",
				source: "project",
				filePath: "/tmp/researcher.md",
				rawMarkdown: "---\nname: researcher\n---\nraw gremlin body",
				frontmatter: {},
			},
			createSession: async () => fake,
		});

		expect(result.usage).toMatchObject({
			turns: 2,
			input: 7,
			output: 4,
			contextTokens: 11,
		});
	});

	test("disposes exactly once when session setup fails after createSession", async () => {
		const { runSingleGremlin } = await import("./gremlin-runner.ts");
		let disposed = 0;
		const result = await runSingleGremlin({
			gremlinId: "g1",
			request: { intent: "Inspect implementation independently", agent: "researcher", context: "Inspect auth flow" },
			definition: {
				name: "researcher",
				source: "project",
				filePath: "/tmp/researcher.md",
				rawMarkdown: "---\nname: researcher\n---\nraw gremlin body",
				frontmatter: {},
			},
			createSession: async () => ({
				session: {
					subscribe() {
						throw new Error("subscribe boom");
					},
					async prompt() {},
					dispose() {
						disposed += 1;
					},
				},
			}),
		});

		expect(result.status).toBe("failed");
		expect(result.errorMessage).toBe("subscribe boom");
		expect(disposed).toBe(1);
	});

	test("returns terminal failure before creating session when explicit gremlin model is unresolved", async () => {
		const { runSingleGremlin } = await import("./gremlin-runner.ts");
		let createCalls = 0;
		const result = await runSingleGremlin({
			gremlinId: "g1",
			request: { intent: "Inspect implementation independently", agent: "researcher", context: "Inspect auth flow" },
			definition: {
				name: "researcher",
				source: "project",
				filePath: "/tmp/researcher.md",
				rawMarkdown: "---\nname: researcher\nmodel: openai/missing\n---\nraw gremlin body",
				frontmatter: { model: "openai/missing" },
			},
			modelRegistry: {
				getAll: () => [],
				find: () => undefined,
			},
			createSession: async () => {
				createCalls += 1;
				return createFakeSession();
			},
		});

		expect(result.status).toBe("failed");
		expect(result.model).toBe("openai/missing");
		expect(result.errorMessage).toBe("Unknown gremlin model: openai/missing");
		expect(createCalls).toBe(0);
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
			request: { intent: "Inspect implementation independently", agent: "researcher", context: "Inspect auth flow" },
			definition: {
				name: "researcher",
				source: "project",
				filePath: "/tmp/researcher.md",
				rawMarkdown: "---\nname: researcher\n---\nraw gremlin body",
				frontmatter: {},
			},
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
			request: { intent: "Review implementation independently", agent: "reviewer", context: "Review diff" },
			definition: {
				name: "reviewer",
				source: "user",
				filePath: "/tmp/reviewer.md",
				rawMarkdown: "---\nname: reviewer\n---\nreview body",
				frontmatter: {},
			},
			createSession: async () => failing,
		});
		expect(failed.status).toBe("failed");
		expect(failed.errorMessage).toBe("runner boom");
		expect(failing.getDisposedCount()).toBe(1);
	});

	test("awaits abort failure before disposing to avoid fire-and-forget rejection", async () => {
		const { runSingleGremlin } = await import("./gremlin-runner.ts");
		const controller = new AbortController();
		const events = [];
		const fake = createFakeSession({
			onPrompt: async () => {
				controller.abort();
				await new Promise((resolve) => setTimeout(resolve, 5));
			},
			onAbort: async () => {
				events.push("abort");
				throw new Error("abort boom");
			},
		});
		const originalDispose = fake.session.dispose;
		fake.session.dispose = () => {
			events.push("dispose");
			originalDispose();
		};

		const result = await runSingleGremlin({
			gremlinId: "g1",
			request: { intent: "Inspect implementation independently", agent: "researcher", context: "Inspect auth flow" },
			definition: {
				name: "researcher",
				source: "project",
				filePath: "/tmp/researcher.md",
				rawMarkdown: "---\nname: researcher\n---\nraw gremlin body",
				frontmatter: {},
			},
			signal: controller.signal,
			createSession: async () => fake,
		});

		expect(result.status).toBe("canceled");
		expect(fake.getDisposedCount()).toBe(1);
		expect(events).toEqual(["abort", "dispose"]);
	});
});
