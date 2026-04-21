import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { execSync } from "node:child_process";
import * as fs from "node:fs";

import {
	createMockProcess,
	createTheme,
	createWorkspace,
	flattenRenderedNode,
	jsonLine,
	MockContainer,
	MockMarkdown,
	MockSpacer,
	MockText,
	parseFrontmatter,
	writeAgentFile,
} from "./test-helpers.js";

let mockAgentDir = "/tmp";
let spawnPlans = [];

mock.module("node:child_process", () => ({
	execSync,
	spawn: () => {
		const next = spawnPlans.shift();
		return next ? next() : createMockProcess();
	},
}));

mock.module("@mariozechner/pi-coding-agent", () => ({
	DefaultPackageManager: class {
		async resolve() {
			return {};
		}
	},
	SettingsManager: {
		create: () => ({}),
	},
	getAgentDir: () => mockAgentDir,
	getMarkdownTheme: () => ({ markdown: true }),
	parseFrontmatter,
	withFileMutationQueue: async (_filePath, operation) => await operation(),
}));

mock.module("@mariozechner/pi-ai", () => ({
	StringEnum: (_values, options = {}) => options,
}));

mock.module("@sinclair/typebox", () => ({
	Type: {
		Object: (value) => value,
		String: (value = {}) => value,
		Optional: (value) => value,
		Array: (value, options = {}) => ({ value, ...options }),
		Boolean: (value = {}) => value,
	},
}));

mock.module("@mariozechner/pi-tui", () => ({
	Container: MockContainer,
	Key: {
		home: "home",
		end: "end",
		up: "up",
		down: "down",
		ctrl: (key) => `ctrl-${key}`,
	},
	Markdown: MockMarkdown,
	Spacer: MockSpacer,
	Text: MockText,
	matchesKey: () => false,
	parseKey: () => null,
	truncateToWidth: (text) => text,
	visibleWidth: (text) => text.length,
	wrapTextWithAnsi: (text) => [text],
}));

const { default: registerPiGremlins } = await import("./index.ts");
const {
	bumpResultDerivedRevision,
	bumpResultVisibleRevision,
	cloneSingleResultForSnapshot,
	getDerivedRenderData,
	initializeResultRevisions,
} = await import("./execution-shared.ts");

function createRegisteredTool() {
	let registeredTool;
	registerPiGremlins({
		on: () => {},
		registerCommand: () => {},
		registerTool: (tool) => {
			registeredTool = tool;
		},
	});
	return registeredTool;
}

function createExecutionContext(cwd) {
	return {
		cwd,
		hasUI: false,
		ui: {
			confirm: async () => true,
			notify: () => {},
			custom: async () => {},
		},
	};
}

function createUsage(overrides = {}) {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
		...overrides,
	};
}

function createSingleResult(overrides = {}) {
	return {
		agent: "tars",
		agentSource: "user",
		task: "Inspect task",
		exitCode: 0,
		messages: [],
		viewerEntries: [],
		stderr: "",
		usage: createUsage(),
		...overrides,
	};
}

function createDetails(mode, results) {
	return {
		mode,
		agentScope: "user",
		projectAgentsDir: null,
		results,
	};
}

function renderToText(tool, result, options = {}, context = {}) {
	return flattenRenderedNode(
		tool.renderResult(result, { expanded: false, ...options }, createTheme(), {
			toolCallId: "render-call",
			...context,
		}),
	);
}

async function seedViewerSnapshot(
	tool,
	workspace,
	toolCallId = "render-seeded",
) {
	writeAgentFile(workspace.userAgentsDir, "tars.md", "tars");
	spawnPlans.push(() =>
		createMockProcess({
			stdoutChunks: [
				jsonLine({
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "seeded output" }],
						usage: {
							input: 1,
							output: 1,
							cacheRead: 0,
							cacheWrite: 0,
							cost: { total: 0.001 },
							totalTokens: 2,
						},
					},
				}),
			],
			closeCode: 0,
		}),
	);
	await tool.execute(
		toolCallId,
		{ agent: "tars", task: "seed invocation" },
		undefined,
		undefined,
		createExecutionContext(workspace.repoRoot),
	);
	return toolCallId;
}

let workspaceRoot = null;

beforeEach(() => {
	spawnPlans = [];
});

afterEach(() => {
	if (workspaceRoot) {
		fs.rmSync(workspaceRoot, { recursive: true, force: true });
		workspaceRoot = null;
	}
});

describe("pi-gremlins renderResult characterization", () => {
	test("falls back to tool text when details are missing", () => {
		const tool = createRegisteredTool();
		expect(
			renderToText(tool, {
				content: [{ type: "text", text: "plain fallback" }],
			}),
		).toBe("plain fallback");
	});

	test("renders single collapsed overflow with expand hint and without viewer hint when no snapshot exists", () => {
		const tool = createRegisteredTool();
		const overflowMessage = {
			role: "assistant",
			content: Array.from({ length: 11 }, (_value, index) => ({
				type: "text",
				text: `line ${index + 1}`,
			})),
		};
		const text = renderToText(tool, {
			content: [{ type: "text", text: "unused" }],
			details: createDetails("single", [
				createSingleResult({
					messages: [overflowMessage],
					usage: createUsage({ turns: 2, input: 10, output: 20 }),
				}),
			]),
		});

		expect(text).toContain("tars (user)");
		expect(text).toContain("... 1 earlier items");
		expect(text).toContain("line 11");
		expect(text).toContain("(Ctrl+O to expand)");
		expect(text).toContain("2 turns ↑10 ↓20");
		expect(text).not.toContain(
			"Hint: /pi-gremlins:view opens latest gremlin lair.",
		);
	});

	test("renders single expanded output, tool calls, usage, error markers, and viewer hint when snapshot exists", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		const tool = createRegisteredTool();
		const toolCallId = await seedViewerSnapshot(tool, workspace);
		const text = renderToText(
			tool,
			{
				content: [{ type: "text", text: "unused" }],
				details: createDetails("single", [
					createSingleResult({
						exitCode: 1,
						stopReason: "error",
						errorMessage: "boom",
						messages: [
							{
								role: "assistant",
								content: [
									{
										type: "toolCall",
										id: "read-1",
										name: "read",
										arguments: { path: "/tmp/report.md" },
									},
									{ type: "text", text: "Summarized result" },
								],
							},
						],
						usage: createUsage({
							turns: 3,
							input: 1500,
							output: 40,
							cacheRead: 10,
							cacheWrite: 5,
							cost: 1.2345,
							contextTokens: 2200,
						}),
						model: "gpt-5",
					}),
				]),
			},
			{ expanded: true },
			{ toolCallId },
		);

		expect(text).toContain("tars (user) [error]");
		expect(text).toContain("Error: boom");
		expect(text).toContain("─── Task ───");
		expect(text).toContain("Inspect task");
		expect(text).toContain("─── Output ───");
		expect(text).toContain("read /tmp/report.md");
		expect(text).toContain("Summarized result");
		expect(text).toContain("3 turns ↑1.5k ↓40 R10 W5 $1.2345 ctx:2.2k gpt-5");
		expect(text).toContain(
			"Hint: /pi-gremlins:view opens latest gremlin lair.",
		);
	});

	test("renders single no-output branch", () => {
		const tool = createRegisteredTool();
		const text = renderToText(tool, {
			content: [{ type: "text", text: "unused" }],
			details: createDetails("single", [createSingleResult()]),
		});

		expect(text).toContain("(no output)");
	});

	test("renders chain collapsed with per-step summaries, no-output markers, total usage, and expand hint", () => {
		const tool = createRegisteredTool();
		const text = renderToText(tool, {
			content: [{ type: "text", text: "unused" }],
			details: createDetails("chain", [
				createSingleResult({
					agent: "writer",
					step: 1,
					messages: [
						{
							role: "assistant",
							content: [{ type: "text", text: "draft ready" }],
						},
					],
					usage: createUsage({ turns: 1, input: 10, output: 8 }),
				}),
				createSingleResult({
					agent: "reviewer",
					step: 2,
					exitCode: 1,
					usage: createUsage({ turns: 2, input: 5, output: 4 }),
				}),
			]),
		});

		expect(text).toContain("chain 1/2 steps");
		expect(text).toContain("─── Step 1: writer");
		expect(text).toContain("draft ready");
		expect(text).toContain("─── Step 2: reviewer");
		expect(text).toContain("(no output)");
		expect(text).toContain("Total: 3 turns ↑15 ↓12");
		expect(text).toContain("(Ctrl+O to expand)");
	});

	test("renders chain expanded with task labels and total usage", () => {
		const tool = createRegisteredTool();
		const text = renderToText(
			tool,
			{
				content: [{ type: "text", text: "unused" }],
				details: createDetails("chain", [
					createSingleResult({
						agent: "writer",
						step: 1,
						task: "Write plan",
						messages: [
							{
								role: "assistant",
								content: [{ type: "text", text: "plan done" }],
							},
						],
						usage: createUsage({ turns: 1, input: 12, output: 7 }),
					}),
					createSingleResult({
						agent: "reviewer",
						step: 2,
						task: "Review plan",
						messages: [
							{
								role: "assistant",
								content: [{ type: "text", text: "review done" }],
							},
						],
						usage: createUsage({ turns: 1, input: 8, output: 3 }),
					}),
				]),
			},
			{ expanded: true },
		);

		expect(text).toContain("chain 2/2 steps");
		expect(text).toContain("Task: Write plan");
		expect(text).toContain("Task: Review plan");
		expect(text).toContain("plan done");
		expect(text).toContain("review done");
		expect(text).toContain("Total: 2 turns ↑20 ↓10");
	});

	test("renders parallel running state with running marker and no total usage", () => {
		const tool = createRegisteredTool();
		const text = renderToText(tool, {
			content: [{ type: "text", text: "unused" }],
			details: createDetails("parallel", [
				createSingleResult({
					agent: "alpha",
					exitCode: -1,
				}),
				createSingleResult({
					agent: "beta",
					messages: [
						{
							role: "assistant",
							content: [{ type: "text", text: "beta complete" }],
						},
					],
					usage: createUsage({ turns: 1, input: 9, output: 3 }),
				}),
			]),
		});

		expect(text).toContain("parallel 1/2 done, 1 running");
		expect(text).toContain("─── alpha ⏳");
		expect(text).toContain("(running...)");
		expect(text).toContain("─── beta ✓");
		expect(text).toContain("beta complete");
		expect(text).not.toContain("Total:");
		expect(text).toContain("(Ctrl+O to expand)");
	});

	test("renders parallel completed collapsed state with totals and expand hint", () => {
		const tool = createRegisteredTool();
		const text = renderToText(tool, {
			content: [{ type: "text", text: "unused" }],
			details: createDetails("parallel", [
				createSingleResult({
					agent: "alpha",
					messages: [
						{
							role: "assistant",
							content: [{ type: "text", text: "alpha collapsed" }],
						},
					],
					usage: createUsage({ turns: 1, input: 7, output: 4 }),
				}),
				createSingleResult({
					agent: "beta",
					exitCode: 1,
					messages: [
						{
							role: "assistant",
							content: [{ type: "text", text: "beta collapsed" }],
						},
					],
					usage: createUsage({ turns: 2, input: 3, output: 2 }),
				}),
			]),
		});

		expect(text).toContain("parallel 1/2 tasks");
		expect(text).toContain("─── alpha ✓");
		expect(text).toContain("─── beta ✗");
		expect(text).toContain("Total: 3 turns ↑10 ↓6");
		expect(text).toContain("(Ctrl+O to expand)");
	});

	test("reuses derived render cache for same revision and invalidates when messages append", () => {
		const result = initializeResultRevisions(
			createSingleResult({
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "first output" }],
					},
				],
			}),
		);

		const firstPass = getDerivedRenderData(result);
		const secondPass = getDerivedRenderData(result);
		expect(secondPass).toBe(firstPass);

		result.messages.push({
			role: "assistant",
			content: [{ type: "text", text: "second output" }],
		});
		bumpResultDerivedRevision(result);

		const thirdPass = getDerivedRenderData(result);
		expect(thirdPass).not.toBe(firstPass);
		expect(thirdPass.finalOutput).toBe("second output");
		expect(thirdPass.displayItems.at(-1)).toEqual({
			type: "text",
			text: "second output",
		});
	});

	test("retains derived cache across snapshot clones when only visible metadata changes", () => {
		const result = initializeResultRevisions(
			createSingleResult({
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "stable output" }],
					},
				],
			}),
		);
		const cached = getDerivedRenderData(result);
		const cloned = cloneSingleResultForSnapshot(result, result);
		bumpResultVisibleRevision(cloned);

		expect(getDerivedRenderData(cloned)).toBe(cached);
		expect(getDerivedRenderData(cloned).finalOutput).toBe("stable output");
	});

	test("renders parallel completed expanded state with totals and no-output branch", () => {
		const tool = createRegisteredTool();
		const text = renderToText(
			tool,
			{
				content: [{ type: "text", text: "unused" }],
				details: createDetails("parallel", [
					createSingleResult({
						agent: "alpha",
						task: "Run alpha",
						messages: [
							{
								role: "assistant",
								content: [{ type: "text", text: "alpha result" }],
							},
						],
						usage: createUsage({ turns: 1, input: 6, output: 5 }),
					}),
					createSingleResult({
						agent: "beta",
						task: "Run beta",
						exitCode: 1,
						usage: createUsage({ turns: 2, input: 4, output: 1 }),
					}),
				]),
			},
			{ expanded: true },
		);

		expect(text).toContain("parallel 1/2 tasks");
		expect(text).toContain("Task: Run alpha");
		expect(text).toContain("Task: Run beta");
		expect(text).toContain("alpha result");
		expect(text).toContain("Total: 3 turns ↑10 ↓6");
	});
});
