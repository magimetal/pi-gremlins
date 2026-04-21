import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { execSync } from "node:child_process";
import * as fs from "node:fs";

import {
	createMockProcess,
	createWorkspace,
	flattenRenderedNode,
	jsonLine,
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
	getMarkdownTheme: () => ({}),
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
	Container: class {
		constructor() {
			this.children = [];
		}
		addChild(child) {
			this.children.push(child);
		}
	},
	Key: {
		home: "home",
		end: "end",
		up: "up",
		down: "down",
		ctrl: (key) => `ctrl-${key}`,
		alt: (key) => `alt-${key}`,
	},
	Markdown: class {
		constructor(text) {
			this.text = text;
		}
	},
	Spacer: class {
		constructor(lines = 1) {
			this.lines = lines;
		}
	},
	Text: class {
		constructor(text) {
			this.text = text;
		}
	},
	matchesKey: () => false,
	parseKey: () => null,
	truncateToWidth: (text) => text,
	visibleWidth: (text) => text.length,
	wrapTextWithAnsi: (text) => [text],
}));

const {
	createInvocationSnapshot,
	default: registerPiGremlins,
	getCachedInvocationBodyLines,
	getCachedWrappedBodyLines,
	PiGremlinsViewerOverlay,
} = await import("./index.ts");
const {
	bumpResultDerivedRevision,
	bumpResultVisibleRevision,
	createPendingResult,
	getInvocationSnapshotRevision,
} = await import("./execution-shared.ts");

function createExtensionHarness() {
	let registeredTool;
	const commands = new Map();
	const events = new Map();
	registerPiGremlins({
		on: (name, handler) => {
			events.set(name, handler);
		},
		registerTool: (tool) => {
			registeredTool = tool;
		},
		registerCommand: (name, command) => {
			commands.set(name, command);
		},
	});
	return { tool: registeredTool, commands, events };
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

function createDetails(mode, results) {
	return {
		mode,
		agentScope: "user",
		projectAgentsDir: null,
		results,
	};
}

function createTheme() {
	return {
		fg: (_color, text) => text,
		bold: (text) => text,
	};
}

function renderEmbeddedText(tool, result, options = {}, context = {}) {
	return flattenRenderedNode(
		tool.renderResult(result, { expanded: false, ...options }, createTheme(), {
			toolCallId: "viewer-parity",
			...context,
		}),
	);
}

async function seedInvocation(tool, workspace, toolCallId = "viewer-seeded") {
	writeAgentFile(workspace.userAgentsDir, "tars.md", "tars");
	spawnPlans.push(() =>
		createMockProcess({
			stdoutChunks: [
				jsonLine({
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "seeded viewer output" }],
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
		{ agent: "tars", task: "seed viewer" },
		undefined,
		undefined,
		createExecutionContext(workspace.repoRoot),
	);
}

function renderOverlayText(
	snapshot,
	{ width = 72, rows = 24, selectedResultIndex = 0 } = {},
) {
	const originalRows = process.stdout.rows;
	Object.defineProperty(process.stdout, "rows", {
		value: rows,
		configurable: true,
	});
	try {
		const overlay = new PiGremlinsViewerOverlay(
			{ requestRender: () => {} },
			createTheme(),
			{ matches: () => false },
			() => snapshot,
			() => {},
		);
		overlay.selectedResultIndex = selectedResultIndex;
		overlay.refresh();
		return overlay.render(width).join("\n");
	} finally {
		Object.defineProperty(process.stdout, "rows", {
			value: originalRows,
			configurable: true,
		});
	}
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

describe("pi-gremlins viewer command", () => {
	test("notifies when no invocation is available", async () => {
		const { commands, events } = createExtensionHarness();
		const notifications = [];

		await commands.get("pi-gremlins:view").handler([], {
			hasUI: true,
			ui: {
				notify: (message, level) => {
					notifications.push({ message, level });
				},
				custom: async () => {},
			},
		});

		expect(notifications).toEqual([
			{
				message: "No pi-gremlins run available in this session.",
				level: "warning",
			},
		]);
		events.get("session_shutdown")?.();
	});

	test("opens new viewer overlay for latest invocation", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		const { tool, commands, events } = createExtensionHarness();
		await seedInvocation(tool, workspace);

		const customCalls = [];
		const handle = {
			focusCalls: 0,
			focus() {
				this.focusCalls += 1;
			},
			setHidden() {},
			isFocused: () => true,
			hide() {},
		};

		await commands.get("pi-gremlins:view").handler([], {
			hasUI: true,
			ui: {
				notify: () => {},
				custom: async (render, options) => {
					customCalls.push(options);
					await render(
						{ requestRender: () => {} },
						{ fg: (_color, text) => text, bold: (text) => text },
						{ matches: () => false },
						() => {},
					);
					options.onHandle(handle);
				},
			},
		});

		expect(customCalls).toHaveLength(1);
		expect(customCalls[0]).toMatchObject({
			overlay: true,
			overlayOptions: { width: "78%" },
		});
		expect(handle.focusCalls).toBe(1);
		events.get("session_shutdown")?.();
	});

	test("reuses and invalidates viewer body and wrap caches deterministically", () => {
		const theme = createTheme();
		const alpha = createPendingResult("alpha", "Do alpha", undefined, "user");
		const beta = createPendingResult("beta", "Do beta", undefined, "user");
		alpha.viewerEntries.push({
			type: "assistant-text",
			text: "alpha body line",
			streaming: false,
		});
		beta.viewerEntries.push({
			type: "assistant-text",
			text: "beta body line",
			streaming: false,
		});
		bumpResultDerivedRevision(alpha);
		bumpResultDerivedRevision(beta);

		const firstSnapshot = createInvocationSnapshot(
			"viewer-cache",
			createDetails("parallel", [alpha, beta]),
			"Running",
		);
		const firstBody = getCachedInvocationBodyLines(
			null,
			firstSnapshot,
			0,
			theme,
		);
		const secondBody = getCachedInvocationBodyLines(
			firstBody.cache,
			firstSnapshot,
			0,
			theme,
		);
		const switchedBody = getCachedInvocationBodyLines(
			secondBody.cache,
			firstSnapshot,
			1,
			theme,
		);

		expect(firstBody.cacheHit).toBe(false);
		expect(secondBody.cacheHit).toBe(true);
		expect(switchedBody.cacheHit).toBe(false);
		expect(switchedBody.lines.join("\n")).toContain("beta body line");

		const revision = getInvocationSnapshotRevision(firstSnapshot);
		const firstWrap = getCachedWrappedBodyLines(
			null,
			firstBody.lines,
			revision,
			0,
			40,
		);
		const secondWrap = getCachedWrappedBodyLines(
			firstWrap.cache,
			firstBody.lines,
			revision,
			0,
			40,
		);
		const resizedWrap = getCachedWrappedBodyLines(
			secondWrap.cache,
			firstBody.lines,
			revision,
			0,
			20,
		);

		expect(firstWrap.cacheHit).toBe(false);
		expect(secondWrap.cacheHit).toBe(true);
		expect(resizedWrap.cacheHit).toBe(false);

		alpha.viewerEntries.push({
			type: "assistant-text",
			text: "alpha new line",
			streaming: false,
		});
		bumpResultDerivedRevision(alpha);
		const secondSnapshot = createInvocationSnapshot(
			"viewer-cache",
			createDetails("parallel", [alpha, beta]),
			"Running",
			firstSnapshot,
		);
		const invalidatedBody = getCachedInvocationBodyLines(
			secondBody.cache,
			secondSnapshot,
			0,
			theme,
		);
		const invalidatedWrap = getCachedWrappedBodyLines(
			secondWrap.cache,
			invalidatedBody.lines,
			getInvocationSnapshotRevision(secondSnapshot),
			0,
			40,
		);

		expect(invalidatedBody.cacheHit).toBe(false);
		expect(invalidatedWrap.cacheHit).toBe(false);
		expect(invalidatedBody.lines.join("\n")).toContain("alpha new line");
	});

	test("retains popup fallback body lines when viewer entries are absent", () => {
		const result = createPendingResult(
			"tars",
			"Fallback task",
			undefined,
			"user",
		);
		result.exitCode = 0;
		result.messages.push({
			role: "assistant",
			content: [{ type: "text", text: "message fallback retained" }],
		});
		bumpResultVisibleRevision(result);
		bumpResultDerivedRevision(result);

		const snapshot = createInvocationSnapshot(
			"viewer-fallback-retained",
			createDetails("single", [result]),
			"Completed",
		);
		const body = getCachedInvocationBodyLines(null, snapshot, 0, createTheme());

		expect(body.cacheHit).toBe(false);
		expect(body.lines.join("\n")).toContain("message fallback retained");
	});

	test("aligns completed no-entry tool-call-only fallback semantics across embedded and popup", () => {
		const { tool } = createExtensionHarness();
		const result = createPendingResult(
			"tars",
			"Inspect tool-call-only fallback",
			undefined,
			"user",
		);
		result.exitCode = 0;
		result.messages.push({
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "read-1",
					name: "read",
					arguments: { path: "/tmp/report.md" },
				},
			],
		});
		bumpResultVisibleRevision(result);
		bumpResultDerivedRevision(result);
		const details = createDetails("single", [result]);
		const snapshot = createInvocationSnapshot(
			"viewer-tool-call-fallback-completed",
			details,
			"Completed",
		);

		const embedded = renderEmbeddedText(tool, {
			content: [{ type: "text", text: "unused" }],
			details,
		});
		const popup = renderOverlayText(snapshot);

		expect(embedded).toContain("[Completed] tars · single · [user]");
		expect(embedded).toContain("tool call · read /tmp/report.md");
		expect(embedded).not.toContain(
			"active tool · read /tmp/report.md → waiting",
		);
		expect(popup).toContain("[Completed] single");
		expect(popup).toContain("tool call · read /tmp/report.md");
		expect(popup).not.toContain("active tool · read /tmp/report.md → waiting");
	});

	test("aligns running no-entry tool-call-only fallback semantics across embedded and popup", () => {
		const { tool } = createExtensionHarness();
		const result = createPendingResult(
			"tars",
			"Inspect live tool-call-only fallback",
			undefined,
			"user",
		);
		result.messages.push({
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "read-1",
					name: "read",
					arguments: { path: "/tmp/report.md" },
				},
			],
		});
		bumpResultVisibleRevision(result);
		bumpResultDerivedRevision(result);
		const details = createDetails("single", [result]);
		const snapshot = createInvocationSnapshot(
			"viewer-tool-call-fallback-running",
			details,
			"Running",
		);

		const embedded = renderEmbeddedText(tool, {
			content: [{ type: "text", text: "unused" }],
			details,
		});
		const popup = renderOverlayText(snapshot);

		expect(embedded).toContain("[Running] tars · single · [user]");
		expect(embedded).toContain("active tool · read /tmp/report.md → waiting");
		expect(popup).toContain("[Running] single");
		expect(popup).toContain("active tool · read /tmp/report.md → waiting");
	});

	test("preserves canceled popup semantics in fallback body state", () => {
		const result = createPendingResult(
			"tars",
			"Canceled task",
			undefined,
			"user",
		);
		result.exitCode = 130;
		result.stopReason = "aborted";
		result.errorMessage = "pi-gremlins run was aborted";
		bumpResultVisibleRevision(result);

		const snapshot = createInvocationSnapshot(
			"viewer-canceled-state",
			createDetails("single", [result]),
			"Canceled",
		);
		const body = getCachedInvocationBodyLines(null, snapshot, 0, createTheme());

		expect(snapshot.status).toBe("Canceled");
		expect(body.lines.join("\n")).toContain("pi-gremlins run was aborted");
	});

	test("renders popup body with differentiated assistant tool and error lines", () => {
		const result = createPendingResult(
			"tars",
			"Inspect mission telemetry",
			undefined,
			"user",
		);
		result.viewerEntries.push(
			{
				type: "assistant-text",
				text: "Streaming mission update",
				streaming: true,
			},
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
				content: "Telemetry packet",
				streaming: false,
				truncated: true,
				isError: false,
			},
			{
				type: "tool-result",
				toolCallId: "bash-1",
				toolName: "bash",
				content: "fatal: boom",
				streaming: false,
				truncated: false,
				isError: true,
			},
		);
		bumpResultDerivedRevision(result);

		const snapshot = createInvocationSnapshot(
			"viewer-body-phase3",
			createDetails("single", [result]),
			"Running",
		);
		const body = getCachedInvocationBodyLines(null, snapshot, 0, createTheme());
		const text = body.lines.join("\n");

		expect(text).toContain("task · Inspect mission telemetry");
		expect(text).toContain("assistant · Streaming mission update [live]");
		expect(text).toContain("tool call · read /tmp/report.md");
		expect(text).toContain("tool result · read [truncated]");
		expect(text).toContain("Telemetry packet");
		expect(text).toContain("tool error · bash [error]");
		expect(text).toContain("fatal: boom");
	});

	test("renders popup empty state with themed idle telemetry", () => {
		const snapshot = createInvocationSnapshot(
			"viewer-empty-phase3",
			createDetails("single", []),
			"Completed",
		);
		const text = renderOverlayText(snapshot);

		expect(text).toContain("pi-gremlins mission control");
		expect(text).toContain("[Completed] single");
		expect(text).toContain("focus · awaiting result selection");
		expect(text).toContain("telemetry · idle");
		expect(text).toContain("quiet · No gremlin results recorded.");
	});

	test("renders popup running state before first viewer entry arrives", () => {
		const result = createPendingResult(
			"tars",
			"Track live run",
			undefined,
			"user",
		);
		const snapshot = createInvocationSnapshot(
			"viewer-running-phase3",
			createDetails("single", [result]),
			"Running",
		);
		const text = renderOverlayText(snapshot);

		expect(text).toContain("[Running] single");
		expect(text).toContain("focus · tars [user] · result [Running]");
		expect(text).toContain("telemetry · idle");
		expect(text).toContain("task · Track live run");
		expect(text).toContain("running · Awaiting first gremlin event.");
	});

	test("renders popup error state with semantic failure copy", () => {
		const result = createPendingResult(
			"tars",
			"Inspect failed route",
			undefined,
			"project",
		);
		result.exitCode = 1;
		result.stderr = "fatal: popup viewer crashed";
		bumpResultVisibleRevision(result);
		const snapshot = createInvocationSnapshot(
			"viewer-error-phase3",
			createDetails("single", [result]),
			"Failed",
		);
		const text = renderOverlayText(snapshot);

		expect(text).toContain("[Failed] single");
		expect(text).toContain("focus · tars [project] · result [Failed]");
		expect(text).toContain("task · Inspect failed route");
		expect(text).toContain("error · fatal: popup viewer crashed");
	});

	test("keeps embedded and popup fallback vocabulary aligned for failed project results without viewer entries", () => {
		const { tool } = createExtensionHarness();
		const result = createPendingResult(
			"tars",
			"Inspect fallback parity",
			undefined,
			"project",
		);
		result.exitCode = 1;
		result.stderr = "fatal: fallback mismatch";
		bumpResultVisibleRevision(result);
		const details = createDetails("single", [result]);
		const snapshot = createInvocationSnapshot(
			"viewer-fallback-parity",
			details,
			"Failed",
		);

		const embedded = renderEmbeddedText(tool, {
			content: [{ type: "text", text: "unused" }],
			details,
		});
		const popup = renderOverlayText(snapshot);

		expect(embedded).toContain("[Failed] tars · single · [project]");
		expect(embedded).toContain("trust · Project agent");
		expect(embedded).toContain("stderr · fatal: fallback mismatch");
		expect(popup).toContain("[Failed] single");
		expect(popup).toContain("focus · tars [project] · result [Failed]");
		expect(popup).toContain("trust · Project agent");
		expect(popup).toContain("error · fatal: fallback mismatch");
	});

	test("renders popup narrow-width layout with essential chrome only", () => {
		const planner = createPendingResult("planner", "Plan route", 1, "project");
		planner.exitCode = 0;
		planner.usage = {
			input: 100,
			output: 20,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0.1,
			contextTokens: 120,
			turns: 1,
		};
		planner.model = "claude-3-7-sonnet";
		planner.viewerEntries.push({
			type: "assistant-text",
			text: "Route locked.",
			streaming: false,
		});

		const reviewer = createPendingResult(
			"reviewer",
			"Review route",
			2,
			"package",
		);
		reviewer.usage = {
			input: 40,
			output: 8,
			cacheRead: 2,
			cacheWrite: 0,
			cost: 0.02,
			contextTokens: 64,
			turns: 2,
		};
		reviewer.model = "gpt-5-mini";
		reviewer.viewerEntries.push({
			type: "tool-call",
			toolCallId: "read-1",
			toolName: "read",
			args: { path: "/tmp/route.md" },
		});
		bumpResultDerivedRevision(planner);
		bumpResultDerivedRevision(reviewer);

		const snapshot = createInvocationSnapshot(
			"viewer-overlay-phase3-narrow",
			createDetails("chain", [planner, reviewer]),
			"Running",
		);
		const text = renderOverlayText(snapshot, {
			width: 38,
			rows: 24,
			selectedResultIndex: 1,
		});

		expect(text).toContain("pi-gremlins mission control");
		expect(text).toContain("[Running] chain");
		expect(text).toContain("focus · reviewer [package] · result [Running]");
		expect(text).toContain("telemetry · turns:3 · input:140");
		expect(text).not.toContain("invocation ·");
		expect(text).not.toContain("step 2/2");
		expect(text).not.toContain("←/→ result");
	});

	test("renders popup short-height layout with body retained after chrome suppression", () => {
		const planner = createPendingResult("planner", "Plan route", 1, "project");
		planner.exitCode = 0;
		planner.usage = {
			input: 100,
			output: 20,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0.1,
			contextTokens: 120,
			turns: 1,
		};
		planner.viewerEntries.push({
			type: "assistant-text",
			text: "Route locked.",
			streaming: false,
		});

		const reviewer = createPendingResult(
			"reviewer",
			"Review route",
			2,
			"package",
		);
		reviewer.usage = {
			input: 40,
			output: 8,
			cacheRead: 2,
			cacheWrite: 0,
			cost: 0.02,
			contextTokens: 64,
			turns: 2,
		};
		reviewer.viewerEntries.push({
			type: "tool-call",
			toolCallId: "read-1",
			toolName: "read",
			args: { path: "/tmp/route.md" },
		});
		bumpResultDerivedRevision(planner);
		bumpResultDerivedRevision(reviewer);

		const snapshot = createInvocationSnapshot(
			"viewer-overlay-phase3-short",
			createDetails("chain", [planner, reviewer]),
			"Running",
		);
		const text = renderOverlayText(snapshot, {
			width: 72,
			rows: 10,
			selectedResultIndex: 1,
		});

		expect(text).toContain("[Running] chain");
		expect(text).toContain("focus · reviewer [package] · result [Running]");
		expect(text).toContain("telemetry · turns:3 · input:140");
		expect(text).toContain("task · Review route");
		expect(text).not.toContain("invocation ·");
		expect(text).not.toContain("step 2/2");
		expect(text).not.toContain("←/→ result");
	});

	test("renders mission-control chrome with focused mixed-model telemetry visible", () => {
		const planner = createPendingResult("planner", "Plan route", 1, "project");
		planner.exitCode = 0;
		planner.usage = {
			input: 100,
			output: 20,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0.1,
			contextTokens: 120,
			turns: 1,
		};
		planner.model = "claude-3-7-sonnet";
		planner.viewerEntries.push({
			type: "assistant-text",
			text: "Route locked.",
			streaming: false,
		});

		const reviewer = createPendingResult(
			"reviewer",
			"Review route",
			2,
			"package",
		);
		reviewer.usage = {
			input: 40,
			output: 8,
			cacheRead: 2,
			cacheWrite: 0,
			cost: 0.02,
			contextTokens: 64,
			turns: 2,
		};
		reviewer.model = "gpt-5-mini";
		reviewer.viewerEntries.push({
			type: "tool-call",
			toolCallId: "read-1",
			toolName: "read",
			args: { path: "/tmp/route.md" },
		});
		bumpResultDerivedRevision(planner);
		bumpResultDerivedRevision(reviewer);

		const snapshot = createInvocationSnapshot(
			"viewer-overlay-phase3",
			createDetails("chain", [planner, reviewer]),
			"Running",
		);
		const text = renderOverlayText(snapshot, {
			width: 72,
			rows: 24,
			selectedResultIndex: 1,
		});

		expect(text).toContain("pi-gremlins mission control");
		expect(text).toContain("[Running] chain");
		expect(text).toContain("focus · reviewer [package] · result [Running]");
		expect(text).toContain("telemetry · turns:3 · input:140");
		expect(text).toContain("model:gpt-5-mini");
		expect(text).not.toContain("model:claude-3-7-sonnet");
		expect(text).toContain("invocation · viewer-overlay-phase3");
		expect(text).toContain("focus · step 2/2 · reviewer [package] · Running");
	});

	test("prunes old terminal invocation snapshots while keeping latest viewer access", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "tars.md", "tars");
		const { tool } = createExtensionHarness();
		let firstResult;
		let lastResult;

		for (let i = 0; i < 26; i++) {
			spawnPlans.push(() =>
				createMockProcess({
					stdoutChunks: [
						jsonLine({
							type: "message_end",
							message: {
								role: "assistant",
								content: [{ type: "text", text: `viewer output ${i}` }],
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
			const result = await tool.execute(
				`viewer-prune-${i}`,
				{ agent: "tars", task: `seed viewer ${i}` },
				undefined,
				undefined,
				createExecutionContext(workspace.repoRoot),
			);
			if (i === 0) firstResult = result;
			if (i === 25) lastResult = result;
		}

		const prunedText = renderEmbeddedText(
			tool,
			firstResult,
			{ expanded: true },
			{ toolCallId: "viewer-prune-0" },
		);
		const latestText = renderEmbeddedText(
			tool,
			lastResult,
			{ expanded: true },
			{ toolCallId: "viewer-prune-25" },
		);

		expect(prunedText).not.toContain("viewer · /pi-gremlins:view");
		expect(latestText).toContain("viewer · /pi-gremlins:view");
	});

	test("focuses existing overlay instead of opening duplicate viewer", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		const { tool, commands, events } = createExtensionHarness();
		await seedInvocation(tool, workspace);

		const customCalls = [];
		const handle = {
			focusCalls: 0,
			hiddenStates: [],
			focus() {
				this.focusCalls += 1;
			},
			setHidden(value) {
				this.hiddenStates.push(value);
			},
			isFocused: () => true,
			hide() {},
		};
		const ctx = {
			hasUI: true,
			ui: {
				notify: () => {},
				custom: async (render, options) => {
					customCalls.push(options);
					await render(
						{ requestRender: () => {} },
						{ fg: (_color, text) => text, bold: (text) => text },
						{ matches: () => false },
						() => {},
					);
					options.onHandle(handle);
				},
			},
		};

		await commands.get("pi-gremlins:view").handler([], ctx);
		await commands.get("pi-gremlins:view").handler([], ctx);

		expect(customCalls).toHaveLength(1);
		expect(handle.focusCalls).toBe(2);
		expect(handle.hiddenStates).toEqual([false]);
		events.get("session_shutdown")?.();
	});
});
