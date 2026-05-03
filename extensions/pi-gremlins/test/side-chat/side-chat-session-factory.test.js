import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "bun:test";
import "../fixtures/v1-contract-harness.js";
import { getResourceLoaderInstances, resetV1ContractHarness, setCreateAgentSessionImpl } from "../fixtures/v1-contract-harness.js";
import { createWorkspace } from "../helpers/test-helpers.js";

const PARENT_PRIMARY_BLOCK_START = "<!-- pi-gremlins primary agent:start -->";
const FRESH_SKILL_SENTINEL = "ISSUE_59_FRESH_CHILD_SKILL_GUIDANCE";
const PARENT_SKILL_SENTINEL = "ISSUE_59_PARENT_SKILL_SHOULD_NOT_LEAK";
const LEGACY_SIDE_CHAT_SKILL_SENTINEL = "ISSUE_59_LEGACY_SIDE_CHAT_SKILL_PATH_SHOULD_NOT_LEAK";
const DIAGNOSTIC_SENTINEL = "ISSUE_59_SKILL_DIAGNOSTIC_SENTINEL";
const ISSUE_59_FIXTURE_ROOT = path.resolve("extensions/pi-gremlins/test-fixtures/issue-59-skills");

function makeSnapshot(entries, capturedAt = "2026-04-29T00:00:00.000Z") {
	return { entries, capturedAt };
}

function copySkillFixture(targetSkillsDir, fixtureName) {
	const sourceDir = path.join(ISSUE_59_FIXTURE_ROOT, fixtureName);
	const targetDir = path.join(targetSkillsDir, fixtureName);
	fs.mkdirSync(targetDir, { recursive: true });
	fs.copyFileSync(path.join(sourceDir, "SKILL.md"), path.join(targetDir, "SKILL.md"));
	return path.join(targetDir, "SKILL.md");
}

function createIssue59SkillWorkspace({ includeDiagnostic = false } = {}) {
	const { repoRoot, userRoot } = createWorkspace();
	const projectSkillsDir = path.join(repoRoot, ".pi", "skills");
	const userSkillsDir = path.join(userRoot, "skills");
	copySkillFixture(projectSkillsDir, "fresh-child-skill");
	if (includeDiagnostic) copySkillFixture(projectSkillsDir, "diagnostic-missing-description");
	fs.mkdirSync(path.join(userSkillsDir, "parent-skill"), { recursive: true });
	fs.writeFileSync(
		path.join(userSkillsDir, "parent-skill", "SKILL.md"),
		`---\nname: parent-skill\ndescription: ${PARENT_SKILL_SENTINEL}\n---\n\n${PARENT_SKILL_SENTINEL}`,
	);
	return { repoRoot, userRoot, projectSkillsDir };
}

function collectRuntimeSurface(options) {
	return [
		options.resourceLoader.getSystemPrompt(),
		JSON.stringify(options.resourceLoader.getSkills()),
	].join("\n---\n");
}

function fakeToolExtension(name = "side_custom_tool") {
	return () => ({
		path: "fake-extension",
		resolvedPath: "fake-extension",
		sourceInfo: { type: "extension", path: "fake-extension" },
		handlers: new Map(),
		tools: new Map([[name, { name, description: "fake", parameters: {} }]]),
		messageRenderers: new Map(),
		commands: new Map([["hidden-command", {}]]),
		flags: new Map(),
		shortcuts: new Map(),
	});
}

describe("side-chat session factory PRD-0008/ADR-0008 contract", () => {
	test("chat and tangent omit explicit tools so SDK defaults apply", async () => {
		const { buildSideChatSessionConfig } = await import("../../side-chat/side-chat-session-factory.ts");
		const chat = buildSideChatSessionConfig({ mode: "chat", userPrompt: "hello" });
		const tangent = buildSideChatSessionConfig({ mode: "tangent", userPrompt: "hello" });
		expect(Object.hasOwn(chat, "tools")).toBe(false);
		expect(chat.tools).toBeUndefined();
		expect(Object.hasOwn(tangent, "tools")).toBe(false);
		expect(tangent.tools).toBeUndefined();
	});

	test("resources remain empty while resource loader strips non-tool non-skill surfaces", async () => {
		const { buildSideChatSessionConfig } = await import("../../side-chat/side-chat-session-factory.ts");
		const config = buildSideChatSessionConfig({ mode: "chat", userPrompt: "hello" });
		expect(config.resources).toEqual({ agents: [], extensions: [], prompts: [], skills: [], themes: [] });
		expect(config.resourceLoader.getPrompts().prompts).toEqual([]);
		expect(config.resourceLoader.getThemes().themes).toEqual([]);
		expect(config.resourceLoader.getAgentsFiles().agentsFiles).toEqual([]);
		expect(config.resourceLoader.getAppendSystemPrompt()).toEqual([]);
		expect(config.resourceLoader.getSystemPrompt()).toBe(config.systemPrompt);
	});

	test("fresh child skills and diagnostics survive through the side-chat loader without direct resource leakage", async () => {
		resetV1ContractHarness();
		const { buildSideChatSessionConfig, createSideChatSession } = await import("../../side-chat/side-chat-session-factory.ts");
		const { repoRoot } = createIssue59SkillWorkspace({ includeDiagnostic: true });
		const config = buildSideChatSessionConfig({
			mode: "chat",
			userPrompt: "check fresh child skills",
			cwd: repoRoot,
			agentDir: path.join(repoRoot, "isolated-agent-dir"),
		});
		const skillsResult = config.resourceLoader.getSkills();
		expect(skillsResult.skills.map((skill) => skill.name)).toContain("fresh-child-skill");
		expect(JSON.stringify(skillsResult)).toContain(FRESH_SKILL_SENTINEL);
		expect(JSON.stringify(skillsResult.diagnostics)).toContain("description is required");
		expect(JSON.stringify(skillsResult.diagnostics)).toContain("diagnostic-missing-description/SKILL.md");
		expect(JSON.stringify(skillsResult.diagnostics)).not.toContain(DIAGNOSTIC_SENTINEL);
		expect(JSON.stringify(config.resources)).not.toContain(FRESH_SKILL_SENTINEL);
		expect(JSON.stringify(config.resources)).not.toContain(PARENT_SKILL_SENTINEL);

		expect(config.prompt).not.toContain(PARENT_SKILL_SENTINEL);
		expect(config.prompt).not.toContain(LEGACY_SIDE_CHAT_SKILL_SENTINEL);
		expect(config.systemPrompt).not.toContain(PARENT_SKILL_SENTINEL);
		expect(config.systemPrompt).not.toContain(LEGACY_SIDE_CHAT_SKILL_SENTINEL);
		const calls = [];
		setCreateAgentSessionImpl(async (options) => {
			calls.push(options);
			const runtimeSurface = collectRuntimeSurface(options);
			expect(runtimeSurface).toContain(FRESH_SKILL_SENTINEL);
			expect(options.tools).toBeUndefined();
			expect(options.resourceLoader.getSystemPrompt()).toBe(config.systemPrompt);
			expect(options.resourceLoader.getSystemPrompt()).not.toContain(PARENT_SKILL_SENTINEL);
			expect(options.resourceLoader.getSystemPrompt()).not.toContain(LEGACY_SIDE_CHAT_SKILL_SENTINEL);
			expect(options.resourceLoader.getSkills().diagnostics.length).toBeGreaterThan(0);
			return { session: { subscribe: () => () => {}, async prompt() {}, dispose() {} }, extensionsResult: {} };
		});
		await createSideChatSession({ sessionConfig: config, mode: "chat", userPrompt: "ignored" });
		expect(calls.length).toBe(1);
	});

	test("system prompts describe SDK defaults and extension tools without parent leakage", async () => {
		const { buildSideChatSessionConfig, SIDE_CHAT_SYSTEM_PROMPT_CHAT, SIDE_CHAT_SYSTEM_PROMPT_TANGENT } = await import("../../side-chat/side-chat-session-factory.ts");
		const sentinel = "PARENT_SENTINEL_BANNED_DO_NOT_LEAK";
		const chat = buildSideChatSessionConfig({
			mode: "chat",
			userPrompt: "hi",
			parentSnapshot: makeSnapshot([
				{ role: "user", text: sentinel },
				{ role: "assistant", text: PARENT_PRIMARY_BLOCK_START },
			]),
		});
		const tangent = buildSideChatSessionConfig({
			mode: "tangent",
			userPrompt: "hi",
			parentSnapshot: makeSnapshot([{ role: "user", text: sentinel }]),
		});
		expect(chat.systemPrompt).toBe(SIDE_CHAT_SYSTEM_PROMPT_CHAT);
		expect(tangent.systemPrompt).toBe(SIDE_CHAT_SYSTEM_PROMPT_TANGENT);
		for (const prompt of [chat.systemPrompt, tangent.systemPrompt]) {
			expect(prompt).toContain("SDK default built-in tools may be available");
			expect(prompt).toContain("read");
			expect(prompt).toContain("bash/shell");
			expect(prompt).toContain("edit");
			expect(prompt).toContain("write");
			expect(prompt).toContain("Enabled extension custom tools may also be available");
			expect(prompt).toContain("Fresh child-session skills and skill guidance may also be available");
			expect(prompt).toContain("parent-loaded skills are not inherited");
			expect(prompt).not.toContain("NO tools");
			expect(prompt).not.toContain("conversational-only");
			expect(prompt).not.toContain("approved read-only");
			expect(prompt).not.toContain(sentinel);
			expect(prompt).not.toContain(PARENT_PRIMARY_BLOCK_START);
		}
	});

	test("chat embeds only origin transcript snapshot in user prompt; tangent omits supplied snapshots", async () => {
		const { buildSideChatSessionConfig } = await import("../../side-chat/side-chat-session-factory.ts");
		const chat = buildSideChatSessionConfig({
			mode: "chat",
			userPrompt: "summarize",
			parentSnapshot: makeSnapshot([
				{ role: "user", text: "X1_USER_TURN" },
				{ role: "assistant", text: "X2_ASSISTANT_TURN" },
			]),
		});
		const tangent = buildSideChatSessionConfig({
			mode: "tangent",
			userPrompt: "what about this?",
			parentSnapshot: makeSnapshot([{ role: "user", text: "TANGENT_LEAK_SENTINEL" }]),
		});
		expect(chat.prompt).toContain("parent-transcript-snapshot");
		expect(chat.prompt).toContain("X1_USER_TURN");
		expect(chat.prompt).toContain("X2_ASSISTANT_TURN");
		expect(chat.systemPrompt).not.toContain("X1_USER_TURN");
		expect(tangent.prompt).not.toContain("parent-transcript-snapshot");
		expect(tangent.prompt).not.toContain("TANGENT_LEAK_SENTINEL");
		expect(tangent.prompt).toContain("what about this?");
	});

	test("empty snapshot, model, and thinking behavior are preserved", async () => {
		const { buildSideChatSessionConfig } = await import("../../side-chat/side-chat-session-factory.ts");
		const empty = buildSideChatSessionConfig({ mode: "chat", userPrompt: "first", parentSnapshot: makeSnapshot([]) });
		expect(empty.prompt).toContain("first");
		expect(empty.prompt).not.toContain("parent-transcript-snapshot");
		const inherited = buildSideChatSessionConfig({ mode: "chat", userPrompt: "hi", parentModel: "openai/gpt-5", parentThinking: "medium" });
		expect(inherited.model).toBe("openai/gpt-5");
		expect(inherited.thinking).toBe("medium");
	});

	test("createSideChatSession reloads fresh loader before createAgentSession and preserves extension tool records", async () => {
		resetV1ContractHarness();
		const { createSideChatSession } = await import("../../side-chat/side-chat-session-factory.ts");
		const calls = [];
		setCreateAgentSessionImpl(async (options) => {
			calls.push(options);
			const extensionResult = options.resourceLoader.getExtensions();
			expect(extensionResult.extensions.length).toBe(1);
			expect(extensionResult.extensions[0].tools.has("side_custom_tool")).toBe(true);
			expect(options.tools).toBeUndefined();
			return { session: { subscribe: () => () => {}, async prompt() {}, dispose() {} }, extensionsResult: extensionResult };
		});
		const created = await createSideChatSession({
			mode: "chat",
			userPrompt: "use extension tool",
			extensionFactories: [fakeToolExtension()],
		});
		expect(calls.length).toBe(1);
		expect(created.extensionsResult.extensions.length).toBe(1);
		const [loader] = getResourceLoaderInstances();
		expect(loader.reloadCount).toBe(1);
	});
});
