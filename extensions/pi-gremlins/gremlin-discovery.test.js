import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";

import { createWorkspace, writeAgentFile } from "./test-helpers.js";

function createCountingFileSystem() {
	const calls = { readdir: 0, stat: 0 };
	return {
		calls,
		fileSystem: {
			async readdir(dir) {
				calls.readdir++;
				return fs.promises.readdir(dir, { withFileTypes: true });
			},
			async stat(candidatePath) {
				calls.stat++;
				return fs.promises.stat(candidatePath);
			},
		},
	};
}

let workspaceRoot = null;

afterEach(() => {
	if (workspaceRoot) {
		fs.rmSync(workspaceRoot, { recursive: true, force: true });
		workspaceRoot = null;
	}
});

describe("gremlin discovery v1 contract", () => {
	test("loads only user and nearest project gremlins and lets project override same-name user gremlin", async () => {
		const { createGremlinDiscoveryCache } = await import("./gremlin-discovery.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;

		writeAgentFile(
			workspace.userAgentsDir,
			"shared.md",
			"shared",
			"user shared gremlin",
		);
		fs.mkdirSync(workspace.projectAgentsDir, { recursive: true });
		fs.writeFileSync(
			`${workspace.projectAgentsDir}/shared.md`,
			"---\nname: shared\ndescription: project shared gremlin\nagent_type: sub-agent\n---\nproject prompt body",
			"utf-8",
		);
		writeAgentFile(
			workspace.userAgentsDir,
			"user-only.md",
			"user-only",
			"user only gremlin",
		);

		const discovery = createGremlinDiscoveryCache({
			userAgentsDir: workspace.userAgentsDir,
		});
		const result = await discovery.get(workspace.repoRoot);

		expect(result.projectAgentsDir).toBe(workspace.projectAgentsDir);
		expect(
			result.gremlins.map((gremlin) => ({
				name: gremlin.name,
				source: gremlin.source,
			})),
		).toEqual([
			{ name: "shared", source: "project" },
			{ name: "user-only", source: "user" },
		]);
		expect(result.gremlins.find((gremlin) => gremlin.name === "shared"))
			.toMatchObject({
				source: "project",
				rawMarkdown: expect.stringContaining("project prompt body"),
			});
	});

	test("skips agent files without sub-agent frontmatter marker", async () => {
		const { createGremlinDiscoveryCache } = await import("./gremlin-discovery.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		fs.mkdirSync(workspace.projectAgentsDir, { recursive: true });
		fs.writeFileSync(
			`${workspace.projectAgentsDir}/untyped.md`,
			"---\nname: untyped\ndescription: untyped agent\n---\nUntyped prompt body",
			"utf-8",
		);
		fs.writeFileSync(
			`${workspace.projectAgentsDir}/primary.md`,
			"---\nname: primary\ndescription: primary agent\nagent_type: primary\n---\nPrimary prompt body",
			"utf-8",
		);
		fs.writeFileSync(
			`${workspace.projectAgentsDir}/sub-agent.md`,
			"---\nname: sub-agent\ndescription: sub agent\nagent_type: sub-agent\n---\nSub-agent prompt body",
			"utf-8",
		);

		const discovery = createGremlinDiscoveryCache({
			userAgentsDir: workspace.userAgentsDir,
		});
		const result = await discovery.get(workspace.repoRoot);

		expect(result.gremlins.map((gremlin) => gremlin.name)).toEqual([
			"sub-agent",
		]);
	});

	test("does not let untyped project file override typed user sub-agent", async () => {
		const { createGremlinDiscoveryCache } = await import("./gremlin-discovery.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		writeAgentFile(
			workspace.userAgentsDir,
			"shared.md",
			"shared",
			"user shared gremlin",
		);
		fs.mkdirSync(workspace.projectAgentsDir, { recursive: true });
		fs.writeFileSync(
			`${workspace.projectAgentsDir}/shared.md`,
			"---\nname: shared\ndescription: untyped project shared\n---\nproject prompt body",
			"utf-8",
		);

		const discovery = createGremlinDiscoveryCache({
			userAgentsDir: workspace.userAgentsDir,
		});
		const result = await discovery.get(workspace.repoRoot);

		expect(result.gremlins).toEqual([
			expect.objectContaining({ name: "shared", source: "user" }),
		]);
		expect(result.gremlins[0].rawMarkdown).toContain("system prompt");
	});

	test("parses frontmatter metadata and invalidates cache when file set changes", async () => {
		const { createGremlinDiscoveryCache } = await import("./gremlin-discovery.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		fs.mkdirSync(workspace.projectAgentsDir, { recursive: true });
		fs.writeFileSync(
			`${workspace.projectAgentsDir}/researcher.md`,
			[
				"---",
				"name: researcher",
				"description: project researcher",
				"agent_type: sub-agent",
				"model: openai/gpt-5-mini",
				"thinking: high",
				"tools:",
				"  - read",
				"  - grep",
				"---",
				"Research prompt body",
			].join("\n"),
			"utf-8",
		);

		const discovery = createGremlinDiscoveryCache({
			userAgentsDir: workspace.userAgentsDir,
		});
		const first = await discovery.get(workspace.repoRoot);
		const firstGremlin = first.gremlins[0];

		expect(firstGremlin.frontmatter).toMatchObject({
			model: "openai/gpt-5-mini",
			thinking: "high",
			tools: ["read", "grep"],
		});
		expect(firstGremlin.rawMarkdown).toContain("Research prompt body");

		fs.writeFileSync(
			`${workspace.projectAgentsDir}/reviewer.md`,
			"---\nname: reviewer\ndescription: project reviewer\nagent_type: sub-agent\n---\nReview prompt body",
			"utf-8",
		);
		const second = await discovery.get(workspace.repoRoot);

		expect(second).not.toBe(first);
		expect(second.fingerprint).not.toBe(first.fingerprint);
		expect(second.gremlins.map((gremlin) => gremlin.name)).toEqual([
			"researcher",
			"reviewer",
		]);
	});

	test("reuses cached directory listings while detecting markdown file updates", async () => {
		const { createGremlinDiscoveryCache } = await import("./gremlin-discovery.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		fs.mkdirSync(workspace.projectAgentsDir, { recursive: true });
		const researcherPath = `${workspace.projectAgentsDir}/researcher.md`;
		fs.writeFileSync(
			researcherPath,
			"---\nname: researcher\ndescription: first\nagent_type: sub-agent\n---\nfirst prompt body",
			"utf-8",
		);
		const { calls, fileSystem } = createCountingFileSystem();
		const discovery = createGremlinDiscoveryCache({
			userAgentsDir: workspace.userAgentsDir,
			fileSystem,
		});

		const first = await discovery.get(workspace.repoRoot);
		const readdirAfterFirst = calls.readdir;
		const second = await discovery.get(workspace.repoRoot);

		expect(second).toBe(first);
		expect(calls.readdir).toBe(readdirAfterFirst);

		fs.writeFileSync(
			researcherPath,
			"---\nname: researcher\ndescription: second\nagent_type: sub-agent\n---\nsecond prompt body",
			"utf-8",
		);
		fs.utimesSync(researcherPath, new Date(), new Date(Date.now() + 1000));
		const third = await discovery.get(workspace.repoRoot);

		expect(third).not.toBe(first);
		expect(third.fingerprint).not.toBe(first.fingerprint);
		expect(third.gremlins[0].rawMarkdown).toContain("second prompt body");
	});

	test("detects same-size same-mtime markdown content changes", async () => {
		const { createGremlinDiscoveryCache } = await import("./gremlin-discovery.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		fs.mkdirSync(workspace.projectAgentsDir, { recursive: true });
		const agentPath = `${workspace.projectAgentsDir}/researcher.md`;
		const firstContent = "---\nname: researcher\ndescription: first1\nagent_type: sub-agent\n---\nprompt one";
		const secondContent = "---\nname: researcher\ndescription: second\nagent_type: sub-agent\n---\nprompt two";
		expect(secondContent.length).toBe(firstContent.length);
		fs.writeFileSync(agentPath, firstContent, "utf-8");
		const originalMtime = new Date("2024-01-01T00:00:00.000Z");
		fs.utimesSync(agentPath, originalMtime, originalMtime);
		const discovery = createGremlinDiscoveryCache({ userAgentsDir: workspace.userAgentsDir });

		const first = await discovery.get(workspace.repoRoot);
		fs.writeFileSync(agentPath, secondContent, "utf-8");
		fs.utimesSync(agentPath, originalMtime, originalMtime);
		const second = await discovery.get(workspace.repoRoot);

		expect(second).not.toBe(first);
		expect(second.fingerprint).not.toBe(first.fingerprint);
		expect(second.gremlins[0].rawMarkdown).toContain("prompt two");
		expect(second.gremlins[0].rawMarkdown).not.toContain("prompt one");
	});

	test("skips unreadable markdown files without rejecting whole discovery", async () => {
		const { createGremlinDiscoveryCache } = await import("./gremlin-discovery.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		fs.mkdirSync(workspace.projectAgentsDir, { recursive: true });
		fs.writeFileSync(
			`${workspace.projectAgentsDir}/good.md`,
			"---\nname: good\ndescription: good gremlin\nagent_type: sub-agent\n---\nGood prompt body",
			"utf-8",
		);
		fs.symlinkSync(
			`${workspace.projectAgentsDir}/missing-target.md`,
			`${workspace.projectAgentsDir}/broken.md`,
		);

		const discovery = createGremlinDiscoveryCache({
			userAgentsDir: workspace.userAgentsDir,
		});
		const result = await discovery.get(workspace.repoRoot);

		expect(result.gremlins.map((gremlin) => gremlin.name)).toEqual(["good"]);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				filePath: `${workspace.projectAgentsDir}/broken.md`,
				message: expect.stringContaining("broken.md"),
			}),
		]);
	});

	test("parses CRLF frontmatter delimiters", async () => {
		const { createGremlinDiscoveryCache } = await import("./gremlin-discovery.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		fs.mkdirSync(workspace.projectAgentsDir, { recursive: true });
		fs.writeFileSync(
			`${workspace.projectAgentsDir}/crlf.md`,
			"---\r\nname: crlf\r\ndescription: CRLF gremlin\r\nagent_type: sub-agent\r\n---\r\nPrompt body",
			"utf-8",
		);

		const discovery = createGremlinDiscoveryCache({
			userAgentsDir: workspace.userAgentsDir,
		});
		const result = await discovery.get(workspace.repoRoot);

		expect(result.gremlins[0]).toMatchObject({
			name: "crlf",
			description: "CRLF gremlin",
		});
		expect(result.gremlins[0].frontmatter.body).toBe("Prompt body");
	});

	test("never loads package gremlins or any scope-toggle surface in v1 discovery", async () => {
		const { createGremlinDiscoveryCache } = await import("./gremlin-discovery.ts");
		const workspace = createWorkspace();
		workspaceRoot = workspace.root;
		writeAgentFile(
			workspace.userAgentsDir,
			"alpha.md",
			"alpha",
			"user alpha gremlin",
		);

		const discovery = createGremlinDiscoveryCache({
			userAgentsDir: workspace.userAgentsDir,
		});
		const result = await discovery.get(workspace.repoRoot);

		expect(result).not.toHaveProperty("packageGremlins");
		expect(result).not.toHaveProperty("agentScope");
		expect(result).not.toHaveProperty("confirmProjectAgents");
		expect(result.gremlins).toEqual([
			expect.objectContaining({ name: "alpha", source: "user" }),
		]);
	});
});
