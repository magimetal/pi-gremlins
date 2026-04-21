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
let spawnCalls = [];
let spawnPlans = [];

function createSpawnPlanForTask(task, factory) {
	return {
		match: (_command, args) =>
			Array.isArray(args) && args.includes(`Task: ${task}`),
		factory,
	};
}

function resolveSpawnPlan(args) {
	const [command, commandArgs] = args;
	const matchedIndex = spawnPlans.findIndex(
		(plan) =>
			typeof plan !== "function" && plan.match(command, commandArgs, args),
	);
	if (matchedIndex !== -1) {
		const [plan] = spawnPlans.splice(matchedIndex, 1);
		return plan.factory(...args);
	}
	const next = spawnPlans.shift();
	if (!next) return createMockProcess();
	return typeof next === "function" ? next(...args) : next.factory(...args);
}

mock.module("node:child_process", () => ({
	execSync,
	spawn: (...args) => {
		spawnCalls.push(args);
		return resolveSpawnPlan(args);
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
	createInvocationUpdateController,
	default: registerPiGremlins,
} = await import("./index.ts");
const {
	bumpResultDerivedRevision,
	bumpResultVisibleRevision,
	createPendingResult,
	getInvocationStatus,
	getSingleResultStatus,
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

function cloneForAssertion(value) {
	return JSON.parse(JSON.stringify(value));
}

function createDetails(mode, results) {
	return {
		mode,
		agentScope: "user",
		projectAgentsDir: null,
		results,
	};
}

let workspaceRoot = null;

beforeEach(() => {
	spawnCalls = [];
	spawnPlans = [];
});

afterEach(() => {
	if (workspaceRoot) {
		fs.rmSync(workspaceRoot, { recursive: true, force: true });
		workspaceRoot = null;
	}
});

describe("pi-gremlins execute streaming characterization", () => {
	test("treats aborted pending results as canceled instead of running", () => {
		const canceled = createPendingResult(
			"alpha",
			"Do alpha",
			undefined,
			"user",
		);
		canceled.stopReason = "aborted";
		canceled.errorMessage = "pi-gremlins run was aborted";

		expect(getSingleResultStatus(canceled)).toBe("Canceled");
		expect(getInvocationStatus("single", [canceled])).toBe("Canceled");
	});

	test("single mode returns explicit canceled terminal text", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "tars.md", "tars");

		spawnPlans.push(() =>
			createMockProcess({
				stdoutChunks: [
					jsonLine({
						type: "message_end",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "run stopped by operator" }],
							usage: {
								input: 2,
								output: 1,
								cacheRead: 0,
								cacheWrite: 0,
								cost: { total: 0.01 },
								totalTokens: 3,
							},
							stopReason: "aborted",
						},
					}),
				],
				closeCode: 130,
			}),
		);

		const tool = createRegisteredTool();
		const result = await tool.execute(
			"single-canceled-terminal",
			{ agent: "tars", task: "Stop cleanly" },
			undefined,
			undefined,
			createExecutionContext(workspace.repoRoot),
		);

		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toBe("Canceled: run stopped by operator");
		expect(result.details.status).toBe("Canceled");
		expect(result.details.results[0]).toMatchObject({
			agent: "tars",
			exitCode: 130,
			stopReason: "aborted",
		});
	});

	test("single mode streams running updates before final result", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "tars.md", "tars");

		spawnPlans.push(() =>
			createMockProcess({
				stdoutChunks: [
					jsonLine({
						type: "tool_execution_start",
						toolCallId: "read-1",
						toolName: "read",
						args: { path: "/tmp/report.md" },
					}),
					jsonLine({
						type: "tool_execution_update",
						toolCallId: "read-1",
						toolName: "read",
						args: { path: "/tmp/report.md" },
						partialResult: {
							content: [{ type: "text", text: "reading chunk" }],
						},
					}),
					jsonLine({
						type: "tool_execution_end",
						toolCallId: "read-1",
						toolName: "read",
						args: { path: "/tmp/report.md" },
						result: {
							content: [{ type: "text", text: "file contents" }],
						},
					}),
					jsonLine({
						type: "message_end",
						message: {
							role: "assistant",
							content: [
								{
									type: "toolCall",
									id: "read-1",
									name: "read",
									arguments: { path: "/tmp/report.md" },
								},
								{ type: "text", text: "final single answer" },
							],
							usage: {
								input: 11,
								output: 7,
								cacheRead: 2,
								cacheWrite: 1,
								cost: { total: 0.1234 },
								totalTokens: 18,
							},
							model: "gpt-5",
							stopReason: "end_turn",
						},
					}),
				],
				closeCode: 0,
			}),
		);

		const tool = createRegisteredTool();
		const updates = [];
		const result = await tool.execute(
			"single-stream",
			{ agent: "tars", task: "Inspect report" },
			undefined,
			(partial) => updates.push(cloneForAssertion(partial)),
			createExecutionContext(workspace.repoRoot),
		);

		expect(updates.map((update) => update.content[0].text)).toEqual([
			"(running...)",
			"reading chunk",
			"file contents",
			"final single answer",
		]);
		expect(
			updates[1].details.results[0].viewerEntries.some(
				(entry) =>
					entry.type === "tool-result" &&
					entry.streaming === true &&
					entry.content === "reading chunk",
			),
		).toBe(true);
		expect(updates.at(-1).details.results[0]).toMatchObject({
			agent: "tars",
			agentSource: "user",
			exitCode: -1,
			model: "gpt-5",
			usage: {
				input: 11,
				output: 7,
				cacheRead: 2,
				cacheWrite: 1,
				cost: 0.1234,
				contextTokens: 18,
				turns: 1,
			},
		});
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toBe("final single answer");
		expect(result.details.results[0]).toMatchObject({
			agent: "tars",
			agentSource: "user",
			exitCode: 0,
			model: "gpt-5",
		});
		expect(result.details.results[0].viewerEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "tool-call",
					toolName: "read",
				}),
				expect.objectContaining({
					type: "tool-result",
					streaming: false,
					content: "file contents",
				}),
			]),
		);
		expect(spawnCalls).toHaveLength(1);
		expect(spawnCalls[0][2]).toMatchObject({
			cwd: workspace.repoRoot,
			shell: false,
		});
	});

	test("single mode publishes assistant message_update deltas immediately without double-emitting message_end", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "tars.md", "tars");

		spawnPlans.push(() =>
			createMockProcess({
				stdoutChunks: [
					jsonLine({
						type: "message_start",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "draft" }],
						},
					}),
					jsonLine({
						type: "message_update",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "draft reply" }],
						},
					}),
					jsonLine({
						type: "message_end",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "final answer" }],
							usage: {
								input: 3,
								output: 5,
								cacheRead: 0,
								cacheWrite: 0,
								cost: { total: 0.01 },
								totalTokens: 8,
							},
							model: "delta-model",
						},
					}),
				],
				closeCode: 0,
			}),
		);

		const tool = createRegisteredTool();
		const updates = [];
		const result = await tool.execute(
			"single-assistant-delta",
			{ agent: "tars", task: "Stream reply" },
			undefined,
			(partial) => updates.push(cloneForAssertion(partial)),
			createExecutionContext(workspace.repoRoot),
		);

		expect(updates).toHaveLength(3);
		expect(updates[0].content[0].text).toBe("draft");
		expect(updates[0].details.results[0].viewerEntries).toEqual([
			expect.objectContaining({
				type: "assistant-text",
				text: "draft",
				streaming: true,
			}),
		]);
		expect(updates[1].details.results[0].viewerEntries).toEqual([
			expect.objectContaining({
				type: "assistant-text",
				text: "draft reply",
				streaming: true,
			}),
		]);
		expect(updates[2].content[0].text).toBe("final answer");
		expect(result.content[0].text).toBe("final answer");
	});

	test("single mode publishes assistant viewer-entry mutations for tool calls and turn_end finalization", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "tars.md", "tars");

		spawnPlans.push(() =>
			createMockProcess({
				stdoutChunks: [
					jsonLine({
						type: "message_start",
						message: {
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
					}),
					jsonLine({
						type: "message_update",
						message: {
							role: "assistant",
							content: [
								{
									type: "toolCall",
									id: "read-1",
									name: "read",
									arguments: { path: "/tmp/report.md" },
								},
								{ type: "text", text: "draft final" },
							],
						},
					}),
					jsonLine({ type: "turn_end" }),
					jsonLine({
						type: "message_end",
						message: {
							role: "assistant",
							content: [
								{
									type: "toolCall",
									id: "read-1",
									name: "read",
									arguments: { path: "/tmp/report.md" },
								},
								{ type: "text", text: "draft final" },
							],
							usage: {
								input: 2,
								output: 4,
								cacheRead: 0,
								cacheWrite: 0,
								cost: { total: 0.01 },
								totalTokens: 6,
							},
						},
					}),
				],
				closeCode: 0,
			}),
		);

		const tool = createRegisteredTool();
		const updates = [];
		await tool.execute(
			"single-assistant-viewer-entry",
			{ agent: "tars", task: "Use tool before finalizing" },
			undefined,
			(partial) => updates.push(cloneForAssertion(partial)),
			createExecutionContext(workspace.repoRoot),
		);

		expect(updates).toHaveLength(4);
		expect(updates[0].content[0].text).toBe("(running...)");
		expect(updates[0].details.results[0].viewerEntries).toEqual([
			expect.objectContaining({
				type: "tool-call",
				toolCallId: "read-1",
				toolName: "read",
			}),
		]);
		expect(updates[2].content[0].text).toBe("draft final");
		expect(updates[2].details.results[0].viewerEntries).toEqual([
			expect.objectContaining({
				type: "tool-call",
				toolCallId: "read-1",
			}),
			expect.objectContaining({
				type: "assistant-text",
				text: "draft final",
				streaming: false,
			}),
		]);
	});

	test("single mode skips duplicate publish for no-op tool_execution_start after assistant tool call", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "tars.md", "tars");

		spawnPlans.push(() =>
			createMockProcess({
				stdoutChunks: [
					jsonLine({
						type: "message_start",
						message: {
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
					}),
					jsonLine({
						type: "tool_execution_start",
						toolCallId: "read-1",
						toolName: "read",
						args: { path: "/tmp/report.md" },
					}),
					jsonLine({
						type: "message_end",
						message: {
							role: "assistant",
							content: [
								{
									type: "toolCall",
									id: "read-1",
									name: "read",
									arguments: { path: "/tmp/report.md" },
								},
								{ type: "text", text: "final answer" },
							],
							usage: {
								input: 2,
								output: 3,
								cacheRead: 0,
								cacheWrite: 0,
								cost: { total: 0.01 },
								totalTokens: 5,
							},
						},
					}),
				],
				closeCode: 0,
			}),
		);

		const tool = createRegisteredTool();
		const updates = [];
		const result = await tool.execute(
			"single-noop-tool-start",
			{ agent: "tars", task: "Inspect report" },
			undefined,
			(partial) => updates.push(cloneForAssertion(partial)),
			createExecutionContext(workspace.repoRoot),
		);

		expect(updates.map((update) => update.content[0].text)).toEqual([
			"(running...)",
			"final answer",
		]);
		expect(updates[0].details.results[0].viewerEntries).toEqual([
			expect.objectContaining({
				type: "tool-call",
				toolCallId: "read-1",
				toolName: "read",
			}),
		]);
		expect(result.content[0].text).toBe("final answer");
	});

	test("single mode skips duplicate publish for unchanged tool_execution_update", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "tars.md", "tars");

		spawnPlans.push(() =>
			createMockProcess({
				stdoutChunks: [
					jsonLine({
						type: "tool_execution_update",
						toolCallId: "write-1",
						toolName: "write",
						args: { path: "/tmp/draft.md" },
						partialResult: {
							content: [{ type: "text", text: "drafting" }],
						},
					}),
					jsonLine({
						type: "tool_execution_update",
						toolCallId: "write-1",
						toolName: "write",
						args: { path: "/tmp/draft.md" },
						partialResult: {
							content: [{ type: "text", text: "drafting" }],
						},
					}),
					jsonLine({
						type: "message_end",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "final answer" }],
							usage: {
								input: 1,
								output: 2,
								cacheRead: 0,
								cacheWrite: 0,
								cost: { total: 0.01 },
								totalTokens: 3,
							},
						},
					}),
				],
				closeCode: 0,
			}),
		);

		const tool = createRegisteredTool();
		const updates = [];
		const result = await tool.execute(
			"single-unchanged-tool-update",
			{ agent: "tars", task: "Draft file" },
			undefined,
			(partial) => updates.push(cloneForAssertion(partial)),
			createExecutionContext(workspace.repoRoot),
		);

		expect(updates.map((update) => update.content[0].text)).toEqual([
			"drafting",
			"final answer",
		]);
		expect(updates[0].details.results[0].viewerEntries).toEqual([
			expect.objectContaining({
				type: "tool-call",
				toolCallId: "write-1",
				toolName: "write",
			}),
			expect.objectContaining({
				type: "tool-result",
				toolCallId: "write-1",
				content: "drafting",
				streaming: true,
			}),
		]);
		expect(result.content[0].text).toBe("final answer");
	});

	test("single mode derives terminal output from viewer entries when messages are empty", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "tars.md", "tars");

		spawnPlans.push(() =>
			createMockProcess({
				stdoutChunks: [
					jsonLine({
						type: "tool_execution_end",
						toolCallId: "read-1",
						toolName: "read",
						args: { path: "/tmp/report.md" },
						result: {
							content: [{ type: "text", text: "viewer-only output" }],
						},
					}),
				],
				closeCode: 0,
			}),
		);

		const tool = createRegisteredTool();
		const updates = [];
		const result = await tool.execute(
			"single-viewer-entries-final-output",
			{ agent: "tars", task: "Read report" },
			undefined,
			(partial) => updates.push(cloneForAssertion(partial)),
			createExecutionContext(workspace.repoRoot),
		);

		expect(updates.at(-1).content[0].text).toBe("viewer-only output");
		expect(result.content[0].text).toBe("viewer-only output");
		expect(result.details.results[0].viewerEntries).toEqual([
			expect.objectContaining({
				type: "tool-call",
				toolCallId: "read-1",
			}),
			expect.objectContaining({
				type: "tool-result",
				content: "viewer-only output",
				streaming: false,
			}),
		]);
	});

	test("single mode resolves buffered terminal output after child exit when close never arrives", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "tars.md", "tars");

		spawnPlans.push(() =>
			createMockProcess({
				stdoutChunks: [
					JSON.stringify({
						type: "message_end",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "final answer after exit" }],
							usage: {
								input: 3,
								output: 2,
								cacheRead: 0,
								cacheWrite: 0,
								cost: { total: 0.01 },
								totalTokens: 5,
							},
						},
					}),
				],
				exitCode: 0,
				exitDelay: 5,
				omitClose: true,
			}),
		);

		const tool = createRegisteredTool();
		const result = await Promise.race([
			tool.execute(
				"single-exit-without-close",
				{ agent: "tars", task: "Finish and exit cleanly" },
				undefined,
				undefined,
				createExecutionContext(workspace.repoRoot),
			),
			new Promise((_, reject) => {
				setTimeout(() => {
					reject(new Error("timed out waiting for child exit fallback"));
				}, 250);
			}),
		]);

		expect(result.content[0].text).toBe("final answer after exit");
		expect(result.details.status).toBe("Completed");
		expect(result.details.results[0]).toMatchObject({
			agent: "tars",
			exitCode: 0,
		});
	});

	test("chain mode emits pending snapshots, previous substitution, and stops on error", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "writer.md", "writer");
		writeAgentFile(workspace.userAgentsDir, "reviewer.md", "reviewer");
		writeAgentFile(workspace.userAgentsDir, "closer.md", "closer");

		spawnPlans.push(
			() =>
				createMockProcess({
					stdoutChunks: [
						jsonLine({
							type: "tool_execution_update",
							toolCallId: "write-1",
							toolName: "write",
							args: { path: "/tmp/draft.md" },
							partialResult: {
								content: [{ type: "text", text: "drafting" }],
							},
						}),
						jsonLine({
							type: "message_end",
							message: {
								role: "assistant",
								content: [{ type: "text", text: "draft one" }],
								usage: {
									input: 4,
									output: 6,
									cacheRead: 0,
									cacheWrite: 0,
									cost: { total: 0.02 },
									totalTokens: 10,
								},
								model: "writer-model",
							},
						}),
					],
					closeCode: 0,
				}),
			() =>
				createMockProcess({
					stdoutChunks: [
						jsonLine({
							type: "tool_execution_update",
							toolCallId: "review-1",
							toolName: "grep",
							args: { pattern: "todo" },
							partialResult: {
								content: [{ type: "text", text: "reviewing" }],
							},
						}),
						jsonLine({
							type: "message_end",
							message: {
								role: "assistant",
								content: [{ type: "text", text: "fatal review" }],
								usage: {
									input: 3,
									output: 2,
									cacheRead: 0,
									cacheWrite: 0,
									cost: { total: 0.01 },
									totalTokens: 5,
								},
								model: "review-model",
							},
						}),
					],
					closeCode: 2,
				}),
		);

		const tool = createRegisteredTool();
		const updates = [];
		const result = await tool.execute(
			"chain-stream",
			{
				chain: [
					{ agent: "writer", task: "Draft initial answer" },
					{ agent: "reviewer", task: "Review {previous} carefully" },
					{ agent: "closer", task: "Finalize {previous}" },
				],
			},
			undefined,
			(partial) => updates.push(cloneForAssertion(partial)),
			createExecutionContext(workspace.repoRoot),
		);

		expect(updates[0].content[0].text).toBe("(running...)");
		expect(updates[0].details.results).toEqual([
			expect.objectContaining({
				agent: "writer",
				step: 1,
				task: "Draft initial answer",
				exitCode: -1,
			}),
		]);
		expect(
			updates.some(
				(update) =>
					update.details.results.length === 1 &&
					update.details.results[0].viewerEntries.some(
						(entry) =>
							entry.type === "tool-result" &&
							entry.streaming === true &&
							entry.content === "drafting",
					),
			),
		).toBe(true);
		const secondStepPending = updates.find(
			(update) =>
				update.details.results.length === 2 &&
				update.details.results[1].task === "Review draft one carefully",
		);
		expect(secondStepPending).toBeDefined();
		expect(secondStepPending.details.results[0]).toMatchObject({
			agent: "writer",
			exitCode: 0,
		});
		expect(secondStepPending.details.results[1]).toMatchObject({
			agent: "reviewer",
			step: 2,
			exitCode: -1,
		});
		expect(
			updates.some(
				(update) =>
					update.details.results.length === 2 &&
					update.details.results[1].viewerEntries.some(
						(entry) =>
							entry.type === "tool-result" &&
							entry.streaming === true &&
							entry.content === "reviewing",
					),
			),
		).toBe(true);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toBe(
			"Chain stopped at step 2 (reviewer): fatal review",
		);
		expect(result.details.results).toHaveLength(2);
		expect(result.details.results[1]).toMatchObject({
			agent: "reviewer",
			exitCode: 2,
		});
		expect(spawnCalls).toHaveLength(2);
	});

	test("chain mode carries forward viewer-entry output and stops on canceled results", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "writer.md", "writer");
		writeAgentFile(workspace.userAgentsDir, "reviewer.md", "reviewer");
		writeAgentFile(workspace.userAgentsDir, "closer.md", "closer");

		spawnPlans.push(
			() =>
				createMockProcess({
					stdoutChunks: [
						jsonLine({
							type: "tool_execution_end",
							toolCallId: "write-1",
							toolName: "write",
							args: { path: "/tmp/draft.md" },
							result: {
								content: [{ type: "text", text: "carry-forward draft" }],
							},
						}),
					],
					closeCode: 0,
				}),
			() =>
				createMockProcess({
					stdoutChunks: [
						jsonLine({
							type: "message_end",
							message: {
								role: "assistant",
								content: [{ type: "text", text: "review canceled" }],
								usage: {
									input: 2,
									output: 1,
									cacheRead: 0,
									cacheWrite: 0,
									cost: { total: 0.01 },
									totalTokens: 3,
								},
								stopReason: "aborted",
							},
						}),
					],
					closeCode: 130,
				}),
		);

		const tool = createRegisteredTool();
		const result = await tool.execute(
			"chain-canceled-stop",
			{
				chain: [
					{ agent: "writer", task: "Draft initial answer" },
					{ agent: "reviewer", task: "Review {previous} carefully" },
					{ agent: "closer", task: "Finalize {previous}" },
				],
			},
			undefined,
			undefined,
			createExecutionContext(workspace.repoRoot),
		);

		expect(spawnCalls).toHaveLength(2);
		expect(spawnCalls[1][1]).toContain(
			"Task: Review carry-forward draft carefully",
		);
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toBe(
			"Chain canceled at step 2 (reviewer): review canceled",
		);
		expect(result.details.status).toBe("Canceled");
		expect(result.details.results).toHaveLength(2);
		expect(result.details.results[1]).toMatchObject({
			agent: "reviewer",
			exitCode: 130,
			stopReason: "aborted",
		});
	});

	test("coalesces repeated progress-only updates and flushes latest before next content-bearing update", () => {
		const publishedSnapshots = new Map();
		const emitted = [];
		const controller = createInvocationUpdateController(
			(toolCallId) => publishedSnapshots.get(toolCallId),
			(toolCallId, snapshot) => {
				publishedSnapshots.set(toolCallId, snapshot);
			},
			(partial) => emitted.push(cloneForAssertion(partial)),
		);
		const alpha = createPendingResult("alpha", "Do alpha", undefined, "user");
		const beta = createPendingResult("beta", "Do beta", undefined, "user");
		const invocationId = "coalesce-sequence";

		controller.applyPartial(invocationId, {
			content: [{ type: "text", text: "Parallel: 0/2 done, 2 running..." }],
			details: createDetails("parallel", [alpha, beta]),
		});
		controller.applyPartial(invocationId, {
			content: [{ type: "text", text: "Parallel: working update 1" }],
			details: createDetails("parallel", [alpha, beta]),
		});
		controller.applyPartial(invocationId, {
			content: [{ type: "text", text: "Parallel: working update 2" }],
			details: createDetails("parallel", [alpha, beta]),
		});

		alpha.viewerEntries.push({
			type: "tool-result",
			toolCallId: "alpha-tool-1",
			toolName: "bash",
			content: "alpha viewer output",
			streaming: true,
			truncated: false,
			isError: false,
		});
		bumpResultDerivedRevision(alpha);
		controller.applyPartial(invocationId, {
			content: [{ type: "text", text: "Parallel: 0/2 done, 2 running..." }],
			details: createDetails("parallel", [alpha, beta]),
		});

		expect(emitted.map((update) => update.content[0].text)).toEqual([
			"Parallel: 0/2 done, 2 running...",
			"Parallel: working update 2",
			"Parallel: 0/2 done, 2 running...",
		]);
		expect(emitted[1].details.results[0].viewerEntries).toEqual([]);
		expect(emitted[2].details.results[0].viewerEntries).toEqual([
			expect.objectContaining({
				type: "tool-result",
				content: "alpha viewer output",
				streaming: true,
			}),
		]);
		const published = publishedSnapshots.get(invocationId);
		expect(published.results[0].viewerEntries).toEqual([
			expect.objectContaining({ content: "alpha viewer output" }),
		]);
	});

	test("flushes pending progress before assistant message_update snapshot", () => {
		const publishedSnapshots = new Map();
		const emitted = [];
		const controller = createInvocationUpdateController(
			(toolCallId) => publishedSnapshots.get(toolCallId),
			(toolCallId, snapshot) => {
				publishedSnapshots.set(toolCallId, snapshot);
			},
			(partial) => emitted.push(cloneForAssertion(partial)),
		);
		const alpha = createPendingResult("alpha", "Do alpha", undefined, "user");
		const invocationId = "assistant-message-update-flush";

		controller.applyPartial(invocationId, {
			content: [{ type: "text", text: "(running...)" }],
			details: createDetails("single", [alpha]),
		});
		controller.applyPartial(invocationId, {
			content: [{ type: "text", text: "still running" }],
			details: createDetails("single", [alpha]),
		});

		alpha.viewerEntries.push({
			type: "assistant-text",
			text: "draft reply",
			streaming: true,
		});
		bumpResultDerivedRevision(alpha);
		controller.applyPartial(invocationId, {
			content: [{ type: "text", text: "(running...)" }],
			details: createDetails("single", [alpha]),
		});

		expect(emitted.map((update) => update.content[0].text)).toEqual([
			"(running...)",
			"still running",
			"(running...)",
		]);
		expect(emitted[2].details.results[0].viewerEntries).toEqual([
			expect.objectContaining({
				type: "assistant-text",
				text: "draft reply",
				streaming: true,
			}),
		]);
		expect(
			publishedSnapshots.get(invocationId).results[0].viewerEntries,
		).toEqual([expect.objectContaining({ text: "draft reply" })]);
	});

	test("flushes pending progress during terminal publish without leaving pending state behind", () => {
		const publishedSnapshots = new Map();
		const emitted = [];
		const controller = createInvocationUpdateController(
			(toolCallId) => publishedSnapshots.get(toolCallId),
			(toolCallId, snapshot) => {
				publishedSnapshots.set(toolCallId, snapshot);
			},
			(partial) => emitted.push(cloneForAssertion(partial)),
		);
		const alpha = createPendingResult("alpha", "Do alpha", undefined, "user");
		const invocationId = "terminal-flush";

		controller.applyPartial(invocationId, {
			content: [{ type: "text", text: "(running...)" }],
			details: createDetails("single", [alpha]),
		});
		controller.applyPartial(invocationId, {
			content: [{ type: "text", text: "still running" }],
			details: createDetails("single", [alpha]),
		});
		alpha.exitCode = 0;
		bumpResultVisibleRevision(alpha);
		const terminalSnapshot = controller.publishDetails(
			invocationId,
			createDetails("single", [alpha]),
			"Completed",
		);

		expect(emitted.map((update) => update.content[0].text)).toEqual([
			"(running...)",
			"still running",
		]);
		expect(terminalSnapshot.status).toBe("Completed");
		expect(publishedSnapshots.get(invocationId).status).toBe("Completed");
	});

	test("preserves older snapshots while structurally sharing untouched results", () => {
		const alpha = createPendingResult("alpha", "Do alpha", undefined, "user");
		const beta = createPendingResult("beta", "Do beta", undefined, "user");
		const firstSnapshot = createInvocationSnapshot(
			"snapshot-structural-sharing",
			createDetails("parallel", [alpha, beta]),
			"Running",
		);

		alpha.messages.push({
			role: "assistant",
			content: [{ type: "text", text: "alpha first output" }],
		});
		alpha.viewerEntries.push({
			type: "assistant-text",
			text: "alpha first output",
			streaming: false,
		});
		bumpResultDerivedRevision(alpha);

		const secondSnapshot = createInvocationSnapshot(
			"snapshot-structural-sharing",
			createDetails("parallel", [alpha, beta]),
			"Running",
			firstSnapshot,
		);

		alpha.messages[0].content[0].text = "alpha mutated later";
		alpha.viewerEntries[0].text = "alpha mutated later";

		expect(firstSnapshot.results[0].messages).toEqual([]);
		expect(firstSnapshot.results[1]).toBe(secondSnapshot.results[1]);
		expect(firstSnapshot.results[0]).not.toBe(secondSnapshot.results[0]);
		expect(secondSnapshot.results[0].messages[0].content[0].text).toBe(
			"alpha first output",
		);
		expect(secondSnapshot.results[0].viewerEntries[0].text).toBe(
			"alpha first output",
		);
	});

	test("parallel mode keeps task outputs aligned when spawn order differs from task order", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "alpha.md", "alpha");
		fs.writeFileSync(
			`${workspace.userAgentsDir}/beta.md`,
			"---\nname: beta\ndescription: beta description\n---\n",
			"utf-8",
		);

		spawnPlans.push(
			createSpawnPlanForTask("Do alpha", () =>
				createMockProcess({
					stdoutChunks: [
						jsonLine({
							type: "message_end",
							message: {
								role: "assistant",
								content: [{ type: "text", text: "alpha done" }],
								usage: {
									input: 5,
									output: 4,
									cacheRead: 0,
									cacheWrite: 0,
									cost: { total: 0.03 },
									totalTokens: 9,
								},
								model: "alpha-model",
							},
						}),
					],
					closeCode: 0,
				}),
			),
			createSpawnPlanForTask("Do beta", () =>
				createMockProcess({
					stdoutChunks: [
						jsonLine({
							type: "message_end",
							message: {
								role: "assistant",
								content: [{ type: "text", text: "beta failed" }],
								usage: {
									input: 6,
									output: 2,
									cacheRead: 0,
									cacheWrite: 0,
									cost: { total: 0.02 },
									totalTokens: 8,
								},
								model: "beta-model",
							},
						}),
					],
					closeCode: 1,
				}),
			),
		);

		const tool = createRegisteredTool();
		const result = await tool.execute(
			"parallel-spawn-order",
			{
				tasks: [
					{ agent: "alpha", task: "Do alpha" },
					{ agent: "beta", task: "Do beta" },
				],
			},
			undefined,
			undefined,
			createExecutionContext(workspace.repoRoot),
		);

		expect(result.content[0].text).toBe(
			"Parallel: 1/2 succeeded, 1 failed\n\n[alpha] completed: alpha done\n\n[beta] failed: beta failed",
		);
		expect(result.details.results[0]).toMatchObject({
			agent: "alpha",
			exitCode: 0,
		});
		expect(result.details.results[1]).toMatchObject({
			agent: "beta",
			exitCode: 1,
		});
	});

	test("parallel mode streams initial pending state, per-task progress, and final aggregate details", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "alpha.md", "alpha");
		writeAgentFile(workspace.userAgentsDir, "beta.md", "beta");

		spawnPlans.push(
			createSpawnPlanForTask("Do alpha", () =>
				createMockProcess({
					stdoutChunks: [
						{
							delay: 0,
							data: jsonLine({
								type: "tool_execution_update",
								toolCallId: "alpha-1",
								toolName: "bash",
								args: { command: "echo alpha" },
								partialResult: {
									content: [{ type: "text", text: "alpha progress" }],
								},
							}),
						},
						{
							delay: 4,
							data: jsonLine({
								type: "message_end",
								message: {
									role: "assistant",
									content: [{ type: "text", text: "alpha done" }],
									usage: {
										input: 5,
										output: 4,
										cacheRead: 0,
										cacheWrite: 0,
										cost: { total: 0.03 },
										totalTokens: 9,
									},
									model: "alpha-model",
								},
							}),
						},
					],
					closeCode: 0,
					closeDelay: 6,
				}),
			),
			createSpawnPlanForTask("Do beta", () =>
				createMockProcess({
					stdoutChunks: [
						{
							delay: 1,
							data: jsonLine({
								type: "tool_execution_update",
								toolCallId: "beta-1",
								toolName: "bash",
								args: { command: "echo beta" },
								partialResult: {
									content: [{ type: "text", text: "beta progress" }],
								},
							}),
						},
						{
							delay: 7,
							data: jsonLine({
								type: "message_end",
								message: {
									role: "assistant",
									content: [{ type: "text", text: "beta failed" }],
									usage: {
										input: 6,
										output: 2,
										cacheRead: 0,
										cacheWrite: 0,
										cost: { total: 0.02 },
										totalTokens: 8,
									},
									model: "beta-model",
								},
							}),
						},
					],
					closeCode: 1,
					closeDelay: 9,
				}),
			),
		);

		const tool = createRegisteredTool();
		const updates = [];
		const result = await tool.execute(
			"parallel-stream",
			{
				tasks: [
					{ agent: "alpha", task: "Do alpha" },
					{ agent: "beta", task: "Do beta" },
				],
			},
			undefined,
			(partial) => updates.push(cloneForAssertion(partial)),
			createExecutionContext(workspace.repoRoot),
		);

		expect(updates[0].content[0].text).toBe("Parallel: 0/2 done, 2 running...");
		expect(updates[0].details.results).toEqual([
			expect.objectContaining({
				agent: "alpha",
				exitCode: -1,
				task: "Do alpha",
			}),
			expect.objectContaining({ agent: "beta", exitCode: -1, task: "Do beta" }),
		]);
		expect(
			updates.some((update) =>
				update.details.results[0].viewerEntries.some(
					(entry) =>
						entry.type === "tool-result" &&
						entry.streaming === true &&
						entry.content === "alpha progress",
				),
			),
		).toBe(true);
		expect(
			updates.some(
				(update) =>
					update.content[0].text === "Parallel: 1/2 done, 1 running...",
			),
		).toBe(true);
		expect(
			updates.some(
				(update) =>
					update.content[0].text === "Parallel: 2/2 done, 0 running...",
			),
		).toBe(true);
		expect(result.content[0].text).toBe(
			"Parallel: 1/2 succeeded, 1 failed\n\n[alpha] completed: alpha done\n\n[beta] failed: beta failed",
		);
		expect(result.details.results).toHaveLength(2);
		expect(result.details.results[0]).toMatchObject({
			agent: "alpha",
			exitCode: 0,
		});
		expect(result.details.results[1]).toMatchObject({
			agent: "beta",
			exitCode: 1,
		});
		expect(spawnCalls).toHaveLength(2);
	});

	test("parallel mode reports canceled children without labeling them failed", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "alpha.md", "alpha");
		writeAgentFile(workspace.userAgentsDir, "beta.md", "beta");

		spawnPlans.push(
			createSpawnPlanForTask("Do alpha", () =>
				createMockProcess({
					stdoutChunks: [
						jsonLine({
							type: "message_end",
							message: {
								role: "assistant",
								content: [{ type: "text", text: "alpha done" }],
								usage: {
									input: 1,
									output: 1,
									cacheRead: 0,
									cacheWrite: 0,
									cost: { total: 0.01 },
									totalTokens: 2,
								},
							},
						}),
					],
					closeCode: 0,
				}),
			),
			createSpawnPlanForTask("Do beta", () =>
				createMockProcess({
					stdoutChunks: [
						jsonLine({
							type: "message_end",
							message: {
								role: "assistant",
								content: [{ type: "text", text: "beta canceled" }],
								usage: {
									input: 1,
									output: 1,
									cacheRead: 0,
									cacheWrite: 0,
									cost: { total: 0.01 },
									totalTokens: 2,
								},
								stopReason: "aborted",
							},
						}),
					],
					closeCode: 130,
				}),
			),
		);

		const tool = createRegisteredTool();
		const result = await tool.execute(
			"parallel-canceled-summary",
			{
				tasks: [
					{ agent: "alpha", task: "Do alpha" },
					{ agent: "beta", task: "Do beta" },
				],
			},
			undefined,
			undefined,
			createExecutionContext(workspace.repoRoot),
		);

		expect(result.isError).toBeUndefined();
		expect(result.details.status).toBe("Canceled");
		expect(result.content[0].text).toBe(
			"Parallel: 1/2 succeeded, 1 canceled\n\n[alpha] completed: alpha done\n\n[beta] canceled: beta canceled",
		);
		expect(result.details.results[1]).toMatchObject({
			agent: "beta",
			exitCode: 130,
			stopReason: "aborted",
		});
	});
});
