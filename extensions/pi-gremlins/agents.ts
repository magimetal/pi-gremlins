/**
 * Agent discovery and configuration
 *
 * Baseline support uses user and project agent directories.
 * Optional package-resolved agents are merged only when the active pi build
 * exposes resolved agent resources at runtime.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ResolvedPaths } from "@mariozechner/pi-coding-agent";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";
export type AgentSource = "user" | "project" | "package";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	thinking?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

export interface AgentLookupResult {
	agent: AgentConfig | null;
	ambiguousMatches: AgentConfig[];
}

function normalizeAgentName(name: string): string {
	return name.toLowerCase();
}

export function resolveAgentByName(
	agents: AgentConfig[],
	requestedName: string,
): AgentLookupResult {
	const exactMatch = agents.find((agent) => agent.name === requestedName);
	if (exactMatch) {
		return {
			agent: exactMatch,
			ambiguousMatches: [],
		};
	}

	const normalizedRequestedName = normalizeAgentName(requestedName);
	const caseInsensitiveMatches = agents.filter(
		(agent) => normalizeAgentName(agent.name) === normalizedRequestedName,
	);

	if (caseInsensitiveMatches.length === 1) {
		return {
			agent: caseInsensitiveMatches[0],
			ambiguousMatches: [],
		};
	}

	return {
		agent: null,
		ambiguousMatches: caseInsensitiveMatches,
	};
}

function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		const agent = loadAgentFromFile(filePath, source);
		if (agent) agents.push(agent);
	}

	return agents;
}

function loadAgentFromFile(
	filePath: string,
	source: AgentSource,
): AgentConfig | null {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}

	const { frontmatter, body } =
		parseFrontmatter<Record<string, string>>(content);
	if (!frontmatter.name || !frontmatter.description) {
		return null;
	}

	const tools = frontmatter.tools
		?.split(",")
		.map((tool: string) => tool.trim())
		.filter(Boolean);

	return {
		name: frontmatter.name,
		description: frontmatter.description,
		tools: tools && tools.length > 0 ? tools : undefined,
		model: frontmatter.model,
		thinking: frontmatter.thinking,
		systemPrompt: body,
		source,
		filePath,
	};
}

function isDirectory(candidatePath: string): boolean {
	try {
		return fs.statSync(candidatePath).isDirectory();
	} catch {
		return false;
	}
}

export function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function getEnabledPackageAgentPaths(
	resolvedPaths: ResolvedPaths,
): string[] {
	const agentResources = (resolvedPaths as unknown as Record<string, unknown>)
		.agents;
	if (!agentResources || !Array.isArray(agentResources)) {
		return [];
	}

	const agentPaths: string[] = [];
	for (const resource of agentResources) {
		if (!resource || typeof resource !== "object") continue;

		const enabled = (resource as Record<string, unknown>).enabled;
		const agentPath = (resource as Record<string, unknown>).path;
		if (enabled !== true || typeof agentPath !== "string") continue;
		agentPaths.push(agentPath);
	}
	return agentPaths;
}

function loadAgentsFromResolvedPaths(
	resolvedPaths: ResolvedPaths,
): AgentConfig[] {
	const agents: AgentConfig[] = [];
	for (const agentPath of getEnabledPackageAgentPaths(resolvedPaths)) {
		const agent = loadAgentFromFile(agentPath, "package");
		if (agent) agents.push(agent);
	}
	return agents;
}

export function getUserAgentsDir(): string {
	return path.join(getAgentDir(), "agents");
}

function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = getUserAgentsDir();
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents =
		scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents =
		scope === "user" || !projectAgentsDir
			? []
			: loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function discoverAgentsWithPackages(
	cwd: string,
	scope: AgentScope,
	resolvedPaths?: ResolvedPaths,
): AgentDiscoveryResult {
	const base = discoverAgents(cwd, scope);

	if (!resolvedPaths) return base;

	const packageAgents = loadAgentsFromResolvedPaths(resolvedPaths);
	if (packageAgents.length === 0) return base;

	const agentMap = new Map<string, AgentConfig>();
	for (const agent of packageAgents) agentMap.set(agent.name, agent);
	for (const agent of base.agents) agentMap.set(agent.name, agent);

	return {
		agents: Array.from(agentMap.values()),
		projectAgentsDir: base.projectAgentsDir,
	};
}
