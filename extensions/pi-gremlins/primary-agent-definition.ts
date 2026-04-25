import type { AgentFrontmatter, AgentSource } from "./agent-definition.js";
import {
	filenameStem,
	parseAgentMarkdown,
	readAgentMarkdown,
	readFirstHeading,
	readScalar,
} from "./agent-definition.js";

export interface PrimaryAgentFrontmatter extends AgentFrontmatter {
	name?: string;
	description?: string;
	agent_type?: string;
	body?: string;
}

export interface PersistedPrimaryAgentSelection {
	selectedName: string | null;
	source?: AgentSource;
	filePath?: string;
}

export interface PrimaryAgentDefinition {
	name: string;
	description?: string;
	source: AgentSource;
	filePath: string;
	rawMarkdown: string;
	frontmatter: PrimaryAgentFrontmatter;
	selection: PersistedPrimaryAgentSelection;
}

export function parsePrimaryAgentDefinition(
	markdown: string,
	filePath: string,
	source: AgentSource,
): PrimaryAgentDefinition | null {
	const { frontmatter, body, hasFrontmatter } = parseAgentMarkdown(markdown);
	if (!hasFrontmatter) return null;
	const agentType = readScalar(frontmatter, "agent_type");
	if (agentType !== "primary") return null;

	const name =
		readScalar(frontmatter, "name") ?? readFirstHeading(body) ?? filenameStem(filePath);
	if (!name) return null;

	const description = readScalar(frontmatter, "description");
	const selection: PersistedPrimaryAgentSelection = {
		selectedName: name,
		source,
		filePath,
	};

	return {
		name,
		description,
		source,
		filePath,
		rawMarkdown: markdown,
		frontmatter: {
			...frontmatter,
			description,
			agent_type: agentType,
			body,
		},
		selection,
	};
}

export async function loadPrimaryAgentDefinition(
	filePath: string,
	source: AgentSource,
): Promise<PrimaryAgentDefinition | null> {
	const rawMarkdown = await readAgentMarkdown(filePath);
	return parsePrimaryAgentDefinition(rawMarkdown, filePath, source);
}
