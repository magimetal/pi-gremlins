import { describe, expect, test } from "bun:test";
import "./v1-contract-harness.js";

const PARENT_PRIMARY_BLOCK_START = "<!-- pi-gremlins primary agent:start -->";

function makeSnapshot(entries, capturedAt = "2026-04-29T00:00:00.000Z") {
	return { entries, capturedAt };
}

describe("side-chat session factory v1 contract", () => {
	test("T1 chat mode emits zero tools (empty array, not undefined)", async () => {
		const { buildSideChatSessionConfig } = await import(
			"./side-chat-session-factory.ts"
		);
		const config = buildSideChatSessionConfig({
			mode: "chat",
			userPrompt: "hello",
		});
		expect(Array.isArray(config.tools)).toBe(true);
		expect(config.tools.length).toBe(0);
		expect(config.tools).toEqual([]);
	});

	test("T2 tangent mode emits zero tools", async () => {
		const { buildSideChatSessionConfig } = await import(
			"./side-chat-session-factory.ts"
		);
		const config = buildSideChatSessionConfig({
			mode: "tangent",
			userPrompt: "hello",
		});
		expect(Array.isArray(config.tools)).toBe(true);
		expect(config.tools.length).toBe(0);
	});

	test("T3 resources are empty (ADR-0003 isolation primitive)", async () => {
		const { buildSideChatSessionConfig } = await import(
			"./side-chat-session-factory.ts"
		);
		const config = buildSideChatSessionConfig({
			mode: "chat",
			userPrompt: "hello",
		});
		expect(config.resources).toEqual({
			agents: [],
			extensions: [],
			prompts: [],
			skills: [],
			themes: [],
		});
	});

	test("T4 resourceLoader getters return empty results", async () => {
		const { buildSideChatSessionConfig } = await import(
			"./side-chat-session-factory.ts"
		);
		const config = buildSideChatSessionConfig({
			mode: "tangent",
			userPrompt: "hello",
		});
		expect(config.resourceLoader.getExtensions().extensions).toEqual([]);
		expect(config.resourceLoader.getSkills().skills).toEqual([]);
		expect(config.resourceLoader.getPrompts().prompts).toEqual([]);
		expect(config.resourceLoader.getThemes().themes).toEqual([]);
		expect(config.resourceLoader.getAgentsFiles().agentsFiles).toEqual([]);
		expect(config.resourceLoader.getAppendSystemPrompt()).toEqual([]);
		expect(config.resourceLoader.getSystemPrompt()).toBe(config.systemPrompt);
	});

	test("T5 system prompt is fixed and isolated from any parent text", async () => {
		const {
			buildSideChatSessionConfig,
			SIDE_CHAT_SYSTEM_PROMPT_CHAT,
			SIDE_CHAT_SYSTEM_PROMPT_TANGENT,
		} = await import("./side-chat-session-factory.ts");
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
		expect(chat.systemPrompt).not.toContain(sentinel);
		expect(chat.systemPrompt).not.toContain(PARENT_PRIMARY_BLOCK_START);
		expect(chat.systemPrompt).not.toContain("AGENTS.md");
		expect(tangent.systemPrompt).not.toContain(sentinel);
	});

	test("T6 tangent mode passes no parent transcript even if supplied", async () => {
		const { buildSideChatSessionConfig } = await import(
			"./side-chat-session-factory.ts"
		);
		const sentinel = "TANGENT_LEAK_SENTINEL";
		const config = buildSideChatSessionConfig({
			mode: "tangent",
			userPrompt: "what about this?",
			parentSnapshot: makeSnapshot([{ role: "user", text: sentinel }]),
		});
		expect(config.prompt).not.toContain("parent-transcript-snapshot");
		expect(config.prompt).not.toContain(sentinel);
		expect(config.prompt).toContain("<side-chat-question>");
		expect(config.prompt).toContain("what about this?");
	});

	test("T7 chat mode embeds snapshot only as input prompt, not system prompt", async () => {
		const { buildSideChatSessionConfig } = await import(
			"./side-chat-session-factory.ts"
		);
		const config = buildSideChatSessionConfig({
			mode: "chat",
			userPrompt: "summarize",
			parentSnapshot: makeSnapshot([
				{ role: "user", text: "X1_USER_TURN" },
				{ role: "assistant", text: "X2_ASSISTANT_TURN" },
			]),
		});
		expect(config.prompt).toContain("X1_USER_TURN");
		expect(config.prompt).toContain("X2_ASSISTANT_TURN");
		expect(config.prompt).toContain("parent-transcript-snapshot");
		expect(config.systemPrompt).not.toContain("X1_USER_TURN");
		expect(config.systemPrompt).not.toContain("X2_ASSISTANT_TURN");
		expect(config.tools).toEqual([]);
		expect(config.resources.extensions).toEqual([]);
	});

	test("T8 empty snapshot in chat mode is allowed and omits transcript block", async () => {
		const { buildSideChatSessionConfig } = await import(
			"./side-chat-session-factory.ts"
		);
		const config = buildSideChatSessionConfig({
			mode: "chat",
			userPrompt: "first message",
			parentSnapshot: makeSnapshot([]),
		});
		expect(config.prompt).toContain("<side-chat-question>");
		expect(config.prompt).toContain("first message");
		expect(config.prompt).not.toContain("parent-transcript-snapshot");
	});

	test("T9 model and thinking inherit from parent when supplied", async () => {
		const { buildSideChatSessionConfig } = await import(
			"./side-chat-session-factory.ts"
		);
		const config = buildSideChatSessionConfig({
			mode: "chat",
			userPrompt: "hi",
			parentModel: "openai/gpt-5",
			parentThinking: "medium",
		});
		expect(config.model).toBe("openai/gpt-5");
		expect(config.thinking).toBe("medium");
	});
});
