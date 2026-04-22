import { describe, expect, test } from "bun:test";

function createDeferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("gremlin scheduler v1 contract", () => {
	test("starts all requested gremlins in parallel immediately with no chain mode fallback and no hidden lower cap", async () => {
		const { runGremlinBatch } = await import("./gremlin-scheduler.ts");

		const first = createDeferred();
		const second = createDeferred();
		const started = [];
		const updates = [];
		const batchPromise = runGremlinBatch({
			gremlins: [
				{ agent: "alpha", context: "Find alpha" },
				{ agent: "beta", context: "Find beta" },
			],
			onUpdate: (details) => updates.push(details),
			runGremlin: async ({ gremlin, gremlinId, onUpdate }) => {
				started.push(gremlin.agent);
				onUpdate?.({ gremlinId, agent: gremlin.agent, status: "active", currentPhase: "streaming" });
				if (gremlin.agent === "alpha") return await first.promise;
				return await second.promise;
			},
		});

		await Promise.resolve();
		expect(started).toEqual(["alpha", "beta"]);
		expect(updates[0]).toMatchObject({ requestedCount: 2 });

		first.resolve({ gremlinId: "g1", agent: "alpha", source: "user", status: "completed", context: "Find alpha", latestText: "alpha done" });
		second.resolve({ gremlinId: "g2", agent: "beta", source: "user", status: "completed", context: "Find beta", latestText: "beta done" });
		const result = await batchPromise;

		expect(result.results).toEqual([
			expect.objectContaining({ gremlinId: "g1", agent: "alpha", status: "completed" }),
			expect.objectContaining({ gremlinId: "g2", agent: "beta", status: "completed" }),
		]);
		expect(result.mode).toBe("parallel");
	});

	test("preserves mixed sibling outcomes and marks aggregate error when any gremlin fails or is canceled", async () => {
		const { runGremlinBatch } = await import("./gremlin-scheduler.ts");

		const result = await runGremlinBatch({
			gremlins: [
				{ agent: "alpha", context: "Find alpha" },
				{ agent: "beta", context: "Find beta" },
				{ agent: "gamma", context: "Find gamma" },
			],
			runGremlin: async ({ gremlin, gremlinId }) => {
				if (gremlin.agent === "alpha") {
					return { gremlinId, agent: "alpha", source: "user", status: "completed", context: "Find alpha", latestText: "alpha done" };
				}
				if (gremlin.agent === "beta") {
					return { gremlinId, agent: "beta", source: "user", status: "failed", context: "Find beta", errorMessage: "beta boom" };
				}
				return { gremlinId, agent: "gamma", source: "user", status: "canceled", context: "Find gamma", errorMessage: "gamma canceled" };
			},
		});

		expect(result.results.map((entry) => entry.status)).toEqual([
			"completed",
			"failed",
			"canceled",
		]);
		expect(result.anyError).toBe(true);
		expect(result.summary).toContain("failed");
		expect(result.summary).toContain("canceled");
	});

	test("parent abort cancels all running gremlins and waits for cleanup before resolving", async () => {
		const { runGremlinBatch } = await import("./gremlin-scheduler.ts");
		const controller = new AbortController();
		const cleaned = [];

		const batchPromise = runGremlinBatch({
			gremlins: [
				{ agent: "alpha", context: "Find alpha" },
				{ agent: "beta", context: "Find beta" },
			],
			signal: controller.signal,
			runGremlin: ({ gremlin, gremlinId, signal, onUpdate }) =>
				new Promise((resolve) => {
					onUpdate?.({ gremlinId, agent: gremlin.agent, status: "active", currentPhase: "streaming" });
					signal.addEventListener(
						"abort",
						() => {
							setTimeout(() => {
								cleaned.push(gremlin.agent);
								resolve({
									gremlinId,
									agent: gremlin.agent,
									source: "user",
									status: "canceled",
									context: gremlin.context,
									errorMessage: `${gremlin.agent} canceled`,
								});
							}, 10);
						},
						{ once: true },
					);
				}),
		});

		setTimeout(() => controller.abort(), 5);
		const result = await batchPromise;
		expect(cleaned).toEqual(["alpha", "beta"]);
		expect(result.results.map((entry) => entry.status)).toEqual([
			"canceled",
			"canceled",
		]);
		expect(result.anyError).toBe(true);
	});
});
