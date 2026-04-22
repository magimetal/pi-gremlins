import { readFile } from "node:fs/promises";
import type { GremlinSource } from "./gremlin-schema.js";

export interface GremlinFrontmatter {
	name?: string;
	description?: string;
	model?: string;
	thinking?: string;
	tools?: string[];
	body?: string;
	[key: string]: unknown;
}

export interface GremlinDefinition {
	name: string;
	description?: string;
	source: GremlinSource;
	filePath: string;
	rawMarkdown: string;
	frontmatter: GremlinFrontmatter;
}

interface ParsedFrontmatterBlock {
	frontmatter: Record<string, string | string[]>;
	body: string;
}

function normalizeScalarValue(value: string): string {
	return value.replace(/^['"]|['"]$/g, "").trim();
}

function parseFrontmatterBlock(markdown: string): ParsedFrontmatterBlock {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) {
		return { frontmatter: {}, body: markdown };
	}

	const frontmatter: Record<string, string | string[]> = {};
	let currentListKey: string | null = null;
	for (const rawLine of match[1].split("\n")) {
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

	return { frontmatter, body: match[2] };
}

function parseTools(value: string | string[] | undefined): string[] | undefined {
	if (!value) return undefined;
	const tools = (Array.isArray(value) ? value : value.split(","))
		.map((tool) => normalizeScalarValue(tool))
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function readScalar(frontmatter: Record<string, string | string[]>, key: string) {
	const value = frontmatter[key];
	return typeof value === "string" ? normalizeScalarValue(value) : undefined;
}

export function parseGremlinDefinition(
	markdown: string,
	filePath: string,
	source: GremlinSource,
): GremlinDefinition | null {
	const { frontmatter, body } = parseFrontmatterBlock(markdown);
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
	const rawMarkdown = await readFile(filePath, "utf-8");
	return parseGremlinDefinition(rawMarkdown, filePath, source);
}
