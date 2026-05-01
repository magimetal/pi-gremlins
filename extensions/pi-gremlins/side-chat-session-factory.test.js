import { describe, expect, test } from "bun:test";
import "./v1-contract-harness.js";
import { getResourceLoaderInstances, resetV1ContractHarness, setCreateAgentSessionImpl } from "./v1-contract-harness.js";

const PARENT_PRIMARY_BLOCK_START = "<!-- pi-gremlins primary agent:start -->";

function makeSnapshot(entries, capturedAt = "2026-04-29T00:00:00.000Z") {
	return { entries, capturedAt };
}

function fakeToolExtension(name = "side_custom_tool") {
	return () => ({
		path: "fake-extension",
		resolvedPath: "fake-extension",
		sourceInfo: { type: "extension", path: "fake-extension" },
		handlers: new Map(),
		tools: new Map([[name, { name, description: "fake", parameters: {} }]]),
		messageRenderers: new Map(),
		commands: new Map([["hidden-command", {}]]),
		flags: new Map(),
		shortcuts: new Map(),
	});
}

describe("side-chat session factory PRD-0008/ADR-0008 contract", () => {
	test("chat and tangent omit explicit tools so SDK defaults apply", async () => {
		const { buildSideChatSessionConfig } = await import("./side-chat-session-factory.ts");
		const chat = buildSideChatSessionConfig({ mode: "chat", userPrompt: "hello" });
		const tangent = buildSideChatSessionConfig({ mode: "tangent", userPrompt: "hello" });
		expect(Object.hasOwn(chat, "tools")).toBe(false);
		expect(chat.tools).toBeUndefined();
		expect(Object.hasOwn(tangent, "tools")).toBe(false);
		expect(tangent.tools).toBeUndefined();
	});

	test("resources remain empty while resource loader strips non-tool surfaces", async () => {
		const { buildSideChatSessionConfig } = await import("./side-chat-session-factory.ts");
		const config = buildSideChatSessionConfig({ mode: "chat", userPrompt: "hello" });
		expect(config.resources).toEqual({ agents: [], extensions: [], prompts: [], skills: [], themes: [] });
		expect(config.resourceLoader.getSkills().skills).toEqual([]);
		expect(config.resourceLoader.getPrompts().prompts).toEqual([]);
		expect(config.resourceLoader.getThemes().themes).toEqual([]);
		expect(config.resourceLoader.getAgentsFiles().agentsFiles).toEqual([]);
		expect(config.resourceLoader.getAppendSystemPrompt()).toEqual([]);
		expect(config.resourceLoader.getSystemPrompt()).toBe(config.systemPrompt);
	});

	test("system prompts describe SDK defaults and extension tools without parent leakage", async () => {
		const { buildSideChatSessionConfig, SIDE_CHAT_SYSTEM_PROMPT_CHAT, SIDE_CHAT_SYSTEM_PROMPT_TANGENT } = await import("./side-chat-session-factory.ts");
		const sentinel = "PARENT_SENTINEL_BANNED_DO_NOT_LEAK";
		const chat = buildSideChatSessionConfig({
			mode: "chat",
			userPrompt: "hi",
			parentSnapshot: makeSnapshot([
				{ role: "user", text: sentinel },
				{ role: "assistant", text: PARENT_PRIMARY_BLOCK_START },
			]),
		});
		const tangent = buildSideChatSessionConfig({
			mode: "tangent",
			userPrompt: "hi",
			parentSnapshot: makeSnapshot([{ role: "user", text: sentinel }]),
		});
		expect(chat.systemPrompt).toBe(SIDE_CHAT_SYSTEM_PROMPT_CHAT);
		expect(tangent.systemPrompt).toBe(SIDE_CHAT_SYSTEM_PROMPT_TANGENT);
		for (const prompt of [chat.systemPrompt, tangent.systemPrompt]) {
			expect(prompt).toContain("SDK default built-in tools may be available");
			expect(prompt).toContain("read");
			expect(prompt).toContain("bash/shell");
			expect(prompt).toContain("edit");
			expect(prompt).toContain("write");
			expect(prompt).toContain("Enabled extension custom tools may also be available");
			expect(prompt).not.toContain("NO tools");
			expect(prompt).not.toContain("conversational-only");
			expect(prompt).not.toContain("approved read-only");
			expect(prompt).not.toContain(sentinel);
			expect(prompt).not.toContain(PARENT_PRIMARY_BLOCK_START);
		}
	});

	test("chat embeds only origin transcript snapshot in user prompt; tangent omits supplied snapshots", async () => {
		const { buildSideChatSessionConfig } = await import("./side-chat-session-factory.ts");
		const chat = buildSideChatSessionConfig({
			mode: "chat",
			userPrompt: "summarize",
			parentSnapshot: makeSnapshot([
				{ role: "user", text: "X1_USER_TURN" },
				{ role: "assistant", text: "X2_ASSISTANT_TURN" },
			]),
		});
		const tangent = buildSideChatSessionConfig({
			mode: "tangent",
			userPrompt: "what about this?",
			parentSnapshot: makeSnapshot([{ role: "user", text: "TANGENT_LEAK_SENTINEL" }]),
		});
		expect(chat.prompt).toContain("parent-transcript-snapshot");
		expect(chat.prompt).toContain("X1_USER_TURN");
		expect(chat.prompt).toContain("X2_ASSISTANT_TURN");
		expect(chat.systemPrompt).not.toContain("X1_USER_TURN");
		expect(tangent.prompt).not.toContain("parent-transcript-snapshot");
		expect(tangent.prompt).not.toContain("TANGENT_LEAK_SENTINEL");
		expect(tangent.prompt).toContain("what about this?");
	});

	test("empty snapshot, model, and thinking behavior are preserved", async () => {
		const { buildSideChatSessionConfig } = await import("./side-chat-session-factory.ts");
		const empty = buildSideChatSessionConfig({ mode: "chat", userPrompt: "first", parentSnapshot: makeSnapshot([]) });
		expect(empty.prompt).toContain("first");
		expect(empty.prompt).not.toContain("parent-transcript-snapshot");
		const inherited = buildSideChatSessionConfig({ mode: "chat", userPrompt: "hi", parentModel: "openai/gpt-5", parentThinking: "medium" });
		expect(inherited.model).toBe("openai/gpt-5");
		expect(inherited.thinking).toBe("medium");
	});

	test("createSideChatSession reloads fresh loader before createAgentSession and preserves extension tool records", async () => {
		resetV1ContractHarness();
		const { createSideChatSession } = await import("./side-chat-session-factory.ts");
		const calls = [];
		setCreateAgentSessionImpl(async (options) => {
			calls.push(options);
			const extensionResult = options.resourceLoader.getExtensions();
			expect(extensionResult.extensions.length).toBe(1);
			expect(extensionResult.extensions[0].tools.has("side_custom_tool")).toBe(true);
			expect(options.tools).toBeUndefined();
			return { session: { subscribe: () => () => {}, async prompt() {}, dispose() {} }, extensionsResult: extensionResult };
		});
		const created = await createSideChatSession({
			mode: "chat",
			userPrompt: "use extension tool",
			extensionFactories: [fakeToolExtension()],
		});
		expect(calls.length).toBe(1);
		expect(created.extensionsResult.extensions.length).toBe(1);
		const [loader] = getResourceLoaderInstances();
		expect(loader.reloadCount).toBe(1);
	});
});
