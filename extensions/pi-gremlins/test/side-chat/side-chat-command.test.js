import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, test } from "bun:test";
import "../fixtures/v1-contract-harness.js";
import { getResourceLoaderInstances, resetV1ContractHarness } from "../fixtures/v1-contract-harness.js";
import { createWorkspace } from "../helpers/test-helpers.js";

const LEGACY_SIDE_CHAT_SKILL_SENTINEL = "ISSUE_59_LEGACY_SIDE_CHAT_SKILL_PATH_SHOULD_NOT_LEAK";

function createFakePi() {
	const commands = new Map();
	const entries = [];
	const handlers = new Map();
	return {
		commands,
		entries,
		handlers,
		registerCommand(name, options) {
			commands.set(name, options);
		},
		on(name, handler) {
			handlers.set(name, handler);
		},
		appendEntry(customType, data) {
			entries.push({ customType, data });
		},
		registerShortcut() {},
	};
}

function createFakeCtx({ branchEntries = [], hasUI = true, model, cwd = "/tmp" } = {}) {
	const notifications = [];
	const customCalls = [];
	let customComponent;
	let renderRequests = 0;
	return {
		cwd,
		hasUI,
		ui: {
			notify(message, type = "info") {
				notifications.push({ message, type });
			},
			custom(factory, _options) {
				customCalls.push(_options);
				customComponent = factory(
					{
						requestRender() { renderRequests += 1; },
						terminal: { rows: 24 },
					},
					{},
					{},
					() => {},
				);
				_options?.onHandle?.({
					hide() {},
					setHidden() {},
					isHidden: () => false,
					focus() {},
					unfocus() {},
					isFocused: () => true,
				});
				return Promise.resolve();
			},
		},
		notifications,
		customCalls,
		get customComponent() {
			return customComponent;
		},
		get renderRequests() {
			return renderRequests;
		},
		sessionManager: {
			getBranch() {
				return branchEntries;
			},
		},
		modelRegistry: undefined,
		model,
		signal: undefined,
	};
}

function createFakeSessionFactory({ events = [] } = {}) {
	const calls = [];
	const sessions = [];
	const impl = async (options) => {
		calls.push(options);
		let listener;
		const session = {
			subscribe(l) {
				listener = l;
				return () => {};
			},
			emit(event) {
				listener?.(event);
			},
			async prompt() {
				for (const event of events) listener?.(event);
			},
			async abort() {},
			dispose() {},
		};
		sessions.push(session);
		return { session, extensionsResult: {} };
	};
	return { calls, sessions, impl };
}

async function loadCommandModule() {
	return await import("../../side-chat/side-chat-command.ts");
}

describe("side-chat overlay command contract", () => {
	let pi;
	beforeEach(() => {
		pi = createFakePi();
	});

	test("registers four command surface", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		registerSideChatCommands(pi, { createSideChatSession: createFakeSessionFactory().impl });
		expect([...pi.commands.keys()].sort()).toEqual([
			"gremlins:chat",
			"gremlins:chat:new",
			"gremlins:tangent",
			"gremlins:tangent:new",
		]);
	});

	test("argument-less chat opens overlay and captures parent snapshot at thread origin", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory();
		registerSideChatCommands(pi, {
			createSideChatSession: factory.impl,
			capturedAtFactory: () => "CAPTURED_AT",
		});
		const ctx = createFakeCtx({
			branchEntries: [
				{ type: "message", message: { role: "user", content: [{ type: "text", text: "U1" }] } },
			],
		});
		await pi.commands.get("gremlins:chat").handler("", ctx);
		expect(ctx.customCalls.length).toBe(1);
		expect(factory.calls.length).toBe(0);
	});

	test("inline argument auto-submits into overlay for backward convenience", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory({
			events: [
				{ type: "message_start", message: { role: "assistant" } },
				{ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "answer" } },
				{ type: "turn_end", turnIndex: 1 },
			],
		});
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		const ctx = createFakeCtx();
		await pi.commands.get("gremlins:tangent").handler("explore", ctx);
		expect(factory.calls.length).toBe(1);
		expect(factory.calls[0].mode).toBe("tangent");
		expect(factory.calls[0].sessionConfig.tools).toBeUndefined();
		expect(Object.hasOwn(factory.calls[0].sessionConfig, "tools")).toBe(false);
		expect(pi.entries.some((entry) => entry.customType === "pi-gremlins:side-chat-thread")).toBe(true);
	});

	test("realtime transcript events request overlay render without keyboard input", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory({
			events: [
				{ type: "message_start", message: { role: "assistant" } },
				{ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "live answer" } },
			],
		});
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		const ctx = createFakeCtx();
		await pi.commands.get("gremlins:chat").handler("question", ctx);
		expect(ctx.renderRequests).toBeGreaterThan(0);
		expect(ctx.customComponent.render(72).join("\n")).toContain("live answer");
	});

	test(":new appends reset and only resets requested mode", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		registerSideChatCommands(pi, { createSideChatSession: createFakeSessionFactory().impl });
		const ctx = createFakeCtx();
		await pi.commands.get("gremlins:chat:new").handler("", ctx);
		expect(pi.entries).toContainEqual({
			customType: "pi-gremlins:side-chat-reset",
			data: expect.objectContaining({ mode: "chat" }),
		});
	});

	test("context handler filters side-chat custom messages defensively", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		registerSideChatCommands(pi, { createSideChatSession: createFakeSessionFactory().impl });
		const result = pi.handlers.get("context")({
			type: "context",
			messages: [
				{ role: "user", content: "keep" },
				{ role: "user", content: "drop", customType: "pi-gremlins:side-chat-thread" },
			],
		});
		expect(result.messages).toEqual([{ role: "user", content: "keep" }]);
	});

	test("old side-chat settings are ignored and cannot change session tools", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const { repoRoot } = createWorkspace();
		const piDir = path.join(repoRoot, ".pi");
		fs.mkdirSync(piDir, { recursive: true });
		const legacySkillDir = path.join(repoRoot, "legacy-side-chat-skill");
		fs.mkdirSync(legacySkillDir, { recursive: true });
		fs.writeFileSync(
			path.join(legacySkillDir, "SKILL.md"),
			`---\nname: legacy-side-chat-skill\ndescription: ${LEGACY_SIDE_CHAT_SKILL_SENTINEL}\n---\n\n${LEGACY_SIDE_CHAT_SKILL_SENTINEL}`,
		);
		fs.writeFileSync(path.join(piDir, "settings.json"), JSON.stringify({
			"pi-gremlins": { sideChat: { chat: { tools: ["unknown"], skillPaths: [legacySkillDir] } } },
		}));
		const factory = createFakeSessionFactory();
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		await pi.commands.get("gremlins:chat").handler("inspect", createFakeCtx({ cwd: repoRoot }));
		expect(factory.calls[0].mode).toBe("chat");
		expect(factory.calls[0].sessionConfig.tools).toBeUndefined();
		expect(factory.calls[0].sessionConfig.prompt).not.toContain(LEGACY_SIDE_CHAT_SKILL_SENTINEL);
		expect(factory.calls[0].sessionConfig.systemPrompt).not.toContain(LEGACY_SIDE_CHAT_SKILL_SENTINEL);
		expect(JSON.stringify(factory.calls[0].sessionConfig.resources)).not.toContain(LEGACY_SIDE_CHAT_SKILL_SENTINEL);
		await pi.commands.get("gremlins:tangent:new").handler("explore", createFakeCtx({ cwd: repoRoot }));
		expect(factory.calls[1].mode).toBe("tangent");
		expect(factory.calls[1].sessionConfig.tools).toBeUndefined();
		expect(factory.calls[1].sessionConfig.prompt).not.toContain("parent-transcript-snapshot");
		expect(factory.calls[1].sessionConfig.prompt).not.toContain(LEGACY_SIDE_CHAT_SKILL_SENTINEL);
		expect(factory.calls[1].sessionConfig.systemPrompt).not.toContain(LEGACY_SIDE_CHAT_SKILL_SENTINEL);
		expect(JSON.stringify(factory.calls[1].sessionConfig.resources)).not.toContain(LEGACY_SIDE_CHAT_SKILL_SENTINEL);
	});

	test("active side-chat session reuse does not construct another resource loader", async () => {
		resetV1ContractHarness();
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory();
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		const ctx = createFakeCtx();
		await pi.commands.get("gremlins:chat").handler("first", ctx);
		await pi.commands.get("gremlins:chat").handler("second", ctx);
		expect(factory.calls.length).toBe(1);
		expect(factory.sessions[0]).toBeDefined();
		expect(getResourceLoaderInstances().length).toBe(1);
	});

	test("persists overlapping prompts in submitted question order", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory();
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		const ctx = createFakeCtx();

		await pi.commands.get("gremlins:chat").handler("first", ctx);
		await pi.commands.get("gremlins:chat").handler("second", ctx);
		factory.sessions[0].emit({ type: "message_start", message: { role: "assistant" } });
		factory.sessions[0].emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "answer one" } });
		factory.sessions[0].emit({ type: "turn_end", turnIndex: 1 });
		factory.sessions[0].emit({ type: "message_start", message: { role: "assistant" } });
		factory.sessions[0].emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "answer two" } });
		factory.sessions[0].emit({ type: "turn_end", turnIndex: 2 });

		const threadEntries = pi.entries.filter(
			(entry) => entry.customType === "pi-gremlins:side-chat-thread",
		);
		expect(threadEntries.map((entry) => entry.data.question)).toEqual(["first", "second"]);
		expect(threadEntries.map((entry) => entry.data.answer)).toEqual(["answer one", "answer two"]);
	});

	test("chat and tangent pending questions do not cross-contaminate", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory();
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		const ctx = createFakeCtx();

		await pi.commands.get("gremlins:chat").handler("chat question", ctx);
		factory.sessions[0].emit({ type: "message_start", message: { role: "assistant" } });
		factory.sessions[0].emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "chat answer" } });
		factory.sessions[0].emit({ type: "turn_end", turnIndex: 1 });
		await pi.commands.get("gremlins:tangent").handler("tangent question", ctx);
		factory.sessions[1].emit({ type: "message_start", message: { role: "assistant" } });
		factory.sessions[1].emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "tangent answer" } });
		factory.sessions[1].emit({ type: "turn_end", turnIndex: 1 });

		const threadEntries = pi.entries.filter(
			(entry) => entry.customType === "pi-gremlins:side-chat-thread",
		);
		expect(threadEntries.map((entry) => ({ mode: entry.data.mode, question: entry.data.question }))).toEqual([
			{ mode: "chat", question: "chat question" },
			{ mode: "tangent", question: "tangent question" },
		]);
	});

	test("tool-like assistant events still persist a completed side-chat exchange", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory({
			events: [
				{ type: "tool_call", toolCall: { name: "read" } },
				{ type: "tool_result", toolResult: { content: "result" } },
				{ type: "message_start", message: { role: "assistant" } },
				{ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "answer" } },
				{ type: "turn_end", turnIndex: 1 },
			],
		});
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		await pi.commands.get("gremlins:tangent").handler("explore", createFakeCtx());
		const threadEntries = pi.entries.filter(
			(entry) => entry.customType === "pi-gremlins:side-chat-thread",
		);
		expect(threadEntries.length).toBe(1);
		expect(threadEntries[0].data).toEqual(expect.objectContaining({
			mode: "tangent",
			question: "explore",
			answer: "answer",
		}));
	});
});
