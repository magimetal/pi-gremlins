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
		expect(text).toContain("[Active] · g1 researcher [project]");
		expect(text).toContain("task · Find auth flow");
		expect(text).toContain("latest · tool:read · Scanning auth entry points");
		expect(text).toContain("usage · turns:1 · input:10 · output:4");
		expect(text).toContain("[Queued] · g2 reviewer [user]");
		expect(text).toContain("task · prompting · Review auth flow");
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
		expect(lines).toContain("[Active] · g1 researcher [project]");
		expect(lines).toContain("[Completed] · g2 researcher [user]");
		expect(lines).toContain("[Starting] · g3 reviewer [project]");
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(42);
		}
	});

	test("keeps multiline collapsed activity previews on one visible line", async () => {
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
		expect(lines).toHaveLength(5);
		expect(lines[1]).toBe("[Active] · g1 researcher [project]");
		expect(lines[2]).toBe("task · Find auth flow");
		expect(lines[3]).toBe("tool result · tool:read · line one line two line three");
		expect(lines[4]).toBe("Ctrl+O expands inline detail.");
	});

	test("renders three context lines then three recent activities and usage in collapsed mode", async () => {
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
						context: "Line one\nLine two\nLine three\nLine four",
						activities: [
							{ kind: "task", phase: "prompting", text: "Prompt sent", sequence: 1 },
							{ kind: "text", phase: "streaming", text: "Planning", sequence: 2 },
							{ kind: "tool-call", phase: "tool:read", text: "read src/index.ts", sequence: 3 },
							{ kind: "tool-result", phase: "streaming", text: "read complete", sequence: 4 },
						],
						usage: { turns: 2, input: 20, output: 8 },
						revision: 4,
					},
				],
				revision: 4,
			},
			{ expanded: false, width: 120 },
		);

		const lines = text.split("\n");
		expect(lines).toContain("task · Line one");
		expect(lines).toContain("task · Line two");
		expect(lines).toContain("task · Line three");
		expect(text).not.toContain("Line four");
		expect(text).not.toContain("Prompt sent");
		expect(lines).toContain("latest · streaming · Planning");
		expect(lines).toContain("tool call · tool:read · read src/index.ts");
		expect(lines).toContain("tool result · streaming · read complete");
		expect(lines).toContain("usage · turns:2 · input:20 · output:8");
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

		const collapsedA = renderComponents.formatCollapsedGremlinLines(entry);
		const collapsedB = renderComponents.formatCollapsedGremlinLines(entry);
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
