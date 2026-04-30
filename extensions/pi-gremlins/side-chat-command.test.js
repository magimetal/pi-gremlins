import { beforeEach, describe, expect, test } from "bun:test";
import "./v1-contract-harness.js";

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

function createFakeCtx({ branchEntries = [], hasUI = true, model } = {}) {
	const notifications = [];
	const customCalls = [];
	let customComponent;
	return {
		cwd: "/tmp",
		hasUI,
		ui: {
			notify(message, type = "info") {
				notifications.push({ message, type });
			},
			custom(factory, _options) {
				customCalls.push(_options);
				customComponent = factory(
					{ requestRender() {} },
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
	return await import("./side-chat-command.ts");
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
		expect(factory.calls[0].sessionConfig.tools).toEqual([]);
		expect(pi.entries.some((entry) => entry.customType === "pi-gremlins:side-chat-thread")).toBe(true);
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
});
