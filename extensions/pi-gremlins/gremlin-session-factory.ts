import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import {
	AuthStorage,
	createAgentSession,
	createExtensionRuntime,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type ResourceLoader,
} from "@mariozechner/pi-coding-agent";
import type { GremlinDefinition } from "./gremlin-definition.js";
import { buildGremlinPrompt } from "./gremlin-prompt.js";

const VALID_THINKING_LEVELS = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

export interface BuildGremlinSessionConfigOptions {
	parentSystemPrompt: string;
	parentModel?: string | Model<any>;
	parentThinking?: ThinkingLevel;
	gremlin: Pick<GremlinDefinition, "name" | "source" | "rawMarkdown" | "frontmatter">;
	context: string;
	cwd?: string;
	modelRegistry?: ModelRegistry;
}

export interface CreateGremlinSessionOptions extends BuildGremlinSessionConfigOptions {
	agentDir?: string;
	authStorage?: AuthStorage;
	settingsManager?: SettingsManager;
	sessionManager?: SessionManager;
}

export interface GremlinSessionConfig {
	systemPrompt: string;
	prompt: string;
	model?: string;
	resolvedModel?: Model<any>;
	modelResolutionError?: string;
	thinking?: ThinkingLevel;
	tools?: string[];
	cwd?: string;
	usesSubprocess: false;
	writesTempPromptFile: false;
	resources: {
		agents: [];
		extensions: [];
		prompts: [];
		skills: [];
		themes: [];
	};
	resourceLoader: ResourceLoader;
}

export function createEmptyGremlinResources(): GremlinSessionConfig["resources"] {
	return {
		agents: [],
		extensions: [],
		prompts: [],
		skills: [],
		themes: [],
	};
}

export function createIsolatedGremlinResourceLoader(
	systemPrompt: string,
): ResourceLoader {
	return {
		getExtensions: () => ({
			extensions: [],
			errors: [],
			runtime: createExtensionRuntime(),
		}),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

function getModelLabel(model: string | Model<any> | undefined): string | undefined {
	if (!model) return undefined;
	if (typeof model === "string") return model;
	return `${model.provider}/${model.id}`;
}

export function resolveGremlinModel(
	gremlinModel: string | undefined,
	parentModel: string | Model<any> | undefined,
	modelRegistry?: ModelRegistry,
): { label?: string; model?: Model<any>; error?: string } {
	if (!gremlinModel) {
		return typeof parentModel === "string"
			? { label: parentModel }
			: { label: getModelLabel(parentModel), model: parentModel };
	}
	if (!modelRegistry) {
		return { label: gremlinModel };
	}

	if (gremlinModel.includes("/")) {
		const [provider, ...rest] = gremlinModel.split("/");
		const modelId = rest.join("/");
		const resolved = modelRegistry.find(provider, modelId);
		return resolved
			? { label: gremlinModel, model: resolved }
			: { label: gremlinModel, error: `Unknown gremlin model: ${gremlinModel}` };
	}

	const matches = modelRegistry
		.getAll()
		.filter((candidate) => candidate.id === gremlinModel);

	if (matches.length === 1) {
		return {
			label: `${matches[0].provider}/${matches[0].id}`,
			model: matches[0],
		};
	}

	return { label: gremlinModel, error: `Unknown gremlin model: ${gremlinModel}` };
}

export function resolveGremlinThinking(
	gremlinThinking: unknown,
	parentThinking?: ThinkingLevel,
): ThinkingLevel | undefined {
	if (
		typeof gremlinThinking === "string" &&
		VALID_THINKING_LEVELS.has(gremlinThinking as ThinkingLevel)
	) {
		return gremlinThinking as ThinkingLevel;
	}
	return parentThinking;
}

export function buildGremlinSessionConfig({
	parentSystemPrompt,
	parentModel,
	parentThinking,
	gremlin,
	context,
	cwd,
	modelRegistry,
}: BuildGremlinSessionConfigOptions): GremlinSessionConfig {
	const resolvedModel = resolveGremlinModel(
		typeof gremlin.frontmatter.model === "string"
			? gremlin.frontmatter.model
			: undefined,
		parentModel,
		modelRegistry,
	);
	const thinking = resolveGremlinThinking(
		gremlin.frontmatter.thinking,
		parentThinking,
	);
	const systemPrompt = parentSystemPrompt;
	return {
		systemPrompt,
		prompt: buildGremlinPrompt({
			parentSystemPrompt,
			rawMarkdown: gremlin.rawMarkdown,
			context,
		}),
		model: resolvedModel.label,
		resolvedModel: resolvedModel.model,
		modelResolutionError: resolvedModel.error,
		thinking,
		tools: Array.isArray(gremlin.frontmatter.tools)
			? gremlin.frontmatter.tools
			: undefined,
		cwd,
		usesSubprocess: false,
		writesTempPromptFile: false,
		resources: createEmptyGremlinResources(),
		resourceLoader: createIsolatedGremlinResourceLoader(systemPrompt),
	};
}

export async function createGremlinSession(options: CreateGremlinSessionOptions) {
	const plan = buildGremlinSessionConfig(options);
	const cwd = options.cwd ?? process.cwd();
	const authStorage =
		options.authStorage ?? options.modelRegistry?.authStorage ?? AuthStorage.inMemory();
	const modelRegistry = options.modelRegistry ?? ModelRegistry.inMemory(authStorage);
	const settingsManager =
		options.settingsManager ??
		SettingsManager.inMemory({
			compaction: { enabled: false },
		});
	const sessionManager = options.sessionManager ?? SessionManager.inMemory(cwd);
	return createAgentSession({
		cwd,
		agentDir: options.agentDir,
		authStorage,
		modelRegistry,
		model: plan.resolvedModel,
		thinkingLevel: plan.thinking,
		tools: plan.tools,
		resourceLoader: plan.resourceLoader,
		sessionManager,
		settingsManager,
	});
}
