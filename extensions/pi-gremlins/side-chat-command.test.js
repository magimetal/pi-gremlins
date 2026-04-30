import { beforeEach, describe, expect, test } from "bun:test";
import "./v1-contract-harness.js";

function createFakePi() {
	const commands = new Map();
	const messages = [];
	const renderers = new Map();
	return {
		commands,
		messages,
		renderers,
		registerCommand(name, options) {
			commands.set(name, options);
		},
		registerMessageRenderer(customType, renderer) {
			renderers.set(customType, renderer);
		},
		sendMessage(message) {
			messages.push(message);
		},
	};
}

function createFakeCtx({
	branchEntries = [],
	hasUI = true,
	signal,
	model,
} = {}) {
	const notifications = [];
	return {
		cwd: "/tmp",
		hasUI,
		ui: {
			notify(message, type = "info") {
				notifications.push({ message, type });
			},
		},
		notifications,
		sessionManager: {
			getBranch() {
				return branchEntries;
			},
		},
		modelRegistry: undefined,
		model,
		signal,
	};
}

function createFakeSessionFactory({ events = [], onPrompt } = {}) {
	const calls = [];
	const created = {
		session: {
			subscribe(listener) {
				const handle = setTimeout(() => {
					for (const event of events) listener(event);
				}, 0);
				return () => clearTimeout(handle);
			},
			async prompt(text) {
				if (onPrompt) await onPrompt(text);
				// emit events synchronously for deterministic ordering
				// (subscribe also schedules them, but the listener fires both)
			},
			async abort() {},
			dispose() {},
		},
		extensionsResult: {},
	};
	return {
		calls,
		impl: async (options) => {
			calls.push(options);
			return created;
		},
	};
}

async function loadCommandModule() {
	return await import("./side-chat-command.ts");
}

describe("side-chat command v1 contract", () => {
	let pi;
	beforeEach(() => {
		pi = createFakePi();
	});

	test("T1 empty arg prints chat usage via ctx.ui.notify and does not start session", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory();
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		const handler = pi.commands.get("gremlins:chat").handler;
		const ctx = createFakeCtx();
		await handler("", ctx);
		expect(ctx.notifications.length).toBe(1);
		expect(ctx.notifications[0].message).toMatch(/Usage: \/gremlins:chat/);
		expect(factory.calls.length).toBe(0);
	});

	test("T2 empty arg prints tangent usage and does not start session", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory();
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		const handler = pi.commands.get("gremlins:tangent").handler;
		const ctx = createFakeCtx();
		await handler("", ctx);
		expect(ctx.notifications.length).toBe(1);
		expect(ctx.notifications[0].message).toMatch(/Usage: \/gremlins:tangent/);
		expect(factory.calls.length).toBe(0);
	});

	test("T3 whitespace-only arg is treated as empty", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory();
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		const handler = pi.commands.get("gremlins:chat").handler;
		const ctx = createFakeCtx();
		await handler("   \t  ", ctx);
		expect(ctx.notifications.length).toBe(1);
		expect(factory.calls.length).toBe(0);
	});

	test("T4 chat handler captures parent transcript snapshot and forwards it", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory();
		registerSideChatCommands(pi, {
			createSideChatSession: factory.impl,
			capturedAtFactory: () => "CAPTURED_AT_T4",
		});
		const handler = pi.commands.get("gremlins:chat").handler;
		const ctx = createFakeCtx({
			branchEntries: [
				{
					type: "message",
					message: { role: "user", content: [{ type: "text", text: "U1" }] },
				},
				{
					type: "message",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "A1" }],
					},
				},
				// non-message entries must be ignored
				{ type: "modelChange", model: "openai/gpt-5" },
			],
		});
		await handler("summarize", ctx);
		expect(factory.calls.length).toBe(1);
		const call = factory.calls[0];
		expect(call.mode).toBe("chat");
		expect(call.userPrompt).toBe("summarize");
		expect(call.parentSnapshot).toBeDefined();
		expect(call.parentSnapshot.capturedAt).toBe("CAPTURED_AT_T4");
		expect(call.parentSnapshot.entries).toEqual([
			{ role: "user", text: "U1" },
			{ role: "assistant", text: "A1" },
		]);
	});

	test("T5 tangent handler does NOT capture parent transcript", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory();
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		const handler = pi.commands.get("gremlins:tangent").handler;
		const ctx = createFakeCtx({
			branchEntries: [
				{
					type: "message",
					message: {
						role: "user",
						content: [{ type: "text", text: "PARENT_USER" }],
					},
				},
			],
		});
		await handler("explore", ctx);
		expect(factory.calls.length).toBe(1);
		expect(factory.calls[0].mode).toBe("tangent");
		expect(factory.calls[0].parentSnapshot).toBeUndefined();
	});

	test("T6 consecutive chat invocations are independent (fresh transcript each time)", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory();
		let branch = [
			{
				type: "message",
				message: { role: "user", content: [{ type: "text", text: "FIRST" }] },
			},
		];
		registerSideChatCommands(pi, {
			createSideChatSession: factory.impl,
			capturedAtFactory: () => `t-${factory.calls.length}`,
		});
		const handler = pi.commands.get("gremlins:chat").handler;
		const ctx = {
			...createFakeCtx(),
			sessionManager: { getBranch: () => branch },
		};
		await handler("first prompt", ctx);
		// mutate parent transcript between invocations
		branch = [
			{
				type: "message",
				message: { role: "user", content: [{ type: "text", text: "SECOND" }] },
			},
		];
		await handler("second prompt", ctx);
		expect(factory.calls.length).toBe(2);
		expect(factory.calls[0].userPrompt).toBe("first prompt");
		expect(factory.calls[1].userPrompt).toBe("second prompt");
		expect(factory.calls[0].parentSnapshot.entries[0].text).toBe("FIRST");
		expect(factory.calls[1].parentSnapshot.entries[0].text).toBe("SECOND");
	});

	test("T7 tangent invocation does not see chat-mode transcript sentinel", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		const factory = createFakeSessionFactory();
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		const chatHandler = pi.commands.get("gremlins:chat").handler;
		const tangentHandler = pi.commands.get("gremlins:tangent").handler;
		const ctx = createFakeCtx({
			branchEntries: [
				{
					type: "message",
					message: {
						role: "user",
						content: [{ type: "text", text: "CHAT_SENTINEL_X" }],
					},
				},
			],
		});
		await chatHandler("c-prompt", ctx);
		await tangentHandler("t-prompt", ctx);
		expect(factory.calls.length).toBe(2);
		expect(factory.calls[1].mode).toBe("tangent");
		expect(factory.calls[1].parentSnapshot).toBeUndefined();
		// And user prompts must not bleed across:
		expect(factory.calls[0].userPrompt).toBe("c-prompt");
		expect(factory.calls[1].userPrompt).toBe("t-prompt");
	});

	test("T8 abort signal triggers session.abort during prompt", async () => {
		const { registerSideChatCommands } = await loadCommandModule();
		let aborted = false;
		let promptResolve;
		const factory = {
			calls: [],
			impl: async (options) => {
				factory.calls.push(options);
				return {
					session: {
						subscribe: () => () => {},
						prompt: () =>
							new Promise((resolve) => {
								promptResolve = resolve;
							}),
						abort: async () => {
							aborted = true;
							promptResolve?.();
						},
						dispose() {},
					},
					extensionsResult: {},
				};
			},
		};
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		const handler = pi.commands.get("gremlins:tangent").handler;
		const controller = new AbortController();
		const ctx = createFakeCtx({ signal: controller.signal });
		const handlerPromise = handler("explore", ctx);
		// Schedule abort on next tick
		await new Promise((r) => setTimeout(r, 5));
		controller.abort();
		await handlerPromise;
		expect(aborted).toBe(true);
	});

	test("T9 inline rendering: pi.sendMessage called with SIDE_CHAT_MESSAGE_TYPE and assistant text", async () => {
		const {
			registerSideChatCommands,
			SIDE_CHAT_MESSAGE_TYPE,
		} = await loadCommandModule();
		const factory = {
			calls: [],
			impl: async (options) => {
				factory.calls.push(options);
				let listener;
				return {
					session: {
						subscribe(l) {
							listener = l;
							return () => {};
						},
						prompt: async () => {
							listener?.({
								type: "message_end",
								message: {
									role: "assistant",
									content: [
										{
											type: "text",
											text: "side-chat answer payload",
										},
									],
								},
							});
						},
						abort: async () => {},
						dispose() {},
					},
					extensionsResult: {},
				};
			},
		};
		registerSideChatCommands(pi, { createSideChatSession: factory.impl });
		const handler = pi.commands.get("gremlins:tangent").handler;
		const ctx = createFakeCtx();
		await handler("ping", ctx);
		expect(pi.messages.length).toBeGreaterThanOrEqual(1);
		const last = pi.messages[pi.messages.length - 1];
		expect(last.customType).toBe(SIDE_CHAT_MESSAGE_TYPE);
		expect(last.display).toBe(true);
		expect(typeof last.content).toBe("string");
		expect(last.content).toContain("side-chat answer payload");
		expect(last.details.mode).toBe("tangent");
	});

	test("T10 visual delimiter labels exported and distinct", async () => {
		const {
			SIDE_CHAT_CHAT_LABEL,
			SIDE_CHAT_TANGENT_LABEL,
			SIDE_CHAT_FOOTER,
		} = await loadCommandModule();
		expect(typeof SIDE_CHAT_CHAT_LABEL).toBe("string");
		expect(SIDE_CHAT_CHAT_LABEL.length).toBeGreaterThan(0);
		expect(typeof SIDE_CHAT_TANGENT_LABEL).toBe("string");
		expect(SIDE_CHAT_TANGENT_LABEL.length).toBeGreaterThan(0);
		expect(SIDE_CHAT_CHAT_LABEL).not.toBe(SIDE_CHAT_TANGENT_LABEL);
		expect(typeof SIDE_CHAT_FOOTER).toBe("string");
		expect(SIDE_CHAT_FOOTER.length).toBeGreaterThan(0);
	});
});
