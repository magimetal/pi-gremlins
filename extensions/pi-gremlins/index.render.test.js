import { beforeEach, describe, expect, test } from "bun:test";
import { INLINE_RESULT_PREVIEW_LINES } from "./gremlin-rendering.ts";
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
					{ intent: "Map auth behavior before parent edits", agent: "researcher", context: "Find auth flow" },
					{ intent: "Review auth findings independently", agent: "reviewer", context: "Review auth flow" },
				],
			}).text,
		).toBe("🕯️🔥🕯️ Summoning the gremlins: researcher, reviewer");
	});

	test("falls back to plain text when result has no structured details", () => {
		const { tool } = createExtensionHarness();

		const rendered = tool.renderResult(
			{ content: [{ type: "text", text: "Gremlin failed before details existed" }] },
			{ expanded: false },
		);

		expect(rendered.text).toBe("Gremlin failed before details existed");
	});

	test("clamps collapsed inline render output to the preview visual line limit", () => {
		const { tool } = createExtensionHarness();
		const longToken = "burst-output-".repeat(12);
		const result = {
			content: [{ type: "text", text: "model-visible content remains untouched" }],
			details: {
				requestedCount: 10,
				activeCount: 10,
				completedCount: 0,
				failedCount: 0,
				canceledCount: 0,
				gremlins: Array.from({ length: 10 }, (_, index) => ({
					gremlinId: `g${index + 1}`,
					agent: `burster-${index + 1}`,
					intent: `Emit dense output burst ${index + 1}`,
					source: "project",
					status: "active",
					context: `line one for ${index + 1}\nline two for ${index + 1}\nline three for ${index + 1}`,
					currentPhase: "streaming",
					latestText: index === 0 ? longToken : `short burst update ${index + 1}`,
					revision: index + 1,
				})),
				revision: 99,
			},
		};

		const collapsed = tool.renderResult(result, { expanded: false, isPartial: true });
		const lines = collapsed.render(32);

		expect(lines.length).toBeLessThanOrEqual(INLINE_RESULT_PREVIEW_LINES);
		expect(lines.join("\n")).toContain("Ctrl+O");
		expect(result.content[0].text).toBe("model-visible content remains untouched");
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
						intent: "Map auth behavior before parent edits",
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
						intent: "Review auth findings independently",
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
		expect(collapsed).toContain("[Active] · g1 researcher [project]");
		expect(collapsed).toContain("intent · Map auth behavior before parent edits");
		expect(collapsed).toContain("task · Find auth flow");
		expect(collapsed).toContain("latest · tool:read · Scanning route handlers");
		expect(collapsed).toContain("tool call · settling · read apps/web/src/main.ts");
		expect(collapsed).toContain("tool result · settling · import bootstrap");
		expect(collapsed).toContain("usage · turns:2 · input:20 · output:8");
		expect(collapsed).toContain("Ctrl+O expands inline detail.");
		expect(collapsed).not.toContain("/gremlins:view");
		expect(collapsed).not.toContain("popup");

		expect(expanded).toContain("[Completed] g2 reviewer [user]");
		expect(expanded).toContain("intent · Review auth findings independently");
		expect(expanded).toContain("task · Review auth flow");
		expect(expanded).toContain("tool call · read apps/web/src/main.ts");
		expect(expanded).toContain("usage · turns:2 · input:20 · output:8");
		expect(expanded).not.toContain("/gremlins:view");
		expect(expanded).not.toContain("popup");
	});
});
