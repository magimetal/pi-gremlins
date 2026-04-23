import { beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createExecutionContext, createExtensionHarness, resetV1ContractHarness, setCreateAgentSessionImpl, setMockAgentDir } from "./v1-contract-harness.js";
import { createWorkspace } from "./test-helpers.js";

function writeGremlinFile(dir, fileName, name, extraFrontmatter = "") {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, fileName),
		`---\nname: ${name}\ndescription: ${name} description\n${extraFrontmatter}---\n${name} system prompt`,
		"utf-8",
	);
}

function createMockSession(events) {
	const listeners = new Set();
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async prompt() {
			for (const event of events) {
				for (const listener of listeners) listener(event);
			}
		},
		async abort() {},
		dispose() {},
	};
}

describe("pi-gremlins index execute v1", () => {
	beforeEach(() => {
		resetV1ContractHarness();
	});

	test("registers only tool and no legacy viewer or steering commands", () => {
		const { tool, commands } = createExtensionHarness();

		expect(tool.name).toBe("pi-gremlins");
		expect(Array.from(commands.keys())).toEqual([]);
	});

	test("rejects legacy parameter shapes at execute boundary", async () => {
		const workspace = createWorkspace();
		setMockAgentDir(workspace.userRoot);
		const { tool } = createExtensionHarness();
		const ctx = createExecutionContext(workspace.repoRoot);

		const result = await tool.execute(
			"legacy-params",
			{ agent: "researcher", task: "Find auth flow" },
			undefined,
			undefined,
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Invalid parameters");
		expect(result.details.requestedCount).toBe(0);
		expect(result.details.gremlins).toEqual([]);
	});

	test("executes discovered gremlin through live child session path and streams inline updates", async () => {
		const workspace = createWorkspace();
		setMockAgentDir(workspace.userRoot);
		const { tool } = createExtensionHarness();
		writeGremlinFile(workspace.userAgentsDir, "researcher.md", "researcher", "model: openai/gpt-5-mini\n");

		setCreateAgentSessionImpl(async () => ({
			session: createMockSession([
				{ type: "agent_start" },
				{ type: "turn_start" },
				{
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "Scanning auth flow" },
				},
				{
					type: "tool_execution_start",
					toolName: "read",
					args: { path: "apps/web/src/main.ts" },
				},
				{
					type: "tool_execution_end",
					toolName: "read",
					result: { content: [{ type: "text", text: "import bootstrap" }] },
				},
				{
					type: "message_end",
					message: {
						content: [{ type: "text", text: "Auth flow starts in apps/web/src/main.ts" }],
						model: "openai/gpt-5-mini",
						usage: { input: 12, output: 5, totalTokens: 17 },
					},
				},
				{ type: "agent_end" },
			]),
			extensionsResult: {},
		}));

		const updates = [];
		const ctx = createExecutionContext(workspace.repoRoot);
		const result = await tool.execute(
			"run-known-gremlin",
			{ gremlins: [{ agent: "researcher", context: "Find auth flow" }] },
			undefined,
			(update) => updates.push(update),
			ctx,
		);

		expect(updates.length).toBeGreaterThan(1);
		expect(updates.some((update) => update.details.gremlins[0].status === "queued")).toBe(true);
		expect(
			updates.some(
				(update) =>
					update.details.gremlins[0].latestText === "Scanning auth flow" ||
					update.details.gremlins[0].latestText ===
						"Auth flow starts in apps/web/src/main.ts",
			),
		).toBe(true);
		expect(result.isError).toBeUndefined();
		expect(result.details.gremlins).toHaveLength(1);
		expect(result.details.gremlins[0]).toMatchObject({
			gremlinId: "g1",
			agent: "researcher",
			source: "user",
			status: "completed",
			currentPhase: "settling",
			latestText: "Auth flow starts in apps/web/src/main.ts",
			latestToolCall: "read apps/web/src/main.ts",
			latestToolResult: "import bootstrap",
			model: "openai/gpt-5-mini",
		});
		expect(result.content[0].text).toContain("[Completed] · g1 researcher [user]");
	});

	test("streaming update text switches to live tool activity after early assistant text", async () => {
		const workspace = createWorkspace();
		setMockAgentDir(workspace.userRoot);
		const { tool } = createExtensionHarness();
		writeGremlinFile(workspace.userAgentsDir, "researcher.md", "researcher", "model: openai/gpt-5-mini\n");

		setCreateAgentSessionImpl(async () => ({
			session: createMockSession([
				{ type: "agent_start" },
				{ type: "turn_start" },
				{
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "Planning next search step" },
				},
				{
					type: "tool_execution_start",
					toolName: "read",
					args: { path: "apps/web/src/main.ts" },
				},
			]),
			extensionsResult: {},
		}));

		const updates = [];
		const ctx = createExecutionContext(workspace.repoRoot);
		await tool.execute(
			"run-known-gremlin-tool-visibility",
			{ gremlins: [{ agent: "researcher", context: "Find auth flow" }] },
			undefined,
			(update) => updates.push(update),
			ctx,
		);

		const toolPhaseUpdate = updates.find(
			(update) => update.details.gremlins[0].currentPhase === "tool:read",
		);
		expect(toolPhaseUpdate).toBeDefined();
		expect(toolPhaseUpdate.content[0].text).toContain("read apps/web/src/main.ts");
	});

	test("returns explicit failed result for unknown gremlin names", async () => {
		const workspace = createWorkspace();
		setMockAgentDir(workspace.userRoot);
		const { tool } = createExtensionHarness();
		const ctx = createExecutionContext(workspace.repoRoot);

		const result = await tool.execute(
			"unknown-gremlin",
			{ gremlins: [{ agent: "missing", context: "Do work" }] },
			undefined,
			undefined,
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(result.details.gremlins[0]).toMatchObject({
			gremlinId: "g1",
			agent: "missing",
			source: "unknown",
			status: "failed",
			errorMessage: "Unknown gremlin: missing",
		});
		expect(result.content[0].text).toContain("Unknown gremlin: missing");
	});
});
