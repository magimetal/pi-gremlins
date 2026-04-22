import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";

import { createWorkspace, writeAgentFile } from "./test-helpers.js";

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
			"---\nname: shared\ndescription: project shared gremlin\n---\nproject prompt body",
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
			"---\nname: reviewer\ndescription: project reviewer\n---\nReview prompt body",
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
