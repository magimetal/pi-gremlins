import { describe, expect, test } from "bun:test";
import "../fixtures/v1-contract-harness.js";

function createRegistry(resolveResult) {
	return {
		resolveCalls: [],
		resolveActiveGremlinSession(gremlinId) {
			this.resolveCalls.push(gremlinId);
			return typeof resolveResult === "function" ? resolveResult(gremlinId) : resolveResult;
		},
		registerActiveGremlinSession() { throw new Error("not used"); },
		unregisterActiveGremlinSession() { throw new Error("not used"); },
		clearActiveGremlinSessions() {},
	};
}

function createCtx() {
	const notifications = [];
	const handles = [];
	const components = [];
	return {
		notifications,
		handles,
		components,
		hasUI: true,
		ui: {
			notify(message, type = "info") { notifications.push({ message, type }); },
			custom(factory, options) {
				const handle = {
					hidden: false,
					focused: false,
					setHidden(value) { this.hidden = value; },
					focus() { this.focused = true; },
					isFocused() { return this.focused; },
					unfocus() { this.focused = false; },
					hide() { this.hidden = true; },
				};
				options.onHandle(handle);
				handles.push(handle);
				components.push(factory({ requestRender() {}, terminal: { rows: 30 } }, {}, {}, () => {}));
				return new Promise(() => {});
			},
		},
	};
}

describe("gremlin open command", () => {
	test("opens the only known gremlin when no id is supplied", async () => {
		const { createGremlinOpenCommandHandler } = await import("../../gremlins/gremlin-open-command.ts");
		const { createGremlinSessionTranscriptStore } = await import("../../gremlins/gremlin-session-transcript-store.ts");
		const store = createGremlinSessionTranscriptStore();
		store.upsertSession({ gremlinId: "g1", toolCallId: "tool-a", agent: "researcher", status: "completed" });
		store.recordStatus({ gremlinId: "g1", toolCallId: "tool-a", text: "done" });
		const ctx = createCtx();
		await createGremlinOpenCommandHandler(store, createRegistry({ status: "missing" }))("", ctx);

		expect(ctx.notifications).toEqual([]);
		expect(ctx.handles[0].focused).toBe(true);
		const rendered = ctx.components[0].render(90).join("\n");
		expect(rendered).toContain("g1 · researcher");
		expect(rendered).toContain("read-only");
		expect(rendered).toContain("done");
	});

	test("no-arg open warns instead of guessing when multiple gremlins are known", async () => {
		const { createGremlinOpenCommandHandler } = await import("../../gremlins/gremlin-open-command.ts");
		const { createGremlinSessionTranscriptStore } = await import("../../gremlins/gremlin-session-transcript-store.ts");
		const store = createGremlinSessionTranscriptStore();
		store.upsertSession({ gremlinId: "g1", toolCallId: "tool-a", agent: "a" });
		store.upsertSession({ gremlinId: "g2", toolCallId: "tool-a", agent: "b" });
		const ctx = createCtx();
		await createGremlinOpenCommandHandler(store, createRegistry({ status: "missing" }))("", ctx);
		expect(ctx.notifications[0]).toMatchObject({ type: "warning" });
		expect(ctx.notifications[0].message).toContain("Multiple gremlin sessions are known");
		expect(ctx.handles).toEqual([]);
	});

	test("enter in active overlay steers through active session and records visible status", async () => {
		const { createGremlinOpenCommandHandler } = await import("../../gremlins/gremlin-open-command.ts");
		const { createGremlinSessionTranscriptStore } = await import("../../gremlins/gremlin-session-transcript-store.ts");
		const store = createGremlinSessionTranscriptStore();
		store.upsertSession({ gremlinId: "g1", toolCallId: "tool-a", agent: "researcher", status: "active" });
		const steerMessages = [];
		const steeringEvents = [];
		const registry = createRegistry({
			status: "active",
			entry: {
				gremlinId: "g1",
				agent: "researcher",
				session: { steer(message) { steerMessages.push(message); } },
				recordSteeringEvent(event) { steeringEvents.push(event); },
			},
		});
		const ctx = createCtx();
		await createGremlinOpenCommandHandler(store, registry)("g1", ctx);
		ctx.components[0].handleInput("g");
		ctx.components[0].handleInput("o");
		ctx.components[0].handleInput("\r");
		await Promise.resolve();

		expect(steerMessages).toEqual(["go"]);
		expect(steeringEvents).toEqual([{ status: "queued", message: "go" }]);
		expect(store.resolveGremlinTranscript("g1").entry.transcript.rows.at(-1)).toMatchObject({ text: "you steered: go" });
	});
});
