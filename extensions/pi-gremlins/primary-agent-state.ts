import type { PrimaryAgentDefinition } from "./primary-agent-definition.js";

export const PRIMARY_AGENT_ENTRY_TYPE = "pi-gremlins-primary-agent";
export const LEGACY_PRIMARY_AGENT_ENTRY_TYPE = "pi-mohawk-primary-agent";

export interface PrimaryAgentSessionEntryData {
	selectedName: string | null;
	source?: "user" | "project";
	filePath?: string;
}

export interface PrimaryAgentState {
	selectedName: string | null;
	missingSelectedName: string | null;
}

export const NONE_SELECTION: PrimaryAgentSessionEntryData = { selectedName: null };

export function createInitialPrimaryAgentState(): PrimaryAgentState {
	return { selectedName: null, missingSelectedName: null };
}

export function isPrimaryAgentSessionEntryData(
	value: unknown,
): value is PrimaryAgentSessionEntryData {
	if (!value || typeof value !== "object") return false;
	if (!("selectedName" in value)) return false;
	const selectedName = value.selectedName;
	if (selectedName !== null && typeof selectedName !== "string") return false;
	if (
		"source" in value &&
		value.source !== undefined &&
		value.source !== "user" &&
		value.source !== "project"
	) {
		return false;
	}
	if (
		"filePath" in value &&
		value.filePath !== undefined &&
		typeof value.filePath !== "string"
	) {
		return false;
	}
	return true;
}

interface BranchCustomEntry {
	type: string;
	customType?: string;
	data?: unknown;
}

export function getLatestPrimaryAgentSessionEntryData(
	branchEntries: readonly BranchCustomEntry[],
): PrimaryAgentSessionEntryData | null {
	for (const entry of [...branchEntries].reverse()) {
		if (
			entry.type === "custom" &&
			(entry.customType === PRIMARY_AGENT_ENTRY_TYPE ||
				entry.customType === LEGACY_PRIMARY_AGENT_ENTRY_TYPE) &&
			isPrimaryAgentSessionEntryData(entry.data)
		) {
			return entry.data;
		}
	}
	return null;
}

export function reconstructPrimaryAgentStateFromData(
	data: PrimaryAgentSessionEntryData | null,
	agents: readonly PrimaryAgentDefinition[],
): PrimaryAgentState {
	if (!data) return createInitialPrimaryAgentState();
	if (data.selectedName === null) return createInitialPrimaryAgentState();

	const selectedExists = agents.some((agent) => agent.name === data.selectedName);
	return selectedExists
		? { selectedName: data.selectedName, missingSelectedName: null }
		: { selectedName: null, missingSelectedName: data.selectedName };
}

export function reconstructPrimaryAgentStateFromBranch(
	branchEntries: readonly BranchCustomEntry[],
	agents: readonly PrimaryAgentDefinition[],
): PrimaryAgentState {
	return reconstructPrimaryAgentStateFromData(
		getLatestPrimaryAgentSessionEntryData(branchEntries),
		agents,
	);
}

export function toSessionEntryData(
	agent: PrimaryAgentDefinition | null,
): PrimaryAgentSessionEntryData {
	if (!agent) return NONE_SELECTION;
	return {
		selectedName: agent.name,
		source: agent.source,
		filePath: agent.filePath,
	};
}

export function selectAgentInState(
	state: PrimaryAgentState,
	agent: PrimaryAgentDefinition | null,
): PrimaryAgentState {
	return { ...state, selectedName: agent?.name ?? null, missingSelectedName: null };
}

export function hasSelectionChanged(
	state: PrimaryAgentState,
	nextName: string | null,
): boolean {
	return state.selectedName !== nextName || state.missingSelectedName !== null;
}
