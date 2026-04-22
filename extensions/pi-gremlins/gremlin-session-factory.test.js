import { describe, expect, test } from "bun:test";

describe("gremlin session factory v1 contract", () => {
	test("builds child session config from parent system prompt raw gremlin markdown and caller context only", async () => {
		const { buildGremlinPrompt } = await import("./gremlin-prompt.ts");
		const { buildGremlinSessionConfig } = await import(
			"./gremlin-session-factory.ts"
		);

		const parentSystemPrompt = "parent computed system prompt snapshot";
		const rawMarkdown = [
			"---",
			"name: researcher",
			"model: gpt-5-mini",
			"thinking: high",
			"tools: read, grep",
			"---",
			"You are focused research gremlin.",
		].join("\n");
		const context = "Find auth flow entry points";
		const prompt = buildGremlinPrompt({
			parentSystemPrompt,
			rawMarkdown,
			context,
		});
		const config = buildGremlinSessionConfig({
			parentSystemPrompt,
			parentModel: "gpt-5",
			parentThinking: "medium",
			gremlin: {
				name: "researcher",
				source: "project",
				rawMarkdown,
				frontmatter: {
					model: "gpt-5-mini",
					thinking: "high",
					tools: ["read", "grep"],
				},
			},
			context,
		});

		expect(prompt).toContain(parentSystemPrompt);
		expect(prompt).toContain(rawMarkdown);
		expect(prompt).toContain(context);
		expect(config).toMatchObject({
			systemPrompt: parentSystemPrompt,
			prompt,
			model: "gpt-5-mini",
			thinking: "high",
			tools: ["read", "grep"],
			resources: {
				agents: [],
				extensions: [],
				prompts: [],
				skills: [],
				themes: [],
			},
		});
	});

	test("creates empty isolated resource loader with no extensions prompts skills themes or AGENTS files", async () => {
		const { createIsolatedGremlinResourceLoader } = await import(
			"./gremlin-session-factory.ts"
		);

		const loader = createIsolatedGremlinResourceLoader("snapshot system prompt");
		expect(loader.getExtensions()).toMatchObject({
			extensions: [],
			errors: [],
		});
		expect(loader.getSkills()).toEqual({ skills: [], diagnostics: [] });
		expect(loader.getPrompts()).toEqual({ prompts: [], diagnostics: [] });
		expect(loader.getThemes()).toEqual({ themes: [], diagnostics: [] });
		expect(loader.getAgentsFiles()).toEqual({ agentsFiles: [] });
		expect(loader.getSystemPrompt()).toBe("snapshot system prompt");
		expect(loader.getAppendSystemPrompt()).toEqual([]);
	});

	test("resolves frontmatter model and thinking when present and falls back to parent when absent", async () => {
		const { resolveGremlinModel, resolveGremlinThinking } = await import(
			"./gremlin-session-factory.ts"
		);

		const fakeModelRegistry = {
			getAll: () => [
				{ provider: "openai", id: "gpt-5" },
				{ provider: "openai", id: "gpt-5-mini" },
			],
			find: (provider, modelId) =>
				provider === "openai" && modelId === "gpt-5-mini"
					? { provider, id: modelId }
					: undefined,
		};

		expect(
			resolveGremlinModel("openai/gpt-5-mini", "openai/gpt-5", fakeModelRegistry),
		).toMatchObject({
			label: "openai/gpt-5-mini",
			model: { provider: "openai", id: "gpt-5-mini" },
		});
		expect(resolveGremlinModel(undefined, "openai/gpt-5", fakeModelRegistry)).toEqual({
			label: "openai/gpt-5",
		});
		expect(resolveGremlinThinking("high", "medium")).toBe("high");
		expect(resolveGremlinThinking(undefined, "medium")).toBe("medium");
	});

	test("keeps v1 no-subprocess no-temp-file contract explicit in session config", async () => {
		const { buildGremlinSessionConfig } = await import(
			"./gremlin-session-factory.ts"
		);

		const config = buildGremlinSessionConfig({
			parentSystemPrompt: "snapshot",
			parentModel: "openai/gpt-5",
			parentThinking: "low",
			gremlin: {
				name: "reviewer",
				source: "user",
				rawMarkdown: "---\nname: reviewer\n---\nReview work",
				frontmatter: {},
			},
			context: "Review diff",
		});

		expect(config).toMatchObject({
			usesSubprocess: false,
			writesTempPromptFile: false,
			model: "openai/gpt-5",
			thinking: "low",
		});
	});
});
