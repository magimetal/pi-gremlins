import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { execSync } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let mockAgentDir = "/tmp";
let spawnCalls = [];
let spawnPlan = () => createMockProcess();

function parseFrontmatter(content) {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return { frontmatter: {}, body: content };

	const frontmatter = {};
	for (const line of match[1].split("\n")) {
		const separatorIndex = line.indexOf(":");
		if (separatorIndex === -1) continue;
		const key = line.slice(0, separatorIndex).trim();
		const value = line.slice(separatorIndex + 1).trim();
		frontmatter[key] = value;
	}

	return {
		frontmatter,
		body: match[2],
	};
}

function createMockProcess({
	stdoutChunks = [],
	stderrChunks = [],
	closeCode = 0,
} = {}) {
	const proc = new EventEmitter();
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.killed = false;
	proc.kill = () => {
		proc.killed = true;
	};

	queueMicrotask(() => {
		for (const chunk of stdoutChunks) {
			proc.stdout.emit("data", Buffer.from(chunk));
		}
		for (const chunk of stderrChunks) {
			proc.stderr.emit("data", Buffer.from(chunk));
		}
		proc.emit("close", closeCode);
	});

	return proc;
}

mock.module("node:child_process", () => ({
	execSync,
	spawn: (...args) => {
		spawnCalls.push(args);
		return spawnPlan(...args);
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
	Container: class {},
	Key: {
		home: "home",
		end: "end",
		up: "up",
		down: "down",
		ctrl: (key) => `ctrl-${key}`,
		alt: (key) => `alt-${key}`,
	},
	Markdown: class {},
	Spacer: class {},
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

mock.module("./viewer-open-action.js", () => ({
	getViewerOpenAction: (runtime) => {
		if (runtime?.closed) return "open-new";
		if (!runtime) return "open-new";
		return runtime.handle ? "focus-existing" : "await-existing";
	},
}));

const { resolveAgentByName } = await import("./agents.ts");
const { default: registerPiGremlins } = await import("./index.ts");

function createAgent(name, source = "user") {
	return {
		name,
		description: `${name} description`,
		systemPrompt: "system prompt",
		source,
		filePath: `/tmp/${name}.md`,
	};
}

function writeAgentFile(
	dir,
	fileName,
	name,
	description = `${name} description`,
) {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, fileName),
		`---\nname: ${name}\ndescription: ${description}\n---\nsystem prompt`,
		"utf-8",
	);
}

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

function createExecutionContext(
	cwd,
	{ hasUI = false, confirm = async () => true } = {},
) {
	const confirmations = [];
	return {
		confirmations,
		ctx: {
			cwd,
			hasUI,
			ui: {
				confirm: async (title, body) => {
					confirmations.push({ title, body });
					return confirm(title, body);
				},
				notify: () => {},
				custom: async () => {},
			},
		},
	};
}

function createWorkspace() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gremlins-case-"));
	const userRoot = path.join(root, "user-home");
	const repoRoot = path.join(root, "repo");
	const userAgentsDir = path.join(userRoot, "agents");
	const projectAgentsDir = path.join(repoRoot, ".pi", "agents");
	fs.mkdirSync(repoRoot, { recursive: true });
	return { root, userRoot, repoRoot, userAgentsDir, projectAgentsDir };
}

let workspaceRoot = null;

beforeEach(() => {
	spawnCalls = [];
	spawnPlan = () => createMockProcess();
});

afterEach(() => {
	if (workspaceRoot) {
		fs.rmSync(workspaceRoot, { recursive: true, force: true });
		workspaceRoot = null;
	}
});

describe("resolveAgentByName", () => {
	test("matches agent names case-insensitively when exact casing differs", () => {
		const tars = createAgent("tars");

		expect(resolveAgentByName([tars], "TARS")).toEqual({
			agent: tars,
			ambiguousMatches: [],
		});
	});

	test("prefers exact-case match when multiple agents differ only by case", () => {
		const lower = createAgent("tars", "user");
		const upper = createAgent("TARS", "project");

		expect(resolveAgentByName([lower, upper], "TARS")).toEqual({
			agent: upper,
			ambiguousMatches: [],
		});
	});

	test("reports ambiguity when only case-insensitive matches exist", () => {
		const lower = createAgent("tars", "user");
		const upper = createAgent("TARS", "project");

		expect(resolveAgentByName([lower, upper], "TaRs")).toEqual({
			agent: null,
			ambiguousMatches: [lower, upper],
		});
	});
});

describe("pi-gremlins execute case-insensitive lookup", () => {
	test("resolves mixed-case single-agent request through execute path", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "tars.md", "tars");

		const tool = createRegisteredTool();
		const { ctx } = createExecutionContext(workspace.repoRoot);
		spawnPlan = () => createMockProcess({ closeCode: 0 });

		const result = await tool.execute(
			"tool-call-1",
			{ agent: "TARS", task: "ping" },
			undefined,
			undefined,
			ctx,
		);

		expect(result.isError).toBeUndefined();
		expect(result.details.results).toHaveLength(1);
		expect(result.details.results[0]).toMatchObject({
			agent: "tars",
			agentSource: "user",
			exitCode: 0,
		});
		expect(spawnCalls).toHaveLength(1);
		expect(spawnCalls[0][2]).toMatchObject({
			cwd: workspace.repoRoot,
			shell: false,
		});
	});

	test("propagates ambiguity error through execute path", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.userAgentsDir, "tars.md", "tars");
		writeAgentFile(workspace.projectAgentsDir, "TARS.md", "TARS");

		const tool = createRegisteredTool();
		const { ctx } = createExecutionContext(workspace.repoRoot);

		const result = await tool.execute(
			"tool-call-2",
			{ agent: "TaRs", task: "ping", agentScope: "both" },
			undefined,
			undefined,
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('Ambiguous gremlin: "TaRs".');
		expect(result.content[0].text).toContain(
			"Matching gremlins: tars (user), TARS (project).",
		);
		expect(spawnCalls).toHaveLength(0);
	});

	test("confirms mixed-case project agent request before execution", async () => {
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		mockAgentDir = workspace.userRoot;
		writeAgentFile(workspace.projectAgentsDir, "tars.md", "tars");

		const tool = createRegisteredTool();
		const { ctx, confirmations } = createExecutionContext(workspace.repoRoot, {
			hasUI: true,
			confirm: async () => false,
		});

		const result = await tool.execute(
			"tool-call-3",
			{ agent: "TARS", task: "ping", agentScope: "project" },
			undefined,
			undefined,
			ctx,
		);

		expect(confirmations).toHaveLength(1);
		expect(confirmations[0]).toEqual({
			title: "Run project-local gremlins?",
			body: `Gremlins: tars\nSource: ${workspace.projectAgentsDir}\n\nProject gremlins are repo-controlled. Only continue for trusted repositories.`,
		});
		expect(result.content[0].text).toBe(
			"Canceled: project-local gremlins not approved.",
		);
		expect(spawnCalls).toHaveLength(0);
	});
});
