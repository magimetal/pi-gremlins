import { describe, expect, test } from "bun:test";

function createCtx() {
	const notifications = [];
	return {
		notifications,
		ui: {
			notify(message, type = "info") {
				notifications.push({ message, type });
			},
		},
	};
}

function createRegistry(resolveResult) {
	return {
		resolveCalls: [],
		resolveActiveGremlinSession(gremlinId) {
			this.resolveCalls.push(gremlinId);
			return typeof resolveResult === "function" ? resolveResult(gremlinId) : resolveResult;
		},
		registerActiveGremlinSession() {
			throw new Error("not used");
		},
		unregisterActiveGremlinSession() {
			throw new Error("not used");
		},
		clearActiveGremlinSessions() {},
	};
}

describe("gremlin steer command", () => {
	test("parses string args, first non-empty token as id, and preserves message body", async () => {
		const { parseGremlinSteerArgs } = await import("./gremlin-steer-command.ts");
		expect(parseGremlinSteerArgs("  G1   keep investigating auth  flow!  ")).toEqual({
			ok: true,
			value: { gremlinId: "G1", message: "keep investigating auth  flow!  " },
		});
		expect(parseGremlinSteerArgs("")).toEqual({ ok: false, reason: "missing-id" });
		expect(parseGremlinSteerArgs("g1   \t  ")).toEqual({ ok: false, reason: "missing-message" });
	});

	test("missing id and message notify without resolving or steering", async () => {
		const { createGremlinSteerCommandHandler } = await import("./gremlin-steer-command.ts");
		const registry = createRegistry({ status: "missing" });
		const handler = createGremlinSteerCommandHandler(registry);
		const missingIdCtx = createCtx();
		await handler("", missingIdCtx);
		const missingMessageCtx = createCtx();
		await handler("g1", missingMessageCtx);

		expect(registry.resolveCalls).toEqual([]);
		expect(missingIdCtx.notifications[0]).toMatchObject({ type: "warning" });
		expect(missingIdCtx.notifications[0].message).toContain("Usage: /gremlins:steer <G-id> <message>");
		expect(missingMessageCtx.notifications[0]).toMatchObject({ type: "warning" });
		expect(missingMessageCtx.notifications[0].message).toContain("steering message");
	});

	test("unknown and ambiguous ids fail closed without calling steer", async () => {
		const { createGremlinSteerCommandHandler } = await import("./gremlin-steer-command.ts");
		let steerCalls = 0;
		const unknownCtx = createCtx();
		await createGremlinSteerCommandHandler(createRegistry({ status: "missing" }))("G1 investigate", unknownCtx);
		expect(unknownCtx.notifications[0]).toMatchObject({ type: "warning" });
		expect(unknownCtx.notifications[0].message).toContain("No active gremlin found for G1");

		const ambiguousCtx = createCtx();
		await createGremlinSteerCommandHandler(createRegistry({ status: "ambiguous", matches: [{}, {}] }))("g1 investigate", ambiguousCtx);
		expect(ambiguousCtx.notifications[0]).toMatchObject({ type: "warning" });
		expect(ambiguousCtx.notifications[0].message).toContain("Ambiguous active gremlin id g1");
		expect(steerCalls).toBe(0);
	});

	test("awaits child session steer exactly once, then notifies success", async () => {
		const { createGremlinSteerCommandHandler } = await import("./gremlin-steer-command.ts");
		const order = [];
		const steerMessages = [];
		let resolveSteer;
		const steerPromise = new Promise((resolve) => {
			resolveSteer = resolve;
		});
		const registry = createRegistry({
			status: "active",
			entry: {
				gremlinId: "g1",
				agent: "researcher",
				session: {
					async steer(message) {
						steerMessages.push(message);
						order.push("steer-start");
						await steerPromise;
						order.push("steer-end");
					},
				},
			},
		});
		const ctx = createCtx();
		const promise = createGremlinSteerCommandHandler(registry)("G1 keep investigating auth flow", ctx);
		await Promise.resolve();
		expect(ctx.notifications).toEqual([]);
		resolveSteer();
		await promise;

		expect(steerMessages).toEqual(["keep investigating auth flow"]);
		expect(order).toEqual(["steer-start", "steer-end"]);
		expect(ctx.notifications).toEqual([{ message: "Steering queued for g1 (researcher).", type: "info" }]);
	});

	test("steer rejection notifies failure with no success", async () => {
		const { createGremlinSteerCommandHandler } = await import("./gremlin-steer-command.ts");
		const registry = createRegistry({
			status: "active",
			entry: {
				gremlinId: "g1",
				agent: "researcher",
				session: {
					async steer() {
						throw new Error("disposed");
					},
				},
			},
		});
		const ctx = createCtx();
		await createGremlinSteerCommandHandler(registry)("g1 continue", ctx);
		expect(ctx.notifications).toEqual([{ message: "Failed to steer g1 (researcher): disposed", type: "error" }]);
	});
});
