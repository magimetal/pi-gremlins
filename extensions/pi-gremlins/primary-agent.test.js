import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { createWorkspace, writeAgentFile } from "./test-helpers.js";

let workspaceRoot = null;

afterEach(() => {
	if (workspaceRoot) {
		fs.rmSync(workspaceRoot, { recursive: true, force: true });
		workspaceRoot = null;
	}
});

function writePrimaryFile(dir, fileName, body) {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, fileName), body, "utf-8");
}

function createMockPi() {
	const handlers = new Map();
	return {
		tools: [],
		commands: new Map(),
		shortcuts: new Map(),
		entries: [],
		messages: [],
		on(event, handler) {
			handlers.set(event, handler);
		},
		handler(event) {
			return handlers.get(event);
		},
		registerTool(tool) {
			this.tools.push(tool);
		},
		registerCommand(name, options) {
			this.commands.set(name, options);
		},
		registerShortcut(shortcut, options) {
			this.shortcuts.set(shortcut, options);
		},
		appendEntry(customType, data) {
			this.entries.push({ customType, data });
		},
		sendMessage(message) {
			this.messages.push(message);
		},
	};
}

function createMockContext(workspace, branchEntries = [], hasUI = false) {
	return {
		cwd: workspace.repoRoot,
		hasUI,
		ui: {
			statuses: [],
			notifications: [],
			selected: undefined,
			setStatus(key, text) {
				this.statuses.push({ key, text });
			},
			notify(message, type = "info") {
				this.notifications.push({ message, type });
			},
			async select() {
				return this.selected;
			},
		},
		sessionManager: {
			getBranch() {
				return branchEntries;
			},
		},
		getSystemPrompt() {
			return "system";
		},
		model: undefined,
		modelRegistry: undefined,
	};
}

describe("primary-agent definition and discovery", () => {
	test("loads only primary agents and applies display-name fallback order", async () => {
		const { parsePrimaryAgentDefinition } = await import("./primary-agent-definition.ts");
		const byName = parsePrimaryAgentDefinition(
			"---\nname: Commander\nagent_type: primary\n---\n# Heading",
			"/tmp/file.md",
			"user",
		);
		const byHeading = parsePrimaryAgentDefinition(
			"---\nagent_type: primary\n---\n# Heading Name",
			"/tmp/file.md",
			"user",
		);
		const byFile = parsePrimaryAgentDefinition(
			"---\nagent_type: primary\n---\nNo heading",
			"/tmp/file-name.md",
			"user",
		);
		const subAgent = parsePrimaryAgentDefinition(
			"---\nname: sub\nagent_type: sub-agent\n---\n# Sub",
			"/tmp/sub.md",
			"user",
		);

		expect(byName?.name).toBe("Commander");
		expect(byHeading?.name).toBe("Heading Name");
		expect(byFile?.name).toBe("file-name");
		expect(subAgent).toBeNull();
	});

	test("keeps primary agents separate from gremlins and lets project override user", async () => {
		const { createGremlinDiscoveryCache, createPrimaryAgentDiscoveryCache } = await import("./gremlin-discovery.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		writePrimaryFile(workspace.userAgentsDir, "shared.md", "---\nname: shared\nagent_type: primary\n---\nuser primary");
		writeAgentFile(workspace.userAgentsDir, "gremlin.md", "gremlin");
		writePrimaryFile(workspace.projectAgentsDir, "shared.md", "---\nname: shared\nagent_type: primary\n---\nproject primary");
		writePrimaryFile(workspace.projectAgentsDir, "other.md", "---\nagent_type: primary\n---\n# Other Primary");

		const primaryDiscovery = createPrimaryAgentDiscoveryCache({ userAgentsDir: workspace.userAgentsDir });
		const gremlinDiscovery = createGremlinDiscoveryCache({ userAgentsDir: workspace.userAgentsDir });
		const primary = await primaryDiscovery.get(workspace.repoRoot);
		const gremlins = await gremlinDiscovery.get(workspace.repoRoot);

		expect(primary.agents.map((agent) => ({ name: agent.name, source: agent.source }))).toEqual([
			{ name: "Other Primary", source: "project" },
			{ name: "shared", source: "project" },
		]);
		expect(primary.agents.find((agent) => agent.name === "shared").rawMarkdown).toContain("project primary");
		expect(gremlins.gremlins.map((gremlin) => gremlin.name)).toEqual(["gremlin"]);
	});

	test("resolves exact, unambiguous folded, ambiguous folded, and missing names", async () => {
		const { resolvePrimaryAgentByName } = await import("./gremlin-discovery.ts");
		const agents = ["Alpha", "ALPHA", "Beta"].map((name) => ({ name }));

		expect(resolvePrimaryAgentByName(agents, "Beta")).toMatchObject({ status: "found", agent: { name: "Beta" } });
		expect(resolvePrimaryAgentByName(agents, "beta")).toMatchObject({ status: "found", agent: { name: "Beta" } });
		expect(resolvePrimaryAgentByName(agents, "alpha")).toMatchObject({ status: "ambiguous" });
		expect(resolvePrimaryAgentByName(agents, "missing")).toEqual({ status: "not-found" });
	});
});

describe("primary-agent state, controls, and prompt injection", () => {
	test("reconstructs legacy state and writes new pi-gremlins entry without raw markdown", async () => {
		const { createPrimaryAgentDiscoveryCache } = await import("./gremlin-discovery.ts");
		const { createPiGremlinsExtension } = await import("./index.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		writePrimaryFile(workspace.userAgentsDir, "wall.md", "---\nname: Wall\nagent_type: primary\n---\nsecret raw markdown");
		const discovery = createPrimaryAgentDiscoveryCache({ userAgentsDir: workspace.userAgentsDir });
		const pi = createMockPi();
		createPiGremlinsExtension({ primaryAgentDiscoveryCache: discovery })(pi);
		const ctx = createMockContext(workspace, [
			{ type: "custom", customType: "pi-mohawk-primary-agent", data: { selectedName: "Wall", source: "user", filePath: "old" } },
		]);

		await pi.handler("session_start")({ type: "session_start", reason: "startup" }, ctx);
		await pi.commands.get("gremlins:primary").handler("none", ctx);

		expect(ctx.ui.statuses.at(-1)).toEqual({ key: "pi-gremlins-primary", text: "Primary: None" });
		expect(pi.entries).toEqual([{ customType: "pi-gremlins-primary-agent", data: { selectedName: null } }]);
		expect(JSON.stringify(pi.entries)).not.toContain("secret raw markdown");
	});

	test("command, no-ui listing, shortcut, and prompt injection use selected primary", async () => {
		const { createPrimaryAgentDiscoveryCache } = await import("./gremlin-discovery.ts");
		const { createPiGremlinsExtension } = await import("./index.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		writePrimaryFile(workspace.userAgentsDir, "alpha.md", "---\nname: Alpha\nagent_type: primary\n---\nalpha prompt");
		writePrimaryFile(workspace.userAgentsDir, "beta.md", "---\nname: Beta\nagent_type: primary\n---\nbeta prompt");
		const discovery = createPrimaryAgentDiscoveryCache({ userAgentsDir: workspace.userAgentsDir });
		const pi = createMockPi();
		createPiGremlinsExtension({ primaryAgentDiscoveryCache: discovery })(pi);
		const ctx = createMockContext(workspace);

		await pi.handler("session_start")({ type: "session_start", reason: "startup" }, ctx);
		await pi.commands.get("gremlins:primary").handler("", ctx);
		expect(pi.messages.at(-1).content).toBe("Primary agents: None, Alpha, Beta");

		await pi.commands.get("gremlins:primary").handler("beta", ctx);
		expect(ctx.ui.statuses.at(-1)).toEqual({ key: "pi-gremlins-primary", text: "Primary: Beta" });
		const injected = await pi.handler("before_agent_start")({ type: "before_agent_start", systemPrompt: "system", prompt: "go", systemPromptOptions: {} }, ctx);
		expect(injected.systemPrompt).toContain("<!-- pi-gremlins primary agent:start -->");
		expect(injected.systemPrompt).toContain("# pi-gremlins primary agent: Beta");
		expect(injected.systemPrompt).toContain("beta prompt");

		await pi.shortcuts.get("ctrl+shift+m").handler(ctx);
		expect(ctx.ui.statuses.at(-1)).toEqual({ key: "pi-gremlins-primary", text: "Primary: None" });
	});

	test("selection persists to project settings and restores in a new session without raw markdown", async () => {
		const { createPrimaryAgentDiscoveryCache } = await import("./gremlin-discovery.ts");
		const { createPiGremlinsExtension } = await import("./index.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		writePrimaryFile(workspace.projectAgentsDir, "alpha.md", "---\nname: Alpha\nagent_type: primary\n---\nalpha prompt");
		const discovery = createPrimaryAgentDiscoveryCache({ userAgentsDir: workspace.userAgentsDir });

		const firstPi = createMockPi();
		createPiGremlinsExtension({ primaryAgentDiscoveryCache: discovery })(firstPi);
		const firstCtx = createMockContext(workspace);
		await firstPi.handler("session_start")({ type: "session_start", reason: "startup" }, firstCtx);
		await firstPi.commands.get("gremlins:primary").handler("Alpha", firstCtx);

		const settingsPath = path.join(workspace.repoRoot, ".pi", "settings.json");
		const settingsContent = fs.readFileSync(settingsPath, "utf-8");
		expect(settingsContent).toContain('"selectedName": "Alpha"');
		expect(settingsContent).toContain('"source": "project"');
		expect(settingsContent).not.toContain("alpha prompt");

		const secondPi = createMockPi();
		createPiGremlinsExtension({ primaryAgentDiscoveryCache: discovery })(secondPi);
		const secondCtx = createMockContext(workspace);
		await secondPi.handler("session_start")({ type: "session_start", reason: "startup" }, secondCtx);
		expect(secondCtx.ui.statuses.at(-1)).toEqual({ key: "pi-gremlins-primary", text: "Primary: Alpha" });
		const injected = await secondPi.handler("before_agent_start")({ type: "before_agent_start", systemPrompt: "system", prompt: "go", systemPromptOptions: {} }, secondCtx);
		expect(injected.systemPrompt).toContain("alpha prompt");
	});

	test("corrupt project settings does not crash startup and reports warning", async () => {
		const { createPrimaryAgentDiscoveryCache } = await import("./gremlin-discovery.ts");
		const { createPiGremlinsExtension } = await import("./index.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		fs.mkdirSync(path.join(workspace.repoRoot, ".pi"), { recursive: true });
		fs.writeFileSync(path.join(workspace.repoRoot, ".pi", "settings.json"), "{not json", "utf-8");
		const discovery = createPrimaryAgentDiscoveryCache({ userAgentsDir: workspace.userAgentsDir });
		const pi = createMockPi();
		createPiGremlinsExtension({ primaryAgentDiscoveryCache: discovery })(pi);
		const ctx = createMockContext(workspace);

		await pi.handler("session_start")({ type: "session_start", reason: "startup" }, ctx);

		expect(ctx.ui.statuses.at(-1)).toEqual({ key: "pi-gremlins-primary", text: "Primary: None" });
		expect(ctx.ui.notifications.at(-1)).toMatchObject({ type: "warning" });
		expect(ctx.ui.notifications.at(-1).message).toContain("Could not read primary-agent settings");
	});

	test("selection replaces corrupt project settings with valid persisted primary", async () => {
		const { createPrimaryAgentDiscoveryCache } = await import("./gremlin-discovery.ts");
		const { createPiGremlinsExtension } = await import("./index.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		writePrimaryFile(workspace.projectAgentsDir, "alpha.md", "---\nname: Alpha\nagent_type: primary\n---\nalpha prompt");
		const settingsPath = path.join(workspace.repoRoot, ".pi", "settings.json");
		fs.writeFileSync(settingsPath, "{not json", "utf-8");
		const discovery = createPrimaryAgentDiscoveryCache({ userAgentsDir: workspace.userAgentsDir });
		const pi = createMockPi();
		createPiGremlinsExtension({ primaryAgentDiscoveryCache: discovery })(pi);
		const ctx = createMockContext(workspace);

		await pi.handler("session_start")({ type: "session_start", reason: "startup" }, ctx);
		await pi.commands.get("gremlins:primary").handler("Alpha", ctx);

		const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
		expect(settings["pi-gremlins"].primaryAgent).toMatchObject({ selectedName: "Alpha", source: "project" });
	});

	test("cleared and missing persisted primary-agent selections reset to None", async () => {
		const { createPrimaryAgentDiscoveryCache } = await import("./gremlin-discovery.ts");
		const { createPiGremlinsExtension } = await import("./index.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		writePrimaryFile(workspace.projectAgentsDir, "alpha.md", "---\nname: Alpha\nagent_type: primary\n---\nalpha prompt");
		const discovery = createPrimaryAgentDiscoveryCache({ userAgentsDir: workspace.userAgentsDir });
		const settingsPath = path.join(workspace.repoRoot, ".pi", "settings.json");

		const firstPi = createMockPi();
		createPiGremlinsExtension({ primaryAgentDiscoveryCache: discovery })(firstPi);
		const firstCtx = createMockContext(workspace);
		await firstPi.handler("session_start")({ type: "session_start", reason: "startup" }, firstCtx);
		await firstPi.commands.get("gremlins:primary").handler("Alpha", firstCtx);
		await firstPi.commands.get("gremlins:primary").handler("none", firstCtx);
		expect(fs.readFileSync(settingsPath, "utf-8")).toContain('"selectedName": null');

		const clearedPi = createMockPi();
		createPiGremlinsExtension({ primaryAgentDiscoveryCache: discovery })(clearedPi);
		const clearedCtx = createMockContext(workspace);
		await clearedPi.handler("session_start")({ type: "session_start", reason: "startup" }, clearedCtx);
		expect(clearedCtx.ui.statuses.at(-1)).toEqual({ key: "pi-gremlins-primary", text: "Primary: None" });

		fs.writeFileSync(settingsPath, JSON.stringify({ "pi-gremlins": { primaryAgent: { selectedName: "Missing", source: "project", filePath: path.join(workspace.projectAgentsDir, "missing.md") } } }, null, 2), "utf-8");
		const missingPi = createMockPi();
		createPiGremlinsExtension({ primaryAgentDiscoveryCache: discovery })(missingPi);
		const missingCtx = createMockContext(workspace);
		await missingPi.handler("session_start")({ type: "session_start", reason: "startup" }, missingCtx);
		expect(missingCtx.ui.statuses.at(-1)).toEqual({ key: "pi-gremlins-primary", text: "Primary: None" });
		expect(missingCtx.ui.notifications.at(-1)).toEqual({ message: "Primary agent unavailable, reset to None: Missing", type: "warning" });
		expect(fs.readFileSync(settingsPath, "utf-8")).toContain('"selectedName": null');
		const injected = await missingPi.handler("before_agent_start")({ type: "before_agent_start", systemPrompt: "system", prompt: "go", systemPromptOptions: {} }, missingCtx);
		expect(injected).toBeUndefined();
	});

	test("prompt injection strips existing pi-gremlins and legacy pi-mohawk blocks", async () => {
		const { appendPrimaryAgentPromptBlock } = await import("./primary-agent-prompt.ts");
		const agent = { name: "Wall", rawMarkdown: "---\nname: Wall\nagent_type: primary\n---\nwall prompt" };
		const prompt = [
			"system",
			"<!-- pi-mohawk primary agent:start -->old<!-- pi-mohawk primary agent:end -->",
			"<!-- pi-gremlins primary agent:start -->old<!-- pi-gremlins primary agent:end -->",
		].join("\n");
		const result = appendPrimaryAgentPromptBlock(prompt, agent);

		expect(result).not.toContain("pi-mohawk primary agent:start");
		expect(result.match(/pi-gremlins primary agent:start/g)).toHaveLength(1);
		expect(result).toContain("wall prompt");
	});
});
