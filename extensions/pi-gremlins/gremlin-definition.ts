import type { AgentSource, AgentFrontmatter } from "./agent-definition.js";
import {
	parseAgentMarkdown,
	parseTools,
	readAgentMarkdown,
	readScalar,
} from "./agent-definition.js";

export type GremlinSource = AgentSource;

export interface GremlinFrontmatter extends AgentFrontmatter {
	name?: string;
	description?: string;
	model?: string;
	thinking?: string;
	tools?: string[];
	body?: string;
}

export interface GremlinDefinition {
	name: string;
	description?: string;
	source: GremlinSource;
	filePath: string;
	rawMarkdown: string;
	frontmatter: GremlinFrontmatter;
}

export function parseGremlinDefinition(
	markdown: string,
	filePath: string,
	source: GremlinSource,
): GremlinDefinition | null {
	const { frontmatter, body } = parseAgentMarkdown(markdown);
	const agentType = readScalar(frontmatter, "agent_type");
	if (agentType !== "sub-agent") return null;

	const name = readScalar(frontmatter, "name");
	if (!name) return null;

	return {
		name,
		description: readScalar(frontmatter, "description"),
		source,
		filePath,
		rawMarkdown: markdown,
		frontmatter: {
			...frontmatter,
			agent_type: agentType,
			description: readScalar(frontmatter, "description"),
			model: readScalar(frontmatter, "model"),
			thinking: readScalar(frontmatter, "thinking"),
			tools: parseTools(frontmatter.tools),
			body,
		},
	};
}

export async function loadGremlinDefinition(
	filePath: string,
	source: GremlinSource,
): Promise<GremlinDefinition | null> {
	const rawMarkdown = await readAgentMarkdown(filePath);
	return parseGremlinDefinition(rawMarkdown, filePath, source);
}
