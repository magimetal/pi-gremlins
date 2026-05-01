import * as fs from "node:fs";
import * as path from "node:path";
import { loadSkills, type Skill } from "@mariozechner/pi-coding-agent";
import type { SideChatMode } from "./side-chat-session-factory.js";

export const SIDE_CHAT_SETTINGS_NAMESPACE = "pi-gremlins";
export const SIDE_CHAT_SETTINGS_KEY = "sideChat";
export const SIDE_CHAT_ALLOWED_TOOLS = ["read", "grep", "find", "ls"] as const;

export type SideChatApprovedTool = (typeof SIDE_CHAT_ALLOWED_TOOLS)[number];

export interface SideChatCapabilityProfile {
	tools?: SideChatApprovedTool[];
	skillPaths?: string[];
}

export interface ResolvedSideChatCapabilities {
	mode: SideChatMode;
	tools: SideChatApprovedTool[];
	skillPaths: string[];
	skills: Skill[];
	settingsPath: string;
	projectRoot: string;
}

interface SettingsRoot {
	[SIDE_CHAT_SETTINGS_NAMESPACE]?: {
		[SIDE_CHAT_SETTINGS_KEY]?: unknown;
	};
}

const ALLOWED_TOOL_SET = new Set<string>(SIDE_CHAT_ALLOWED_TOOLS);
const DEFAULT_CAPABILITY_PROFILE = Object.freeze({ tools: [], skillPaths: [] });

export class SideChatCapabilityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SideChatCapabilityError";
	}
}

function findNearestPiDir(cwd: string): string | null {
	let currentDir = path.resolve(cwd);
	while (true) {
		const candidate = path.join(currentDir, ".pi");
		try {
			if (fs.statSync(candidate).isDirectory()) return candidate;
		} catch {
			// Continue walking toward the filesystem root.
		}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function getSideChatSettingsPath(cwd: string): string {
	const nearestPiDir = findNearestPiDir(cwd);
	return path.join(nearestPiDir ?? path.join(path.resolve(cwd), ".pi"), "settings.json");
}

function readSettings(settingsPath: string): SettingsRoot {
	try {
		return JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as SettingsRoot;
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return {};
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new SideChatCapabilityError(
			`Could not read side-chat settings at ${settingsPath}: ${message}`,
		);
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function getModeProfile(settings: SettingsRoot, mode: SideChatMode): unknown {
	const namespace = settings[SIDE_CHAT_SETTINGS_NAMESPACE];
	if (namespace === undefined) return DEFAULT_CAPABILITY_PROFILE;
	if (!isPlainObject(namespace)) {
		throw new SideChatCapabilityError(
			`Invalid side-chat settings: ${SIDE_CHAT_SETTINGS_NAMESPACE} must be an object.`,
		);
	}
	const sideChat = namespace[SIDE_CHAT_SETTINGS_KEY];
	if (sideChat === undefined) return DEFAULT_CAPABILITY_PROFILE;
	if (!isPlainObject(sideChat)) {
		throw new SideChatCapabilityError(
			`Invalid side-chat settings: ${SIDE_CHAT_SETTINGS_NAMESPACE}.${SIDE_CHAT_SETTINGS_KEY} must be an object.`,
		);
	}
	const profile = sideChat[mode];
	return profile === undefined ? DEFAULT_CAPABILITY_PROFILE : profile;
}

function validateProfile(profile: unknown, mode: SideChatMode): Required<SideChatCapabilityProfile> {
	if (!isPlainObject(profile)) {
		throw new SideChatCapabilityError(
			`Invalid side-chat ${mode} profile: profile must be an object.`,
		);
	}
	const unknownKeys = Object.keys(profile).filter(
		(key) => key !== "tools" && key !== "skillPaths",
	);
	if (unknownKeys.length > 0) {
		throw new SideChatCapabilityError(
			`Invalid side-chat ${mode} profile: unknown key(s) ${unknownKeys.join(", ")}.`,
		);
	}
	return {
		tools: validateTools(profile.tools, mode),
		skillPaths: validateRawSkillPaths(profile.skillPaths, mode),
	};
}

function validateTools(value: unknown, mode: SideChatMode): SideChatApprovedTool[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new SideChatCapabilityError(
			`Invalid side-chat ${mode} tools: tools must be an array.`,
		);
	}
	const tools: SideChatApprovedTool[] = [];
	for (const tool of value) {
		if (typeof tool !== "string") {
			throw new SideChatCapabilityError(
				`Invalid side-chat ${mode} tools: tool names must be strings.`,
			);
		}
		if (!ALLOWED_TOOL_SET.has(tool)) {
			throw new SideChatCapabilityError(
				`Invalid side-chat ${mode} tool "${tool}": allowed tools are ${SIDE_CHAT_ALLOWED_TOOLS.join(", ")}.`,
			);
		}
		if (!tools.includes(tool as SideChatApprovedTool)) {
			tools.push(tool as SideChatApprovedTool);
		}
	}
	return tools;
}

function validateRawSkillPaths(value: unknown, mode: SideChatMode): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new SideChatCapabilityError(
			`Invalid side-chat ${mode} skillPaths: skillPaths must be an array.`,
		);
	}
	return value.map((entry) => {
		if (typeof entry !== "string" || entry.trim() === "") {
			throw new SideChatCapabilityError(
				`Invalid side-chat ${mode} skillPaths: skill paths must be non-empty strings.`,
			);
		}
		return entry;
	});
}

function isUnderPath(target: string, root: string): boolean {
	const normalizedRoot = path.resolve(root);
	if (target === normalizedRoot) return true;
	const prefix = normalizedRoot.endsWith(path.sep)
		? normalizedRoot
		: `${normalizedRoot}${path.sep}`;
	return target.startsWith(prefix);
}

function resolveSkillPaths(
	rawSkillPaths: string[],
	projectRoot: string,
	mode: SideChatMode,
): string[] {
	if (rawSkillPaths.length === 0) return [];
	const skillsRoot = path.join(projectRoot, ".pi", "skills");
	let resolvedSkillsRoot: string;
	try {
		resolvedSkillsRoot = fs.realpathSync(skillsRoot);
	} catch {
		throw new SideChatCapabilityError(
			`Invalid side-chat ${mode} skillPaths: project .pi/skills directory does not exist.`,
		);
	}
	const resolvedPaths: string[] = [];
	for (const rawPath of rawSkillPaths) {
		if (path.isAbsolute(rawPath)) {
			throw new SideChatCapabilityError(
				`Invalid side-chat ${mode} skillPath "${rawPath}": absolute paths are not allowed.`,
			);
		}
		const normalized = path.normalize(rawPath);
		const parts = normalized.split(path.sep);
		if (parts.includes("..")) {
			throw new SideChatCapabilityError(
				`Invalid side-chat ${mode} skillPath "${rawPath}": parent traversal is not allowed.`,
			);
		}
		if (!normalized.startsWith(path.join(".pi", "skills") + path.sep)) {
			throw new SideChatCapabilityError(
				`Invalid side-chat ${mode} skillPath "${rawPath}": paths must be under .pi/skills/.`,
			);
		}
		if (!normalized.endsWith(".md")) {
			throw new SideChatCapabilityError(
				`Invalid side-chat ${mode} skillPath "${rawPath}": skill paths must be Markdown files.`,
			);
		}
		const absolutePath = path.resolve(projectRoot, normalized);
		let realPath: string;
		try {
			const stats = fs.statSync(absolutePath);
			if (!stats.isFile()) {
				throw new SideChatCapabilityError(
					`Invalid side-chat ${mode} skillPath "${rawPath}": path is not a file.`,
				);
			}
			realPath = fs.realpathSync(absolutePath);
		} catch (error) {
			if (error instanceof SideChatCapabilityError) throw error;
			throw new SideChatCapabilityError(
				`Invalid side-chat ${mode} skillPath "${rawPath}": path does not exist or cannot be read.`,
			);
		}
		if (!isUnderPath(realPath, resolvedSkillsRoot)) {
			throw new SideChatCapabilityError(
				`Invalid side-chat ${mode} skillPath "${rawPath}": real path escapes .pi/skills/.`,
			);
		}
		if (!resolvedPaths.includes(realPath)) resolvedPaths.push(realPath);
	}
	return resolvedPaths;
}

function formatSkillDiagnostic(diagnostic: { message: string; path?: string; type: string }): string {
	return diagnostic.path
		? `${diagnostic.type} at ${diagnostic.path}: ${diagnostic.message}`
		: `${diagnostic.type}: ${diagnostic.message}`;
}

export function readSideChatCapabilities(
	cwd: string | undefined,
	mode: SideChatMode,
): ResolvedSideChatCapabilities {
	const resolvedCwd = path.resolve(cwd ?? process.cwd());
	const settingsPath = getSideChatSettingsPath(resolvedCwd);
	const projectRoot = path.dirname(path.dirname(settingsPath));
	const settings = readSettings(settingsPath);
	const profile = validateProfile(getModeProfile(settings, mode), mode);
	if (profile.skillPaths.length > 0 && !profile.tools.includes("read")) {
		throw new SideChatCapabilityError(
			`Invalid side-chat ${mode} profile: skillPaths require the read tool so the SDK can surface approved skills.`,
		);
	}
	const resolvedSkillPaths = resolveSkillPaths(profile.skillPaths, projectRoot, mode);
	const skillsResult =
		resolvedSkillPaths.length === 0
			? { skills: [], diagnostics: [] }
			: loadSkills({
					cwd: projectRoot,
					agentDir: path.join(projectRoot, ".pi"),
					skillPaths: resolvedSkillPaths,
					includeDefaults: false,
				});
	if (skillsResult.diagnostics.length > 0) {
		throw new SideChatCapabilityError(
			`Invalid side-chat ${mode} skills: ${skillsResult.diagnostics.map(formatSkillDiagnostic).join("; ")}`,
		);
	}
	return {
		mode,
		tools: profile.tools,
		skillPaths: resolvedSkillPaths,
		skills: skillsResult.skills,
		settingsPath,
		projectRoot,
	};
}
