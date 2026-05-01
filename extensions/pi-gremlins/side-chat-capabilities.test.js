import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "bun:test";
import "./v1-contract-harness.js";
import { createWorkspace } from "./test-helpers.js";

function writeSettings(repoRoot, sideChat) {
	const piDir = path.join(repoRoot, ".pi");
	fs.mkdirSync(piDir, { recursive: true });
	fs.writeFileSync(
		path.join(piDir, "settings.json"),
		`${JSON.stringify({ "pi-gremlins": { sideChat } }, null, 2)}\n`,
		"utf-8",
	);
}

function writeSkill(repoRoot, skillName = "example-skill", description = "Example skill") {
	const skillDir = path.join(repoRoot, ".pi", "skills", skillName);
	fs.mkdirSync(skillDir, { recursive: true });
	const filePath = path.join(skillDir, "SKILL.md");
	fs.writeFileSync(
		filePath,
		`---\nname: ${skillName}\ndescription: ${description}\n---\nUse this skill.\n`,
		"utf-8",
	);
	return filePath;
}

describe("side-chat capability resolver", () => {
	test("missing config resolves disabled with explicit empty arrays", async () => {
		const { readSideChatCapabilities } = await import("./side-chat-capabilities.ts");
		const { repoRoot } = createWorkspace();
		const resolved = readSideChatCapabilities(repoRoot, "chat");
		expect(resolved.tools).toEqual([]);
		expect(resolved.skillPaths).toEqual([]);
		expect(resolved.skills).toEqual([]);
	});

	test("chat and tangent profiles are independent", async () => {
		const { readSideChatCapabilities } = await import("./side-chat-capabilities.ts");
		const { repoRoot } = createWorkspace();
		writeSettings(repoRoot, { chat: { tools: ["read", "grep"] } });
		expect(readSideChatCapabilities(repoRoot, "chat").tools).toEqual(["read", "grep"]);
		expect(readSideChatCapabilities(repoRoot, "tangent").tools).toEqual([]);
	});

	test("only read-only allowlisted tools are accepted", async () => {
		const { readSideChatCapabilities, SideChatCapabilityError } = await import("./side-chat-capabilities.ts");
		const { repoRoot } = createWorkspace();
		for (const tool of ["bash", "edit", "write", "unknown"]) {
			writeSettings(repoRoot, { chat: { tools: [tool] } });
			expect(() => readSideChatCapabilities(repoRoot, "chat")).toThrow(SideChatCapabilityError);
		}
		writeSettings(repoRoot, { chat: { tools: ["read", "grep", "find", "ls"] } });
		expect(readSideChatCapabilities(repoRoot, "chat").tools).toEqual(["read", "grep", "find", "ls"]);
	});

	test("non-array tools or non-string tool entries fail closed", async () => {
		const { readSideChatCapabilities, SideChatCapabilityError } = await import("./side-chat-capabilities.ts");
		const { repoRoot } = createWorkspace();
		writeSettings(repoRoot, { chat: { tools: "read" } });
		expect(() => readSideChatCapabilities(repoRoot, "chat")).toThrow(SideChatCapabilityError);
		writeSettings(repoRoot, { chat: { tools: ["read", 7] } });
		expect(() => readSideChatCapabilities(repoRoot, "chat")).toThrow(SideChatCapabilityError);
	});

	test("skill paths require read and are loaded from project .pi/skills markdown", async () => {
		const { readSideChatCapabilities } = await import("./side-chat-capabilities.ts");
		const { repoRoot } = createWorkspace();
		writeSkill(repoRoot);
		writeSettings(repoRoot, {
			chat: { tools: ["read"], skillPaths: [".pi/skills/example-skill/SKILL.md"] },
		});
		const resolved = readSideChatCapabilities(path.join(repoRoot, "subdir"), "chat");
		expect(resolved.skillPaths).toEqual([
			fs.realpathSync(path.join(repoRoot, ".pi", "skills", "example-skill", "SKILL.md")),
		]);
		expect(resolved.skills.map((skill) => skill.name)).toEqual(["example-skill"]);
	});

	test("skill paths without read fail closed", async () => {
		const { readSideChatCapabilities, SideChatCapabilityError } = await import("./side-chat-capabilities.ts");
		const { repoRoot } = createWorkspace();
		writeSkill(repoRoot);
		writeSettings(repoRoot, { chat: { tools: ["grep"], skillPaths: [".pi/skills/example-skill/SKILL.md"] } });
		expect(() => readSideChatCapabilities(repoRoot, "chat")).toThrow(SideChatCapabilityError);
	});

	test("unsafe, absolute, parent traversal, missing, and non-markdown skill paths fail closed", async () => {
		const { readSideChatCapabilities, SideChatCapabilityError } = await import("./side-chat-capabilities.ts");
		const { repoRoot } = createWorkspace();
		fs.mkdirSync(path.join(repoRoot, ".pi", "skills"), { recursive: true });
		fs.writeFileSync(path.join(repoRoot, ".pi", "skills", "not-md.txt"), "x", "utf-8");
		for (const skillPath of [
			"/tmp/SKILL.md",
			".pi/skills/../escape/SKILL.md",
			"skills/example/SKILL.md",
			".pi/skills/missing/SKILL.md",
			".pi/skills/not-md.txt",
		]) {
			writeSettings(repoRoot, { chat: { tools: ["read"], skillPaths: [skillPath] } });
			expect(() => readSideChatCapabilities(repoRoot, "chat")).toThrow(SideChatCapabilityError);
		}
	});

	test("loadSkills diagnostics for configured paths are fatal", async () => {
		const { readSideChatCapabilities, SideChatCapabilityError } = await import("./side-chat-capabilities.ts");
		const { repoRoot } = createWorkspace();
		const skillDir = path.join(repoRoot, ".pi", "skills", "bad-skill");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: wrong-name\n---\nbody\n", "utf-8");
		writeSettings(repoRoot, { chat: { tools: ["read"], skillPaths: [".pi/skills/bad-skill/SKILL.md"] } });
		expect(() => readSideChatCapabilities(repoRoot, "chat")).toThrow(SideChatCapabilityError);
	});
});
