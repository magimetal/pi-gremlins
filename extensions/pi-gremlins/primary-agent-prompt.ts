import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { PrimaryAgentDiscoveryCache } from "./gremlin-discovery.js";
import type { PrimaryAgentDefinition } from "./primary-agent-definition.js";
import {
	PRIMARY_AGENT_ENTRY_TYPE,
	selectAgentInState,
	toSessionEntryData,
	type PrimaryAgentState,
} from "./primary-agent-state.js";

export const PROMPT_BLOCK_START = "<!-- pi-gremlins primary agent:start -->";
export const PROMPT_BLOCK_END = "<!-- pi-gremlins primary agent:end -->";
const LEGACY_PROMPT_BLOCK_START = "<!-- pi-mohawk primary agent:start -->";
const LEGACY_PROMPT_BLOCK_END = "<!-- pi-mohawk primary agent:end -->";

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripBlock(systemPrompt: string, start: string, end: string): string {
	return systemPrompt.replace(
		new RegExp(`\\n{0,2}${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, "g"),
		"",
	);
}

export function stripPrimaryAgentPromptBlocks(systemPrompt: string): string {
	return stripBlock(
		stripBlock(systemPrompt, PROMPT_BLOCK_START, PROMPT_BLOCK_END),
		LEGACY_PROMPT_BLOCK_START,
		LEGACY_PROMPT_BLOCK_END,
	);
}

export function appendPrimaryAgentPromptBlock(
	systemPrompt: string,
	agent: PrimaryAgentDefinition,
): string {
	const withoutExistingBlock = stripPrimaryAgentPromptBlocks(systemPrompt);
	return `${withoutExistingBlock}\n\n${PROMPT_BLOCK_START}\n# pi-gremlins primary agent: ${agent.name}\n\n${agent.rawMarkdown}\n${PROMPT_BLOCK_END}`;
}

export interface PromptInjectionResult {
	state: PrimaryAgentState;
	result: BeforeAgentStartEventResult | undefined;
}

export async function applyPrimaryAgentPromptInjection(args: {
	pi: ExtensionAPI;
	event: BeforeAgentStartEvent;
	ctx: ExtensionContext;
	state: PrimaryAgentState;
	discoveryCache: PrimaryAgentDiscoveryCache;
	updateStatus: (ctx: ExtensionContext, state: PrimaryAgentState) => void;
	notify: (
		ctx: ExtensionContext,
		message: string,
		type?: "info" | "warning" | "error",
	) => void;
}): Promise<PromptInjectionResult> {
	if (!args.state.selectedName) return { state: args.state, result: undefined };
	const { agents } = await args.discoveryCache.get(args.ctx.cwd);
	const agent = agents.find((candidate) => candidate.name === args.state.selectedName);
	if (!agent) {
		const missingName = args.state.selectedName;
		args.pi.appendEntry(PRIMARY_AGENT_ENTRY_TYPE, toSessionEntryData(null));
		const nextState = selectAgentInState(args.state, null);
		args.updateStatus(args.ctx, nextState);
		args.notify(
			args.ctx,
			`Selected primary agent unavailable, reset to None: ${missingName}`,
			"warning",
		);
		return { state: nextState, result: undefined };
	}
	return {
		state: args.state,
		result: { systemPrompt: appendPrimaryAgentPromptBlock(args.event.systemPrompt, agent) },
	};
}
