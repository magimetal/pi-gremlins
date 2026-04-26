import { describe, expect, test } from "bun:test";

const PRIMARY_BLOCK_START = "<!-- pi-gremlins primary agent:start -->";
const PRIMARY_BLOCK_END = "<!-- pi-gremlins primary agent:end -->";

describe("gremlin session factory v1 contract", () => {
	test("builds child session config from raw gremlin markdown caller intent and caller context only", async () => {
		const { buildGremlinPrompt } = await import("./gremlin-prompt.ts");
		const { buildGremlinSessionConfig } = await import(
			"./gremlin-session-factory.ts"
		);

		const rawMarkdown = [
			"---",
			"name: researcher",
			"model: gpt-5-mini",
			"thinking: high",
			"tools: read, grep",
			"---",
			"You are focused research gremlin.",
		].join("\n");
		const intent = "Map architecture before parent edits auth code";
		const context = "Find auth flow entry points";
		const prompt = buildGremlinPrompt({
			intent,
			context,
		});
		const config = buildGremlinSessionConfig({
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
			intent,
			context,
		});

		expect(prompt).not.toContain(rawMarkdown);
		expect(prompt).toContain("Caller intent:");
		expect(prompt).toContain(intent);
		expect(prompt).toContain("Caller context:");
		expect(prompt).toContain(context);
		expect(config).toMatchObject({
			systemPrompt: rawMarkdown,
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
		expect(config.resourceLoader.getSystemPrompt()).toBe(rawMarkdown);
	});

	test("excludes parent primary-agent prompt blocks from child session system prompt and user prompt", async () => {
		const { buildGremlinSessionConfig } = await import(
			"./gremlin-session-factory.ts"
		);

		const parentPromptSnapshot = [
			"Parent rules before injected block.",
			PRIMARY_BLOCK_START,
			"# pi-gremlins primary agent: Orchestrator",
			"Primary-only orchestration rules must stay in parent session.",
			PRIMARY_BLOCK_END,
			"Parent rules after injected block.",
		].join("\n");
		const rawMarkdown = [
			"---",
			"name: TARS",
			"agent_type: sub-agent",
			"---",
			"Sub-agent markdown allowed in child session.",
		].join("\n");
		const config = buildGremlinSessionConfig({
			parentModel: "openai/gpt-5",
			gremlin: {
				name: "TARS",
				source: "project",
				rawMarkdown,
				frontmatter: {},
			},
			intent: "Research safely",
			context: "Inspect isolation behavior without parent orchestration rules.",
		});

		expect(config.systemPrompt).toBe(rawMarkdown);
		expect(config.systemPrompt).toContain("Sub-agent markdown allowed");
		for (const leakedParentFragment of [
			...parentPromptSnapshot.split("\n"),
			PRIMARY_BLOCK_START,
			PRIMARY_BLOCK_END,
			"Primary-only orchestration rules",
		]) {
			expect(config.systemPrompt).not.toContain(leakedParentFragment);
			expect(config.prompt).not.toContain(leakedParentFragment);
		}
		expect(config.resourceLoader.getSystemPrompt()).toBe(rawMarkdown);
	});

	test("creates empty isolated resource loader with no extensions prompts skills themes or AGENTS files", async () => {
		const { createIsolatedGremlinResourceLoader } = await import(
			"./gremlin-session-factory.ts"
		);

		const loader = createIsolatedGremlinResourceLoader("sub-agent system prompt");
		expect(loader.getExtensions()).toMatchObject({
			extensions: [],
			errors: [],
		});
		expect(loader.getSkills()).toEqual({ skills: [], diagnostics: [] });
		expect(loader.getPrompts()).toEqual({ prompts: [], diagnostics: [] });
		expect(loader.getThemes()).toEqual({ themes: [], diagnostics: [] });
		expect(loader.getAgentsFiles()).toEqual({ agentsFiles: [] });
		expect(loader.getSystemPrompt()).toBe("sub-agent system prompt");
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

	test("marks explicit gremlin model unresolved when registry cannot resolve it", async () => {
		const { buildGremlinSessionConfig, resolveGremlinModel } = await import(
			"./gremlin-session-factory.ts"
		);
		const modelRegistry = {
			getAll: () => [],
			find: () => undefined,
		};

		expect(resolveGremlinModel("openai/missing", "openai/gpt-5", modelRegistry)).toEqual({
			label: "openai/missing",
			error: "Unknown gremlin model: openai/missing",
		});
		expect(
			buildGremlinSessionConfig({
				parentModel: "openai/gpt-5",
				gremlin: {
					name: "reviewer",
					source: "user",
					rawMarkdown: "---\nname: reviewer\nmodel: openai/missing\n---\nReview work",
					frontmatter: { model: "openai/missing" },
				},
				intent: "Check model routing before session creation",
				context: "Review diff",
				modelRegistry,
			}),
		).toMatchObject({
			model: "openai/missing",
			modelResolutionError: "Unknown gremlin model: openai/missing",
		});
	});

	test("keeps v1 no-subprocess no-temp-file contract explicit in session config", async () => {
		const { buildGremlinSessionConfig } = await import(
			"./gremlin-session-factory.ts"
		);

		const config = buildGremlinSessionConfig({
			parentModel: "openai/gpt-5",
			parentThinking: "low",
			gremlin: {
				name: "reviewer",
				source: "user",
				rawMarkdown: "---\nname: reviewer\n---\nReview work",
				frontmatter: {},
			},
			intent: "Verify no subprocess path is used",
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
