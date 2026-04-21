import type { AgentConfig } from "./agents.js";

export function formatAvailableAgents(agents: AgentConfig[]): string {
	return (
		agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") ||
		"none"
	);
}

export function getAgentSetupHint(): string {
	return 'Create gremlin definitions in ~/.pi/agent/agents/ or .pi/agents/. Project-local gremlins require agentScope: "both" or "project".';
}

export function formatPackageDiscoveryWarningText(
	packageDiscoveryWarning?: string,
): string {
	return packageDiscoveryWarning
		? `\nPackage gremlin discovery warning: ${packageDiscoveryWarning}`
		: "";
}

export function formatAgentLookupError(
	agentName: string,
	agents: AgentConfig[],
	ambiguousMatches: AgentConfig[],
	packageDiscoveryWarning?: string,
): string {
	const packageWarning = formatPackageDiscoveryWarningText(
		packageDiscoveryWarning,
	);
	if (ambiguousMatches.length > 1) {
		return `Ambiguous gremlin: "${agentName}". Matching gremlins: ${formatAvailableAgents(ambiguousMatches)}. Use exact casing.
${getAgentSetupHint()}${packageWarning}`;
	}

	return `Unknown gremlin: "${agentName}". Available gremlins: ${formatAvailableAgents(agents)}.
${getAgentSetupHint()}${packageWarning}`;
}
