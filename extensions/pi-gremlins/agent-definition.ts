import { readFile } from "node:fs/promises";
import * as path from "node:path";

export type AgentSource = "user" | "project";
export type AgentRole = "primary" | "sub-agent";

export interface AgentFrontmatter {
	name?: string;
	description?: string;
	agent_type?: string;
	model?: string;
	thinking?: string;
	tools?: string[];
	body?: string;
	[key: string]: unknown;
}

export interface ParsedAgentMarkdown {
	frontmatter: Record<string, string | string[]>;
	body: string;
	hasFrontmatter: boolean;
}

export interface BaseAgentDefinition {
	name: string;
	description?: string;
	source: AgentSource;
	filePath: string;
	rawMarkdown: string;
	frontmatter: AgentFrontmatter;
}

export function normalizeScalarValue(value: string): string {
	return value.replace(/^[ '\"]|[ '\"]$/g, "").trim();
}

export function parseAgentMarkdown(markdown: string): ParsedAgentMarkdown {
	const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) {
		return { frontmatter: {}, body: markdown, hasFrontmatter: false };
	}

	const frontmatter: Record<string, string | string[]> = {};
	let currentListKey: string | null = null;
	for (const rawLine of match[1].split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		if (!line.trim()) continue;

		const listItemMatch = line.match(/^\s*-\s+(.*)$/);
		if (listItemMatch && currentListKey) {
			const current = frontmatter[currentListKey];
			const nextValue = normalizeScalarValue(listItemMatch[1]);
			frontmatter[currentListKey] = Array.isArray(current)
				? [...current, nextValue]
				: [nextValue];
			continue;
		}

		const separatorIndex = line.indexOf(":");
		if (separatorIndex === -1) {
			currentListKey = null;
			continue;
		}

		const key = line.slice(0, separatorIndex).trim();
		const rawValue = line.slice(separatorIndex + 1).trim();
		if (!key) {
			currentListKey = null;
			continue;
		}
		if (!rawValue) {
			frontmatter[key] = [];
			currentListKey = key;
			continue;
		}

		frontmatter[key] = normalizeScalarValue(rawValue);
		currentListKey = null;
	}

	return { frontmatter, body: match[2], hasFrontmatter: true };
}

export function readScalar(
	frontmatter: Record<string, string | string[]>,
	key: string,
): string | undefined {
	const value = frontmatter[key];
	return typeof value === "string" ? normalizeScalarValue(value) : undefined;
}

export function parseTools(value: string | string[] | undefined): string[] | undefined {
	if (!value) return undefined;
	const tools = (Array.isArray(value) ? value : value.split(","))
		.map((tool) => normalizeScalarValue(tool))
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

export function readFirstHeading(body: string): string | undefined {
	for (const rawLine of body.split(/\r?\n/)) {
		const match = rawLine.match(/^#\s+(.+)$/);
		if (match) {
			const heading = match[1].trim();
			if (heading) return heading;
		}
	}
	return undefined;
}

export function filenameStem(filePath: string): string | undefined {
	const stem = path.basename(filePath, path.extname(filePath)).trim();
	return stem || undefined;
}

export async function readAgentMarkdown(filePath: string): Promise<string> {
	return readFile(filePath, "utf-8");
}
