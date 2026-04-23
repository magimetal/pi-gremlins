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

	test("publishes immutable snapshots with correct incremental status counts across updates", async () => {
		const { createGremlinProgressStore } = await import("./gremlin-progress-store.ts");
		const store = createGremlinProgressStore([
			{ agent: "alpha", context: "Find alpha" },
			{ agent: "beta", context: "Find beta" },
		]);

		const queued = store.snapshot();
		expect(Object.isFrozen(queued)).toBe(true);
		expect(Object.isFrozen(queued.gremlins)).toBe(true);
		expect(Object.isFrozen(queued.gremlins[1])).toBe(true);
		expect(() => {
			queued.gremlins[1].status = "failed";
		}).toThrow();
		expect(() => {
			queued.gremlins[1].usage = { turns: 99, input: 99, output: 99 };
		}).toThrow();

		const active = store.update("g1", {
			gremlinId: "g1",
			agent: "alpha",
			status: "active",
			currentPhase: "streaming",
		});
		const completed = store.complete("g1", {
			gremlinId: "g1",
			agent: "alpha",
			source: "user",
			status: "completed",
			context: "Find alpha",
			currentPhase: "settling",
			latestText: "alpha done",
		});
		const failed = store.complete("g2", {
			gremlinId: "g2",
			agent: "beta",
			source: "user",
			status: "failed",
			context: "Find beta",
			currentPhase: "settling",
			errorMessage: "beta boom",
			usage: { turns: 1, input: 2, output: 3 },
		});

		expect(queued).toMatchObject({
			activeCount: 2,
			completedCount: 0,
			failedCount: 0,
			canceledCount: 0,
		});
		expect(active).toMatchObject({
			activeCount: 2,
			completedCount: 0,
			failedCount: 0,
			canceledCount: 0,
		});
		expect(completed).toMatchObject({
			activeCount: 1,
			completedCount: 1,
			failedCount: 0,
			canceledCount: 0,
		});
		expect(failed).toMatchObject({
			activeCount: 0,
			completedCount: 1,
			failedCount: 1,
			canceledCount: 0,
		});
		expect(queued.gremlins[0].status).toBe("queued");
		expect(active.gremlins[0].status).toBe("active");
		expect(completed.gremlins[0].status).toBe("completed");
		expect(active.gremlins[1].status).toBe("queued");
		expect(failed.gremlins[1].status).toBe("failed");
		expect(failed.gremlins[1].usage).toEqual({ turns: 1, input: 2, output: 3 });
		expect(Object.isFrozen(failed.gremlins[1].usage)).toBe(true);
		expect(() => {
			failed.gremlins[1].usage.turns = 99;
		}).toThrow();
		expect(queued.gremlins[1]).toBe(active.gremlins[1]);
		expect(active.gremlins[1]).toBe(completed.gremlins[1]);
		expect(completed.gremlins[0]).not.toBe(active.gremlins[0]);
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
