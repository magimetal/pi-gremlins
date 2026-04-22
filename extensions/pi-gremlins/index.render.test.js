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
		alt: (key) => `alt-${key}`,
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
	getAgentSourceSemantics,
	getDerivedRenderData,
	getResultFinalOutput,
	getSingleResultSemantics,
	getUsageTelemetrySemantics,
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
		gremlinId: "g1",
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
	test("exposes shared semantic helper vocabulary for status source trust and usage", () => {
		expect(
			getSingleResultSemantics(createSingleResult({ exitCode: -1 })),
		).toMatchObject({
			lifecycle: "pending",
			label: "Running",
			badgeText: "Running",
		});
		expect(
			getSingleResultSemantics(createSingleResult({ exitCode: 0 })),
		).toMatchObject({
			lifecycle: "completed",
			label: "Completed",
			badgeText: "Completed",
		});
		expect(getAgentSourceSemantics("project")).toMatchObject({
			badgeText: "project",
			trustLabel: "Project agent",
		});
		expect(getUsageTelemetrySemantics()).toMatchObject({
			turns: "turns",
			input: "input",
			output: "output",
			cost: "cost",
			model: "model",
		});
	});

	test("registers Gremlins🧌 branding for user-facing tool label and call chrome", () => {
		const tool = createRegisteredTool();
		const call = flattenRenderedNode(
			tool.renderCall(
				{ agent: "tars", task: "Inspect task" },
				createTheme(),
				{},
				undefined,
			),
		);

		expect(tool.name).toBe("pi-gremlins");
		expect(tool.label).toBe("Gremlins🧌");
		expect(call).toContain("Gremlins🧌 tars [user]");
		expect(call).not.toContain("pi-gremlins ");
	});

	test("falls back to tool text when details are missing", () => {
		const tool = createRegisteredTool();
		expect(
			renderToText(tool, {
				content: [{ type: "text", text: "plain fallback" }],
			}),
		).toBe("plain fallback");
	});

	test("renders single collapsed summary as status-first digest with readable usage and local expand hint", () => {
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

		expect(text).toContain("[Completed] tars · single · [user]");
		expect(text).toContain("digest · line 11");
		expect(text).toContain("… 8 earlier events");
		expect(text).toContain("Ctrl+O expands embedded view.");
		expect(text).toContain("usage · turns:2 · input:10 · output:20");
		expect(text).not.toContain(
			"viewer · /gremlins:view opens mission control.",
		);
	});

	test("renders single expanded output as task-first digest with inline tool summary and viewer hint", async () => {
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

		expect(text).toContain("[Failed] tars · single · [user]");
		expect(text).toContain("task · Inspect task");
		expect(text).toContain("error · boom");
		expect(text).toContain("tool call · read /tmp/report.md");
		expect(text).not.toContain("active tool · read /tmp/report.md → waiting");
		expect(text).toContain("digest · Summarized result");
		expect(text).toContain(
			"usage · turns:3 · input:1.5k · output:40 · cacheRead:10 · cacheWrite:5 · cost:$1.2345 · context:2.2k · model:gpt-5",
		);
		expect(text).toContain("viewer · /gremlins:view opens mission control.");
	});

	test("reuses inline result component when expanding so viewport anchoring can stay stable", () => {
		const tool = createRegisteredTool();
		const result = {
			content: [{ type: "text", text: "unused" }],
			details: createDetails("single", [
				createSingleResult({
					messages: [
						{
							role: "assistant",
							content: Array.from({ length: 6 }, (_value, index) => ({
								type: "text",
								text: `line ${index + 1}`,
							})),
						},
					],
				}),
			]),
		};
		const collapsed = tool.renderResult(
			result,
			{ expanded: false },
			createTheme(),
			{ toolCallId: "render-stability" },
		);
		const expanded = tool.renderResult(
			result,
			{ expanded: true },
			createTheme(),
			{ toolCallId: "render-stability", lastComponent: collapsed },
		);

		expect(expanded).toBe(collapsed);
		expect(expanded.text).toContain("digest · line 6");
		expect(expanded.text).not.toContain("Ctrl+O expands embedded view.");
		const lineCount = expanded.text.split("\n").length;
		expect(lineCount).toBeGreaterThan(6);
	});

	test("renders themed single quiet state when no output captured", () => {
		const tool = createRegisteredTool();
		const text = renderToText(tool, {
			content: [{ type: "text", text: "unused" }],
			details: createDetails("single", [createSingleResult()]),
		});

		expect(text).toContain("quiet · No output captured.");
	});

	test("treats viewerEntries as canonical embedded feed when present and does not render running as failure", () => {
		const tool = createRegisteredTool();
		const text = renderToText(tool, {
			content: [{ type: "text", text: "unused" }],
			details: createDetails("single", [
				createSingleResult({
					exitCode: -1,
					messages: [
						{
							role: "assistant",
							content: [{ type: "text", text: "message fallback only" }],
						},
					],
					viewerEntries: [
						{
							type: "tool-call",
							toolCallId: "read-1",
							toolName: "read",
							args: { path: "/tmp/report.md" },
						},
						{
							type: "tool-result",
							toolCallId: "read-1",
							toolName: "read",
							content: "viewer entry output",
							streaming: true,
							truncated: false,
							isError: false,
						},
					],
				}),
			]),
		});

		expect(text).toContain("[Running]");
		expect(text).toContain("read /tmp/report.md");
		expect(text).toContain("viewer entry output");
		expect(text).not.toContain("message fallback only");
		expect(text).not.toContain("✗ tars");
	});

	test("renders steering events in embedded summaries for auditability", () => {
		const tool = createRegisteredTool();
		const text = renderToText(
			tool,
			{
				content: [{ type: "text", text: "unused" }],
				details: createDetails("single", [
					createSingleResult({
						exitCode: -1,
						viewerEntries: [
							{
								type: "assistant-text",
								text: "drafting answer",
								streaming: true,
							},
							{
								type: "steer",
								text: "update README too",
								streaming: false,
								isError: false,
							},
						],
					}),
				]),
			},
			{ expanded: true },
		);

		expect(text).toContain("steer · update README too");
		expect(text).toContain("live · drafting answer");
	});

	test("keeps no-entry tool-call-only single summaries terminal-safe and running-live", () => {
		const tool = createRegisteredTool();
		const completed = renderToText(tool, {
			content: [{ type: "text", text: "unused" }],
			details: createDetails("single", [
				createSingleResult({
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
							],
						},
					],
				}),
			]),
		});
		const running = renderToText(tool, {
			content: [{ type: "text", text: "unused" }],
			details: createDetails("single", [
				createSingleResult({
					exitCode: -1,
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
							],
						},
					],
				}),
			]),
		});

		expect(completed).toContain("[Completed] tars · single · [user]");
		expect(completed).toContain("tool call · read /tmp/report.md");
		expect(completed).not.toContain(
			"active tool · read /tmp/report.md → waiting",
		);
		expect(running).toContain("[Running] tars · single · [user]");
		expect(running).toContain("active tool · read /tmp/report.md → waiting");
	});

	test("pairs repeated same-name tool calls by toolCallId and preserves derived ids", () => {
		const tool = createRegisteredTool();
		const result = createSingleResult({
			viewerEntries: [
				{
					type: "tool-call",
					toolCallId: "read-1",
					toolName: "read",
					args: { path: "/tmp/alpha.md" },
				},
				{
					type: "tool-call",
					toolCallId: "read-2",
					toolName: "read",
					args: { path: "/tmp/beta.md" },
				},
				{
					type: "tool-result",
					toolCallId: "read-1",
					toolName: "read",
					content: "alpha summary",
					streaming: false,
					truncated: false,
					isError: false,
				},
				{
					type: "tool-result",
					toolCallId: "read-2",
					toolName: "read",
					content: "beta summary",
					streaming: false,
					truncated: false,
					isError: false,
				},
			],
		});

		const derived = getDerivedRenderData(result);
		expect(derived.displayItems).toEqual([
			expect.objectContaining({
				type: "toolCall",
				name: "read",
				toolCallId: "read-1",
			}),
			expect.objectContaining({
				type: "toolCall",
				name: "read",
				toolCallId: "read-2",
			}),
			expect.objectContaining({
				type: "toolResult",
				toolName: "read",
				toolCallId: "read-1",
			}),
			expect.objectContaining({
				type: "toolResult",
				toolName: "read",
				toolCallId: "read-2",
			}),
		]);

		const text = renderToText(
			tool,
			{
				content: [{ type: "text", text: "unused" }],
				details: createDetails("single", [result]),
			},
			{ expanded: true },
		);

		expect(text).toContain("tool · read /tmp/alpha.md → alpha summary");
		expect(text).toContain("tool · read /tmp/beta.md → beta summary");
		expect(text).not.toContain("read /tmp/beta.md → alpha summary");
		expect(text).not.toContain("active tool · read /tmp/alpha.md → waiting");
	});

	test("compresses single embedded summary deterministically at narrow width", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		const tool = createRegisteredTool();
		const toolCallId = await seedViewerSnapshot(
			tool,
			workspace,
			"single-narrow",
		);
		const width = 44;
		const text = renderToText(
			tool,
			{
				content: [{ type: "text", text: "unused" }],
				details: createDetails("single", [
					createSingleResult({
						agent: "architect-of-very-long-project-agent-name",
						agentSource: "project",
						exitCode: -1,
						task: "Review embedded summary width pressure for project trust context and long labels",
						viewerEntries: [
							{
								type: "assistant-text",
								text: "live project review output still streaming through narrow panel",
								streaming: true,
							},
						],
						usage: createUsage({
							turns: 3,
							input: 1200,
							output: 80,
							cacheRead: 10,
							contextTokens: 2100,
						}),
					}),
				]),
			},
			{ expanded: true },
			{ toolCallId, width },
		);

		for (const line of text.split("\n")) {
			expect(line.length).toBeLessThanOrEqual(width);
		}
		expect(text).toContain("[Running]");
		expect(text).toContain("[project]");
		expect(text).toContain("trust · Project agent");
		expect(text).toContain("viewer · /gremlins:view");
	});

	test("compresses chain embedded summary deterministically at narrow width", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		const tool = createRegisteredTool();
		const toolCallId = await seedViewerSnapshot(
			tool,
			workspace,
			"chain-narrow",
		);
		const width = 46;
		const text = renderToText(
			tool,
			{
				content: [{ type: "text", text: "unused" }],
				details: createDetails("chain", [
					createSingleResult({
						agent: "writer-with-very-long-name",
						agentSource: "project",
						step: 1,
						exitCode: -1,
						task: "Draft long plan status for narrow chain summary",
						viewerEntries: [
							{
								type: "assistant-text",
								text: "drafting first chain step now",
								streaming: true,
							},
						],
					}),
					createSingleResult({
						agent: "reviewer-with-very-long-name",
						agentSource: "package",
						step: 2,
						task: "Review long plan follow-up",
					}),
				]),
			},
			{ expanded: false },
			{ toolCallId, width },
		);

		for (const line of text.split("\n")) {
			expect(line.length).toBeLessThanOrEqual(width);
		}
		expect(text).toContain("[Running] chain");
		expect(text).toContain("active ·");
		expect(text).toContain("[project]");
		expect(text).toContain("viewer · /gremlins:view");
	});

	test("compresses parallel embedded summary deterministically at narrow width", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		const tool = createRegisteredTool();
		const toolCallId = await seedViewerSnapshot(
			tool,
			workspace,
			"parallel-narrow",
		);
		const width = 46;
		const text = renderToText(
			tool,
			{
				content: [{ type: "text", text: "unused" }],
				details: createDetails("parallel", [
					createSingleResult({
						agent: "alpha-with-very-long-name",
						agentSource: "project",
						exitCode: -1,
						task: "Run long alpha narrow summary",
						viewerEntries: [
							{
								type: "tool-call",
								toolCallId: "bash-1",
								toolName: "bash",
								args: {
									command: "echo alpha narrow summary output still running",
								},
							},
						],
					}),
					createSingleResult({
						agent: "beta-with-very-long-name",
						agentSource: "package",
						exitCode: 0,
						messages: [
							{
								role: "assistant",
								content: [{ type: "text", text: "beta complete" }],
							},
						],
					}),
				]),
			},
			{ expanded: false },
			{ toolCallId, width },
		);

		for (const line of text.split("\n")) {
			expect(line.length).toBeLessThanOrEqual(width);
		}
		expect(text).toContain("[Running] parallel");
		expect(text).toContain("active ·");
		expect(text).toContain("[project]");
		expect(text).toContain("viewer · /gremlins:view");
	});

	test("renders gremlin ids in embedded parallel summaries for repeated agent names", () => {
		const tool = createRegisteredTool();
		const text = renderToText(tool, {
			content: [{ type: "text", text: "unused" }],
			details: createDetails("parallel", [
				createSingleResult({
					gremlinId: "g1",
					agent: "alpha",
					exitCode: -1,
					task: "Do first alpha task",
					viewerEntries: [
						{
							type: "assistant-text",
							text: "first alpha still running",
							streaming: true,
						},
					],
				}),
				createSingleResult({
					gremlinId: "g2",
					agent: "alpha",
					exitCode: 0,
					task: "Do second alpha task",
					messages: [
						{
							role: "assistant",
							content: [{ type: "text", text: "second alpha done" }],
						},
					],
				}),
			]),
		});

		expect(text).toContain("active · alpha · first alpha still running · g1");
		expect(text).toContain("[Running] alpha [user] · g1");
		expect(text).toContain("[Completed] alpha [user] · g2");
	});

	test("renders chain collapsed with status-first rows, active-free summary, and readable totals", () => {
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

		expect(text).toContain("[Failed] chain 1 done · 1 failed");
		expect(text).toContain("[Completed] step 1 · writer [user]");
		expect(text).toContain("digest · draft ready");
		expect(text).toContain("[Failed] step 2 · reviewer [user]");
		expect(text).toContain("quiet · No output captured.");
		expect(text).toContain("usage total · turns:3 · input:15 · output:12");
		expect(text).toContain("Ctrl+O expands embedded view.");
	});

	test("renders chain running and canceled states with semantic badges instead of failure markers", () => {
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
				}),
				createSingleResult({
					agent: "reviewer",
					step: 2,
					exitCode: -1,
					viewerEntries: [
						{
							type: "assistant-text",
							text: "review in progress",
							streaming: true,
						},
					],
				}),
				createSingleResult({
					agent: "closer",
					step: 3,
					exitCode: 130,
					stopReason: "aborted",
					errorMessage: "Gremlins🧌 run was aborted",
				}),
			]),
		});

		expect(text).toContain("review in progress");
		expect(text).toContain("[Running]");
		expect(text).toContain("[Canceled]");
		expect(text).not.toContain("reviewer ✗");
		expect(text).not.toContain("closer ✗");
	});

	test("renders chain expanded with task labels, readable totals, and compact trace rows", () => {
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

		expect(text).toContain("[Completed] chain 2 done");
		expect(text).toContain("[Completed] step 1 · writer [user]");
		expect(text).toContain("task · Write plan");
		expect(text).toContain("digest · plan done");
		expect(text).toContain("task · Review plan");
		expect(text).toContain("digest · review done");
		expect(text).toContain("usage total · turns:2 · input:20 · output:10");
	});

	test("renders parallel running state with active row and readable aggregate usage", () => {
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

		expect(text).toContain("[Running] parallel 1 done · 1 pending");
		expect(text).toContain("active · alpha · Inspect task");
		expect(text).toContain("[Running] alpha [user]");
		expect(text).toContain("pending · Inspect task");
		expect(text).toContain("[Completed] beta [user]");
		expect(text).toContain("digest · beta complete");
		expect(text).toContain("usage total · turns:1 · input:9 · output:3");
		expect(text).toContain("Ctrl+O expands embedded view.");
	});

	test("renders parallel completed collapsed state with explicit failure count and totals", () => {
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

		expect(text).toContain("[Failed] parallel 1 done · 1 failed");
		expect(text).toContain("[Completed] alpha [user]");
		expect(text).toContain("[Failed] beta [user]");
		expect(text).toContain("digest · alpha collapsed");
		expect(text).toContain("digest · beta collapsed");
		expect(text).toContain("usage total · turns:3 · input:10 · output:6");
		expect(text).toContain("Ctrl+O expands embedded view.");
	});

	test("renders collapsed overflow hint with Ctrl+O under narrow width pressure", () => {
		const tool = createRegisteredTool();
		const text = renderToText(
			tool,
			{
				content: [{ type: "text", text: "unused" }],
				details: createDetails(
					"parallel",
					Array.from({ length: 5 }, (_value, index) =>
						createSingleResult({
							agent: `agent-${index + 1}`,
							messages: [
								{
									role: "assistant",
									content: [{ type: "text", text: `result ${index + 1}` }],
								},
							],
						}),
					),
				),
			},
			{},
			{ width: 14 },
		);

		expect(text).toContain("… +1 · Ctrl+O");
	});

	test("reuses derived render cache and final-output accessor for same revision and invalidates when messages append", () => {
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
		expect(getResultFinalOutput(result)).toBe("first output");
		expect(getResultFinalOutput(result)).toBe(firstPass.finalOutput);

		result.messages.push({
			role: "assistant",
			content: [{ type: "text", text: "second output" }],
		});
		bumpResultDerivedRevision(result);

		const thirdPass = getDerivedRenderData(result);
		expect(thirdPass).not.toBe(firstPass);
		expect(getResultFinalOutput(result)).toBe("second output");
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

	test("renders parallel completed expanded state with explicit failure count and compact quiet branch", () => {
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

		expect(text).toContain("[Failed] parallel 1 done · 1 failed");
		expect(text).toContain("[Completed] alpha [user]");
		expect(text).toContain("task · Run alpha");
		expect(text).toContain("digest · alpha result");
		expect(text).toContain("[Failed] beta [user]");
		expect(text).toContain("task · Run beta");
		expect(text).toContain("quiet · No output captured.");
		expect(text).toContain("usage total · turns:3 · input:10 · output:6");
	});
});
