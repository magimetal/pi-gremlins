import { beforeEach, describe, expect, test } from "bun:test";
import { createExtensionHarness, resetV1ContractHarness } from "./v1-contract-harness.js";

describe("pi-gremlins index render v1", () => {
	beforeEach(() => {
		resetV1ContractHarness();
	});

	test("renders call label from gremlin names only", () => {
		const { tool } = createExtensionHarness();

		expect(
			tool.renderCall({
				gremlins: [
					{ agent: "researcher", context: "Find auth flow" },
					{ agent: "reviewer", context: "Review auth flow" },
				],
			}).text,
		).toBe("Gremlins🧌 researcher, reviewer");
	});

	test("falls back to plain text when result has no structured details", () => {
		const { tool } = createExtensionHarness();

		const rendered = tool.renderResult(
			{ content: [{ type: "text", text: "Gremlin failed before details existed" }] },
			{ expanded: false },
		);

		expect(rendered.text).toBe("Gremlin failed before details existed");
	});

	test("renders collapsed and expanded inline detail through entry point with no popup language", () => {
		const { tool } = createExtensionHarness();
		const result = {
			content: [{ type: "text", text: "unused fallback" }],
			details: {
				requestedCount: 2,
				activeCount: 1,
				completedCount: 1,
				failedCount: 0,
				canceledCount: 0,
				gremlins: [
					{
						gremlinId: "g1",
						agent: "researcher",
						source: "project",
						status: "active",
						context: "Find auth flow",
						currentPhase: "tool:read",
						latestText: "Scanning route handlers",
						revision: 3,
					},
					{
						gremlinId: "g2",
						agent: "reviewer",
						source: "user",
						status: "completed",
						context: "Review auth flow",
						currentPhase: "settling",
						latestText: "Review complete",
						latestToolCall: "read apps/web/src/main.ts",
						latestToolResult: "import bootstrap",
						model: "gpt-5-mini",
						usage: { turns: 2, input: 20, output: 8 },
						revision: 4,
					},
				],
				revision: 4,
			},
		};

		const collapsed = tool.renderResult(result, { expanded: false }).text;
		const expanded = tool.renderResult(result, { expanded: true }).text;

		expect(collapsed).toContain("Gremlins🧌 · requested:2 · active:1 · completed:1");
		expect(collapsed).toContain("[Active] · g1 researcher [project] · tool:read · Scanning route handlers");
		expect(collapsed).toContain("Ctrl+O expands inline detail.");
		expect(collapsed).not.toContain("/gremlins:view");
		expect(collapsed).not.toContain("popup");

		expect(expanded).toContain("[Completed] g2 reviewer [user]");
		expect(expanded).toContain("task · Review auth flow");
		expect(expanded).toContain("tool call · read apps/web/src/main.ts");
		expect(expanded).toContain("usage · turns:2 · input:20 · output:8");
		expect(expanded).not.toContain("/gremlins:view");
		expect(expanded).not.toContain("popup");
	});
});
