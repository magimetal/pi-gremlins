/**
 * Side-chat session factory (PRD-0008 / ADR-0008).
 *
 * Produces isolated `/gremlins:chat` and `/gremlins:tangent` SDK child
 * sessions that omit explicit `tools` so Pi SDK default built-ins apply, while
 * using a fresh child DefaultResourceLoader for enabled extension custom tools
 * and child-session skill guidance.
 *
 * Guardrails:
 * - Does NOT import `gremlin-prompt.ts` / `buildGremlinPrompt`.
 * - Does NOT read side-chat-specific `.pi/settings.json` capability config.
 * - Does NOT pass parent resources, prompts, themes, AGENTS files, or
 *   primary-agent material into the child loader.
 * - Does NOT inherit parent-loaded skills; fresh child-session skills may load
 *   through the child resource-loader boundary.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import {
	DefaultResourceLoader,
	getAgentDir,
	SettingsManager,
	type CreateAgentSessionResult,
	type ExtensionFactory,
	type ModelRegistry,
	type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import {
	createEmptyGremlinResources,
	createGremlinSession,
	resolveGremlinModel,
	resolveGremlinThinking,
} from "../gremlins/gremlin-session-factory.js";

export type SideChatMode = "chat" | "tangent";

export interface ParentTranscriptEntry {
	role: "user" | "assistant";
	text: string;
}

export interface ParentTranscriptSnapshot {
	entries: ParentTranscriptEntry[];
	capturedAt: string;
}

export interface BuildSideChatSessionConfigOptions {
	mode: SideChatMode;
	userPrompt: string;
	parentSnapshot?: ParentTranscriptSnapshot;
	parentModel?: string | Model<any>;
	parentThinking?: ThinkingLevel;
	cwd?: string;
	agentDir?: string;
	settingsManager?: SettingsManager;
	modelRegistry?: ModelRegistry;
	extensionFactories?: ExtensionFactory[];
}

export interface SideChatSessionConfig {
	systemPrompt: string;
	prompt: string;
	model?: string;
	resolvedModel?: Model<any>;
	modelResolutionError?: string;
	thinking?: ThinkingLevel;
	tools?: string[];
	cwd?: string;
	agentDir?: string;
	settingsManager?: SettingsManager;
	usesSubprocess: false;
	writesTempPromptFile: false;
	resources: ReturnType<typeof createEmptyGremlinResources>;
	resourceLoader: ResourceLoader;
}

export interface CreateSideChatSessionOptions
	extends BuildSideChatSessionConfigOptions {
	sessionConfig?: SideChatSessionConfig;
}

export const SIDE_CHAT_SYSTEM_PROMPT_CHAT = buildSideChatSystemPrompt("chat");
export const SIDE_CHAT_SYSTEM_PROMPT_TANGENT = buildSideChatSystemPrompt("tangent");

function buildSideChatSystemPrompt(mode: SideChatMode): string {
	const modeLine =
		mode === "chat"
			? "You are a side-chat conversational assistant for the Gremlins🧌 host session."
			: "You are a side-chat tangent assistant for the Gremlins🧌 host session.";
	const contextLine =
		mode === "chat"
			? "You receive only the parent transcript snapshot included in the user prompt as conversational context; you do not inherit live parent history."
			: "You start without parent transcript context and do not receive parent history.";
	return [
		modeLine,
		"Pi SDK default built-in tools may be available because this child session does not set an explicit tool allowlist; current SDK defaults may include read, bash/shell, edit, and write capabilities.",
		"Enabled extension custom tools may also be available through the child session's fresh extension loader.",
		"Fresh child-session skills and skill guidance may also be available through the child session's fresh resource loader; parent-loaded skills are not inherited.",
		contextLine,
		"Do not assume parent prompts, themes, AGENTS files, primary-agent material, or hidden parent context are inherited.",
		"Be terse by default. Answer directly. Ask one focused question if input is ambiguous.",
	].join("\n");
}

function formatTranscriptEntries(entries: ParentTranscriptEntry[]): string {
	return entries
		.map((entry) => `[${entry.role}] ${entry.text}`)
		.join("\n");
}

function buildChatPrompt(
	userPrompt: string,
	parentSnapshot: ParentTranscriptSnapshot | undefined,
): string {
	const trimmedUserPrompt = userPrompt.trim();
	const questionBlock = `<side-chat-question>\n${trimmedUserPrompt}\n</side-chat-question>`;
	if (!parentSnapshot || parentSnapshot.entries.length === 0) {
		return questionBlock;
	}
	const transcriptBody = formatTranscriptEntries(parentSnapshot.entries);
	const transcriptBlock = [
		`<parent-transcript-snapshot capturedAt="${parentSnapshot.capturedAt}">`,
		transcriptBody,
		"</parent-transcript-snapshot>",
	].join("\n");
	return `${transcriptBlock}\n\n${questionBlock}`;
}

function buildTangentPrompt(userPrompt: string): string {
	const trimmedUserPrompt = userPrompt.trim();
	return `<side-chat-question>\n${trimmedUserPrompt}\n</side-chat-question>`;
}

export function buildSideChatPrompt(options: {
	mode: SideChatMode;
	userPrompt: string;
	parentSnapshot?: ParentTranscriptSnapshot;
}): string {
	return options.mode === "chat"
		? buildChatPrompt(options.userPrompt, options.parentSnapshot)
		: buildTangentPrompt(options.userPrompt);
}

function createSideChatResourceLoader(options: {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
	systemPrompt: string;
	extensionFactories?: ExtensionFactory[];
}): ResourceLoader {
	return new DefaultResourceLoader({
		cwd: options.cwd,
		agentDir: options.agentDir,
		settingsManager: options.settingsManager,
		extensionFactories: options.extensionFactories,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: options.systemPrompt,
		appendSystemPrompt: [],
		// Preserve extension records/runtime so registered custom tools survive.
		// Strip non-tool/non-skill surfaces via the resource getters below instead
		// of replacing `extensions` with [] — ExtensionRunner needs those records.
		promptsOverride: () => ({ prompts: [], diagnostics: [] }),
		themesOverride: () => ({ themes: [], diagnostics: [] }),
		agentsFilesOverride: () => ({ agentsFiles: [] }),
		systemPromptOverride: () => options.systemPrompt,
		appendSystemPromptOverride: () => [],
	});
}

export function buildSideChatSessionConfig(
	options: BuildSideChatSessionConfigOptions,
): SideChatSessionConfig {
	const systemPrompt =
		options.mode === "chat"
			? SIDE_CHAT_SYSTEM_PROMPT_CHAT
			: SIDE_CHAT_SYSTEM_PROMPT_TANGENT;
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();
	const settingsManager =
		options.settingsManager ?? SettingsManager.create(cwd, agentDir);

	// D8: no per-side-chat model/thinking overrides; reuse parent fallback only.
	const resolvedModel = resolveGremlinModel(
		undefined,
		options.parentModel,
		options.modelRegistry,
	);
	const thinking = resolveGremlinThinking(undefined, options.parentThinking);

	const prompt = buildSideChatPrompt({
		mode: options.mode,
		userPrompt: options.userPrompt,
		parentSnapshot: options.parentSnapshot,
	});

	return {
		systemPrompt,
		prompt,
		model: resolvedModel.label,
		resolvedModel: resolvedModel.model,
		modelResolutionError: resolvedModel.error,
		thinking,
		cwd,
		agentDir,
		settingsManager,
		usesSubprocess: false,
		writesTempPromptFile: false,
		resources: createEmptyGremlinResources(),
		resourceLoader: createSideChatResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			systemPrompt,
			extensionFactories: options.extensionFactories,
		}),
	};
}

export async function createSideChatSession(
	options: CreateSideChatSessionOptions,
): Promise<CreateAgentSessionResult> {
	const plan = options.sessionConfig ?? buildSideChatSessionConfig(options);
	await plan.resourceLoader.reload();
	// Compose through createGremlinSession by passing a synthetic gremlin
	// definition that yields the same plan. We bypass that path by passing
	// the prebuilt sessionConfig directly — createGremlinSession honors
	// `options.sessionConfig` and uses omitted `tools`, the fresh resourceLoader,
	// `resolvedModel`, and `thinking` verbatim.
	return createGremlinSession({
		sessionConfig: plan,
		// `gremlin`, `intent`, `context` are unused when sessionConfig is provided,
		// but the type requires them for the build path. Provide inert shapes.
		gremlin: {
			name: "side-chat",
			source: "user",
			rawMarkdown: plan.systemPrompt,
			frontmatter: {},
		},
		intent: "",
		context: "",
		cwd: plan.cwd ?? options.cwd,
		agentDir: plan.agentDir ?? options.agentDir,
		settingsManager: plan.settingsManager ?? options.settingsManager,
		parentModel: options.parentModel,
		parentThinking: options.parentThinking,
		modelRegistry: options.modelRegistry,
	});
}
