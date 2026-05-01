import { describe, expect, test } from "bun:test";

function createSession() {
	return { async steer() {} };
}

describe("active gremlin session registry", () => {
	test("registers, resolves case-insensitively, unregisters exactly, and clears", async () => {
		const { createActiveGremlinSessionRegistry } = await import("./gremlin-session-registry.ts");
		const registry = createActiveGremlinSessionRegistry();
		const session = createSession();

		const handle = registry.registerActiveGremlinSession({
			gremlinId: "g1",
			toolCallId: "call-a",
			agent: "researcher",
			session,
		});

		expect(registry.resolveActiveGremlinSession("G1")).toMatchObject({
			status: "active",
			entry: { gremlinId: "g1", normalizedGremlinId: "g1", toolCallId: "call-a", agent: "researcher", session },
		});
		expect(registry.unregisterActiveGremlinSession(handle)).toBe(true);
		expect(registry.unregisterActiveGremlinSession(handle)).toBe(false);
		expect(registry.resolveActiveGremlinSession("g1")).toEqual({ status: "missing" });

		registry.registerActiveGremlinSession({ gremlinId: "g2", toolCallId: "call-b", agent: "reviewer", session: createSession() });
		expect(registry.resolveActiveGremlinSession("g2").status).toBe("active");
		registry.clearActiveGremlinSessions();
		expect(registry.resolveActiveGremlinSession("g2")).toEqual({ status: "missing" });
	});

	test("duplicate display ids are ambiguous and exact unregister leaves the remaining session active", async () => {
		const { createActiveGremlinSessionRegistry } = await import("./gremlin-session-registry.ts");
		const registry = createActiveGremlinSessionRegistry();
		const firstSession = createSession();
		const secondSession = createSession();
		const firstHandle = registry.registerActiveGremlinSession({
			gremlinId: "g1",
			toolCallId: "call-a",
			agent: "researcher",
			session: firstSession,
		});
		const secondHandle = registry.registerActiveGremlinSession({
			gremlinId: "G1",
			toolCallId: "call-b",
			agent: "reviewer",
			session: secondSession,
		});

		const ambiguous = registry.resolveActiveGremlinSession("g1");
		expect(ambiguous.status).toBe("ambiguous");
		expect(ambiguous.matches).toHaveLength(2);

		expect(registry.unregisterActiveGremlinSession(firstHandle)).toBe(true);
		expect(registry.resolveActiveGremlinSession("g1")).toMatchObject({
			status: "active",
			entry: { gremlinId: "G1", toolCallId: "call-b", session: secondSession },
		});
		expect(registry.unregisterActiveGremlinSession(secondHandle)).toBe(true);
		expect(registry.resolveActiveGremlinSession("g1")).toEqual({ status: "missing" });
	});

	test("unknown and blank ids fail closed", async () => {
		const { createActiveGremlinSessionRegistry } = await import("./gremlin-session-registry.ts");
		const registry = createActiveGremlinSessionRegistry();
		registry.registerActiveGremlinSession({ gremlinId: "g1", toolCallId: "call-a", agent: "researcher", session: createSession() });
		expect(registry.resolveActiveGremlinSession("g9")).toEqual({ status: "missing" });
		expect(registry.resolveActiveGremlinSession("   ")).toEqual({ status: "missing" });
	});
});
