import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
	resolvePrimaryAgentByName,
	type PrimaryAgentDiscoveryCache,
} from "./gremlin-discovery.js";
import type { PrimaryAgentDefinition } from "./primary-agent-definition.js";
import {
	hasSelectionChanged,
	PRIMARY_AGENT_ENTRY_TYPE,
	selectAgentInState,
	toSessionEntryData,
	type PrimaryAgentState,
} from "./primary-agent-state.js";

export const PRIMARY_STATUS_KEY = "pi-gremlins-primary";
export const PRIMARY_SHORTCUT = "ctrl+shift+m";

export function formatPrimaryAgentStatus(selectedName: string | null): string {
	return `Primary: ${selectedName ?? "None"}`;
}

export function updatePrimaryAgentStatus(
	ctx: ExtensionContext,
	state: PrimaryAgentState,
): void {
	ctx.ui.setStatus(PRIMARY_STATUS_KEY, formatPrimaryAgentStatus(state.selectedName));
}

export function notifyPrimaryAgent(
	ctx: ExtensionContext,
	message: string,
	type: "info" | "warning" | "error" = "info",
): void {
	ctx.ui.notify(message, type);
}

function sendTranscriptMessage(pi: ExtensionAPI, content: string): void {
	pi.sendMessage({ customType: "pi-gremlins-primary", content, display: true });
}

function getCycleOptions(
	agents: readonly PrimaryAgentDefinition[],
): Array<PrimaryAgentDefinition | null> {
	return [null, ...agents];
}

export function getNextCycledPrimaryAgent(
	agents: readonly PrimaryAgentDefinition[],
	selectedName: string | null,
): PrimaryAgentDefinition | null {
	const options = getCycleOptions(agents);
	const currentIndex = options.findIndex(
		(agent) => (agent?.name ?? null) === selectedName,
	);
	return options[(currentIndex + 1) % options.length] ?? null;
}

export async function persistPrimaryAgentSelection(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: PrimaryAgentState,
	agent: PrimaryAgentDefinition | null,
): Promise<PrimaryAgentState> {
	const nextName = agent?.name ?? null;
	if (!hasSelectionChanged(state, nextName)) {
		updatePrimaryAgentStatus(ctx, state);
		return state;
	}
	pi.appendEntry(PRIMARY_AGENT_ENTRY_TYPE, toSessionEntryData(agent));
	const nextState = selectAgentInState(state, agent);
	updatePrimaryAgentStatus(ctx, nextState);
	notifyPrimaryAgent(ctx, `Primary agent: ${nextName ?? "None"}`);
	return nextState;
}

export async function selectPrimaryAgentByName(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: PrimaryAgentState,
	discoveryCache: PrimaryAgentDiscoveryCache,
	requestedName: string,
): Promise<PrimaryAgentState> {
	if (requestedName.toLowerCase() === "none") {
		return persistPrimaryAgentSelection(pi, ctx, state, null);
	}

	const { agents } = await discoveryCache.get(ctx.cwd);
	const resolution = resolvePrimaryAgentByName(agents, requestedName);
	if (resolution.status === "found") {
		return persistPrimaryAgentSelection(pi, ctx, state, resolution.agent);
	}
	if (resolution.status === "ambiguous") {
		const names = resolution.matches.map((agent) => agent.name).join(", ");
		notifyPrimaryAgent(
			ctx,
			`Primary agent name is ambiguous: ${requestedName}. Use exact case: ${names}`,
			"warning",
		);
		updatePrimaryAgentStatus(ctx, state);
		return state;
	}
	notifyPrimaryAgent(ctx, `Primary agent not found: ${requestedName}`, "warning");
	updatePrimaryAgentStatus(ctx, state);
	return state;
}

export async function runMohawkCommand(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	state: PrimaryAgentState,
	discoveryCache: PrimaryAgentDiscoveryCache,
	args: string,
): Promise<PrimaryAgentState> {
	const requestedName = args.trim();
	if (requestedName) {
		return selectPrimaryAgentByName(pi, ctx, state, discoveryCache, requestedName);
	}

	const { agents } = await discoveryCache.get(ctx.cwd);
	if (!ctx.hasUI) {
		sendTranscriptMessage(
			pi,
			`Primary agents: None${agents.length > 0 ? `, ${agents.map((agent) => agent.name).join(", ")}` : ""}`,
		);
		updatePrimaryAgentStatus(ctx, state);
		return state;
	}

	const selected = await ctx.ui.select("Select primary agent", [
		"None",
		...agents.map((agent) => agent.name),
	]);
	if (!selected) {
		updatePrimaryAgentStatus(ctx, state);
		return state;
	}
	return selectPrimaryAgentByName(pi, ctx, state, discoveryCache, selected);
}

export async function cyclePrimaryAgent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: PrimaryAgentState,
	discoveryCache: PrimaryAgentDiscoveryCache,
): Promise<PrimaryAgentState> {
	const { agents } = await discoveryCache.get(ctx.cwd);
	const nextAgent = getNextCycledPrimaryAgent(agents, state.selectedName);
	return persistPrimaryAgentSelection(pi, ctx, state, nextAgent);
}
