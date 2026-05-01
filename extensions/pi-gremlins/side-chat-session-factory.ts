/**
 * Side-chat session factory (PRD-0004 / ADR-0004).
 *
 * Produces an isolated, capability-profile-aware SDK session for a
 * single `/gremlins:chat` or `/gremlins:tangent` invocation. Composes the
 * gremlin-session-factory primitives to inherit ADR-0003 isolation
 * (no parent extensions / skills / prompts / themes / AGENTS / primary-agent
 * markdown leakage) without modifying the gremlin factory's surface.
 *
 * Confirmed (Observed) symbols:
 * - `createAgentSession.tools?: string[]` — explicit allowlist.
 *   Empty array `[]` => zero tools enabled. Source:
 *   node_modules/@mariozechner/pi-coding-agent/dist/core/sdk.d.ts:36.
 * - `pi.sendMessage({ customType, content, display, details })` is the
 *   inline rendering path (types.d.ts:817).
 * - `pi.registerMessageRenderer<T>(customType, renderer)` provides the
 *   inline renderer hook (types.d.ts:815, 752).
 * - `ctx.sessionManager.getBranch()` returns `SessionEntry[]` whose
 *   `SessionMessageEntry.message` carries the `AgentMessage` shape
 *   (session-manager.d.ts:23–25, 244).
 *
 * Guardrails:
 * - Does NOT import `gremlin-prompt.ts` / `buildGremlinPrompt`.
 * - Does NOT mutate or re-export `gremlin-session-factory.ts` shapes.
 * - Does NOT register any tools except explicitly approved side-chat tools.
 * - Does NOT expose per-side-chat model/thinking overrides (D8).
 */

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import type {
	CreateAgentSessionResult,
	ModelRegistry,
	ResourceLoader,
} from "@mariozechner/pi-coding-agent";
import {
	readSideChatCapabilities,
	type ResolvedSideChatCapabilities,
} from "./side-chat-capabilities.js";
import {
	createEmptyGremlinResources,
	createGremlinSession,
	createIsolatedGremlinResourceLoader,
	resolveGremlinModel,
	resolveGremlinThinking,
} from "./gremlin-session-factory.js";

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
	modelRegistry?: ModelRegistry;
	capabilities?: ResolvedSideChatCapabilities;
}

export interface SideChatSessionConfig {
	systemPrompt: string;
	prompt: string;
	model?: string;
	resolvedModel?: Model<any>;
	modelResolutionError?: string;
	thinking?: ThinkingLevel;
	tools: string[];
	cwd?: string;
	usesSubprocess: false;
	writesTempPromptFile: false;
	resources: ReturnType<typeof createEmptyGremlinResources>;
	resourceLoader: ResourceLoader;
}

export interface CreateSideChatSessionOptions
	extends BuildSideChatSessionConfigOptions {
	sessionConfig?: SideChatSessionConfig;
}

export const SIDE_CHAT_SYSTEM_PROMPT_CHAT = buildSideChatSystemPrompt({
	mode: "chat",
	tools: [],
});

export const SIDE_CHAT_SYSTEM_PROMPT_TANGENT = buildSideChatSystemPrompt({
	mode: "tangent",
	tools: [],
});

function buildSideChatSystemPrompt(options: {
	mode: SideChatMode;
	tools: string[];
}): string {
	const modeLine =
		options.mode === "chat"
			? "You are a side-chat conversational assistant for the Gremlins🧌 host session."
			: "You are a side-chat tangent assistant for the Gremlins🧌 host session.";
	const contextLine =
		options.mode === "chat"
			? "You receive a snapshot of the parent transcript only as conversational context."
			: "You start with a clean slate: no parent transcript, no project context.";
	const capabilityLine =
		options.tools.length === 0
			? "You have NO tools, no workspace access, and cannot read or modify files."
			: [
					`You may use only these approved read-only workspace tools: ${options.tools.join(", ")}.`,
					"Workspace inspection may include reading files, searching text, finding files, and listing directories according to the approved tools.",
					"You have no mutation, shell, write, edit, or unlisted tools; do not claim to modify files or run shell commands.",
				].join(" ");
	const toolInstruction =
		options.tools.length === 0
			? "Do not pretend to run commands, edit files, or call tools — you cannot."
			: "Use approved tools only when needed; otherwise answer conversationally and keep tool use minimal.";
	return [
		modeLine,
		capabilityLine,
		contextLine,
		toolInstruction,
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

function createSideChatResourceLoader(
	systemPrompt: string,
	capabilities: ResolvedSideChatCapabilities,
): ResourceLoader {
	const base = createIsolatedGremlinResourceLoader(systemPrompt);
	return {
		...base,
		getSkills: () => ({ skills: capabilities.skills, diagnostics: [] }),
	};
}

export function buildSideChatSessionConfig(
	options: BuildSideChatSessionConfigOptions,
): SideChatSessionConfig {
	const capabilities =
		options.capabilities ?? readSideChatCapabilities(options.cwd, options.mode);
	const systemPrompt = buildSideChatSystemPrompt({
		mode: options.mode,
		tools: capabilities.tools,
	});

	// D8: no per-side-chat model/thinking overrides; reuse parent fallback only.
	const resolvedModel = resolveGremlinModel(
		undefined,
		options.parentModel,
		options.modelRegistry,
	);
	const thinking = resolveGremlinThinking(undefined, options.parentThinking);

	const prompt =
		options.mode === "chat"
			? buildChatPrompt(options.userPrompt, options.parentSnapshot)
			: buildTangentPrompt(options.userPrompt);

	return {
		systemPrompt,
		prompt,
		model: resolvedModel.label,
		resolvedModel: resolvedModel.model,
		modelResolutionError: resolvedModel.error,
		thinking,
		tools: [...capabilities.tools],
		cwd: options.cwd,
		usesSubprocess: false,
		writesTempPromptFile: false,
		resources: createEmptyGremlinResources(),
		resourceLoader: createSideChatResourceLoader(systemPrompt, capabilities),
	};
}

export async function createSideChatSession(
	options: CreateSideChatSessionOptions,
): Promise<CreateAgentSessionResult> {
	const plan = options.sessionConfig ?? buildSideChatSessionConfig(options);
	// Compose through createGremlinSession by passing a synthetic gremlin
	// definition that yields the same plan. We bypass that path by passing
	// the prebuilt sessionConfig directly — createGremlinSession honors
	// `options.sessionConfig` and uses its `tools`, `resourceLoader`,
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
		cwd: options.cwd,
		parentModel: options.parentModel,
		parentThinking: options.parentThinking,
		modelRegistry: options.modelRegistry,
	});
}
