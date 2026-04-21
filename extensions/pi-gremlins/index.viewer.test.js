import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { execSync } from "node:child_process";
import * as fs from "node:fs";

import {
	createMockProcess,
	createWorkspace,
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
} = await import("./index.ts");
const {
	bumpResultDerivedRevision,
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
