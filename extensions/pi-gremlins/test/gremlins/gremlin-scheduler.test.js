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
	test("starts gremlins with bounded concurrency while preserving request order", async () => {
		const { DEFAULT_GREMLIN_BATCH_CONCURRENCY, runGremlinBatch } = await import("../../gremlins/gremlin-scheduler.ts");

		const deferreds = Array.from({ length: DEFAULT_GREMLIN_BATCH_CONCURRENCY + 2 }, createDeferred);
		const started = [];
		let active = 0;
		let maxActive = 0;
		const updates = [];
		const batchPromise = runGremlinBatch({
			gremlins: deferreds.map((_deferred, index) => ({
				intent: `Find ${index} independently`,
				agent: `agent-${index}`,
				context: `Find ${index}`,
			})),
			onUpdate: (details) => updates.push(details),
			runGremlin: async ({ gremlin, gremlinId, onUpdate }) => {
				const index = Number(gremlin.agent.replace("agent-", ""));
				started.push(gremlin.agent);
				active++;
				maxActive = Math.max(maxActive, active);
				onUpdate?.({ gremlinId, agent: gremlin.agent, status: "active", currentPhase: "streaming" });
				try {
					return await deferreds[index].promise;
				} finally {
					active--;
				}
			},
		});

		await Promise.resolve();
		expect(started).toEqual(["agent-0", "agent-1", "agent-2", "agent-3"]);
		expect(maxActive).toBeLessThanOrEqual(DEFAULT_GREMLIN_BATCH_CONCURRENCY);
		expect(updates[0]).toMatchObject({ requestedCount: deferreds.length });

		for (let index = deferreds.length - 1; index >= 0; index--) {
			deferreds[index].resolve({ gremlinId: `g${index + 1}`, agent: `agent-${index}`, source: "user", status: "completed", context: `Find ${index}`, latestText: `${index} done` });
			await Promise.resolve();
		}
		const result = await batchPromise;

		expect(result.results.map((entry) => entry.gremlinId)).toEqual(["g1", "g2", "g3", "g4", "g5", "g6"]);
		expect(result.results.map((entry) => entry.agent)).toEqual(["agent-0", "agent-1", "agent-2", "agent-3", "agent-4", "agent-5"]);
		expect(result.mode).toBe("parallel");
	});

	test("publishes immutable snapshots with correct incremental status counts across updates", async () => {
		const { createGremlinProgressStore } = await import("../../gremlins/gremlin-progress-store.ts");
		const store = createGremlinProgressStore([
			{ intent: "Find alpha independently", agent: "alpha", context: "Find alpha" },
			{ intent: "Find beta independently", agent: "beta", context: "Find beta" },
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
		const { runGremlinBatch } = await import("../../gremlins/gremlin-scheduler.ts");

		const result = await runGremlinBatch({
			gremlins: [
				{ intent: "Find alpha independently", agent: "alpha", context: "Find alpha" },
				{ intent: "Find beta independently", agent: "beta", context: "Find beta" },
				{ intent: "Find gamma independently", agent: "gamma", context: "Find gamma" },
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

	test("parent abort cancels running and queued gremlins without starting queued work", async () => {
		const { DEFAULT_GREMLIN_BATCH_CONCURRENCY, runGremlinBatch } = await import("../../gremlins/gremlin-scheduler.ts");
		const controller = new AbortController();
		const cleaned = [];
		const started = [];
		const updates = [];

		const batchPromise = runGremlinBatch({
			gremlins: Array.from({ length: DEFAULT_GREMLIN_BATCH_CONCURRENCY + 2 }, (_value, index) => ({
				intent: `Find ${index} independently`,
				agent: `agent-${index}`,
				context: `Find ${index}`,
			})),
			signal: controller.signal,
			onUpdate: (details) => updates.push(details),
			runGremlin: ({ gremlin, gremlinId, signal, onUpdate }) =>
				new Promise((resolve) => {
					started.push(gremlin.agent);
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

		await Promise.resolve();
		expect(started).toEqual(["agent-0", "agent-1", "agent-2", "agent-3"]);
		controller.abort();
		expect(cleaned).toEqual([]);
		expect(
			updates.some(
				(details) => details.canceledCount === DEFAULT_GREMLIN_BATCH_CONCURRENCY + 2 && details.activeCount === 0,
			),
		).toBe(true);
		const result = await batchPromise;
		expect(cleaned).toEqual(["agent-0", "agent-1", "agent-2", "agent-3"]);
		expect(started).toEqual(["agent-0", "agent-1", "agent-2", "agent-3"]);
		expect(result.results.map((entry) => entry.gremlinId)).toEqual(["g1", "g2", "g3", "g4", "g5", "g6"]);
		expect(result.results.map((entry) => entry.status)).toEqual([
			"canceled",
			"canceled",
			"canceled",
			"canceled",
			"canceled",
			"canceled",
		]);
		expect(result.anyError).toBe(true);
	});
});
