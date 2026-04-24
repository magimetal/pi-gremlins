import { describe, expect, test } from "bun:test";

describe("gremlin rendering v1 contract", () => {
	test("renders collapsed summary with per-gremlin status source phase and inline expand hint", async () => {
		const { renderGremlinInvocationText } = await import(
			"./gremlin-rendering.ts"
		);

		const text = renderGremlinInvocationText(
			{
				requestedCount: 2,
				activeCount: 1,
				completedCount: 0,
				failedCount: 0,
				canceledCount: 0,
				gremlins: [
					{
						gremlinId: "g1",
						agent: "researcher",
						source: "project",
						status: "active",
						currentPhase: "tool:read",
						latestText: "Scanning auth entry points",
						context: "Find auth flow",
						usage: { turns: 1, input: 10, output: 4 },
						revision: 2,
					},
					{
						gremlinId: "g2",
						agent: "reviewer",
						source: "user",
						status: "queued",
						currentPhase: "prompting",
						latestText: "",
						context: "Review auth flow",
						usage: { turns: 0, input: 0, output: 0 },
						revision: 0,
					},
				],
				revision: 2,
			},
			{ expanded: false, width: 80 },
		);

		expect(text).toContain("Gremlins🧌 · requested:2 · active:1");
		expect(text).toContain("[Active] · g1 researcher [project] · tool:read · text · Scanning");
		expect(text).toContain("[Queued] · g2 reviewer [user] · prompting · task · Review auth flow");
		expect(text).toContain("Ctrl+O expands inline detail.");
		expect(text).not.toContain("/gremlins:view");
		expect(text).not.toContain("/gremlins:steer");
		expect(text).not.toContain("popup");
	});

	test("renders narrow collapsed state readably for repeated agent names by keeping stable gremlin ids", async () => {
		const { renderGremlinInvocationText } = await import(
			"./gremlin-rendering.ts"
		);

		const text = renderGremlinInvocationText(
			{
				requestedCount: 3,
				activeCount: 2,
				completedCount: 1,
				failedCount: 0,
				canceledCount: 0,
				gremlins: [
					{
						gremlinId: "g1",
						agent: "researcher",
						source: "project",
						status: "active",
						currentPhase: "tool:read",
						latestText: "Read src/index.ts and src/app.ts before diffing",
						context: "Map auth flow",
						revision: 1,
					},
					{
						gremlinId: "g2",
						agent: "researcher",
						source: "user",
						status: "completed",
						currentPhase: "settling",
						latestText: "Summarized login redirect logic",
						context: "Review redirect flow",
						revision: 3,
					},
					{
						gremlinId: "g3",
						agent: "reviewer",
						source: "project",
						status: "starting",
						currentPhase: "prompting",
						latestText: "",
						context: "Cross-check findings",
						revision: 0,
					},
				],
				revision: 4,
			},
			{ expanded: false, width: 42 },
		);

		const lines = text.split("\n");
		expect(lines).toHaveLength(5);
		expect(lines[1]).toContain("g1 researcher");
		expect(lines[2]).toContain("g2 researcher");
		expect(lines[3]).toContain("g3 reviewer");
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(42);
		}
	});

	test("keeps collapsed preview to one visible line per gremlin even when tool output is multiline", async () => {
		const { renderGremlinInvocationText } = await import(
			"./gremlin-rendering.ts"
		);

		const text = renderGremlinInvocationText(
			{
				requestedCount: 1,
				activeCount: 1,
				completedCount: 0,
				failedCount: 0,
				canceledCount: 0,
				gremlins: [
					{
						gremlinId: "g1",
						agent: "researcher",
						source: "project",
						status: "active",
						currentPhase: "tool:read",
						latestToolResult: "line one\nline two\nline three",
						context: "Find auth flow",
						revision: 9,
					},
				],
				revision: 9,
			},
			{ expanded: false, width: 120 },
		);

		const lines = text.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[1]).toContain("line one");
		expect(lines[2]).toBe("Ctrl+O expands inline detail.");
	});

	test("surfaces live tool call in collapsed preview after assistant already emitted text", async () => {
		const { renderGremlinInvocationText } = await import(
			"./gremlin-rendering.ts"
		);

		const text = renderGremlinInvocationText(
			{
				requestedCount: 1,
				activeCount: 1,
				completedCount: 0,
				failedCount: 0,
				canceledCount: 0,
				gremlins: [
					{
						gremlinId: "g1",
						agent: "researcher",
						source: "project",
						status: "active",
						currentPhase: "tool:read",
						latestText: "Planning next search step",
						latestToolCall: "read apps/web/src/main.ts",
						context: "Find auth flow",
						revision: 10,
					},
				],
				revision: 10,
			},
			{ expanded: false, width: 120 },
		);

		expect(text).toContain("read apps/web/src/main.ts");
	});

	test("renders expanded inline detail with task model usage and no popup chrome", async () => {
		const { renderGremlinInvocationText } = await import(
			"./gremlin-rendering.ts"
		);

		const text = renderGremlinInvocationText(
			{
				requestedCount: 1,
				activeCount: 0,
				completedCount: 1,
				failedCount: 0,
				canceledCount: 0,
				gremlins: [
					{
						gremlinId: "g1",
						agent: "researcher",
						source: "project",
						status: "completed",
						currentPhase: "settling",
						latestText: "Auth flow starts in apps/web/src/main.ts",
						latestToolCall: "read apps/web/src/main.ts",
						latestToolResult: "import bootstrap from ./bootstrap",
						context: "Find auth flow",
						model: "gpt-5-mini",
						thinking: "medium",
						usage: {
							turns: 2,
							input: 22,
							output: 9,
							cacheRead: 1,
							contextTokens: 31,
						},
						revision: 5,
					},
				],
				revision: 5,
			},
			{ expanded: true, width: 100 },
		);

		expect(text).toContain("[Completed] g1 researcher [project]");
		expect(text).toContain("task · Find auth flow");
		expect(text).toContain("tool call · read apps/web/src/main.ts");
		expect(text).toContain("tool result · import bootstrap from ./bootstrap");
		expect(text).toContain("model · gpt-5-mini");
		expect(text).toContain("thinking · medium");
		expect(text).toContain("usage · turns:2 · input:22 · output:9 · cacheRead:1 · context:31");
		expect(text).not.toContain("viewer");
		expect(text).not.toContain("popup");
	});

	test("uses compact entry cache keys without embedding mutable text payloads", async () => {
		const { createEntryCacheKey } = await import("./gremlin-render-components.ts");
		const payload = "large mutable tool output ".repeat(400);

		const key = createEntryCacheKey("collapsed", {
			gremlinId: "g1",
			agent: "researcher",
			source: "project",
			status: "active",
			currentPhase: "tool:read",
			latestText: payload,
			latestToolCall: payload,
			latestToolResult: payload,
			context: "Find auth flow",
			revision: 12,
		});

		expect(key).not.toContain(payload);
		expect(key).not.toContain("large mutable tool output");
		expect(key.length).toBeLessThan(256);
	});

	test("reuses cached line computation for identical revision and options", async () => {
		const renderComponents = await import("./gremlin-render-components.ts");
		const { renderGremlinInvocationText } = await import(
			"./gremlin-rendering.ts"
		);

		const entry = {
			gremlinId: "g1",
			agent: "researcher",
			source: "project",
			status: "active",
			currentPhase: "tool:grep",
			latestText: "Searching auth service",
			context: "Find auth flow",
			revision: 7,
		};
		const details = {
			requestedCount: 1,
			activeCount: 1,
			completedCount: 0,
			failedCount: 0,
			canceledCount: 0,
			gremlins: [entry],
			revision: 7,
		};

		const collapsedA = renderComponents.formatCollapsedGremlinLine(entry);
		const collapsedB = renderComponents.formatCollapsedGremlinLine(entry);
		expect(collapsedA).toBe(collapsedB);

		const expandedA = renderComponents.formatExpandedGremlinLines(entry);
		const expandedB = renderComponents.formatExpandedGremlinLines(entry);
		expect(expandedA).toBe(expandedB);

		const renderA = renderGremlinInvocationText(details, { expanded: false, width: 90 });
		const renderB = renderGremlinInvocationText(details, { expanded: false, width: 90 });
		expect(renderA).toBe(renderB);
	});

	test("updates changed entry output while preserving unchanged entry text across revisions", async () => {
		const { renderGremlinInvocationText } = await import(
			"./gremlin-rendering.ts"
		);
		const unchangedEntry = {
			gremlinId: "g2",
			agent: "reviewer",
			source: "user",
			status: "active",
			currentPhase: "settling",
			latestText: "Review unchanged",
			context: "Review auth flow",
			revision: 4,
		};
		const before = renderGremlinInvocationText(
			{
				requestedCount: 2,
				activeCount: 2,
				completedCount: 0,
				failedCount: 0,
				canceledCount: 0,
				gremlins: [
					{
						gremlinId: "g1",
						agent: "researcher",
						source: "project",
						status: "active",
						currentPhase: "tool:read",
						latestText: "First result",
						context: "Find auth flow",
						revision: 1,
					},
					unchangedEntry,
				],
				revision: 4,
			},
			{ expanded: false, width: 120 },
		);
		const after = renderGremlinInvocationText(
			{
				requestedCount: 2,
				activeCount: 2,
				completedCount: 0,
				failedCount: 0,
				canceledCount: 0,
				gremlins: [
					{
						gremlinId: "g1",
						agent: "researcher",
						source: "project",
						status: "active",
						currentPhase: "tool:read",
						latestText: "Second result",
						context: "Find auth flow",
						revision: 2,
					},
					unchangedEntry,
				],
				revision: 5,
			},
			{ expanded: false, width: 120 },
		);

		expect(before).toContain("First result");
		expect(after).toContain("Second result");
		expect(after).not.toContain("First result");
		expect(after).toContain("Review unchanged");
	});
});
