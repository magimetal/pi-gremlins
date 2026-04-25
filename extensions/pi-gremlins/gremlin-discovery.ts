import * as fs from "node:fs";
import { readdir, stat } from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { AgentSource } from "./agent-definition.js";
import {
	loadGremlinDefinition,
	type GremlinDefinition,
} from "./gremlin-definition.js";
import {
	loadPrimaryAgentDefinition,
	type PrimaryAgentDefinition,
} from "./primary-agent-definition.js";

export interface GremlinDiscoveryResult {
	gremlins: GremlinDefinition[];
	projectAgentsDir: string | null;
	fingerprint: string;
}

export interface GremlinDiscoveryCache {
	get(cwd: string): Promise<GremlinDiscoveryResult>;
	clear(): void;
}

export interface PrimaryAgentDiscoveryResult {
	agents: PrimaryAgentDefinition[];
	projectAgentsDir: string | null;
	fingerprint: string;
}

export interface PrimaryAgentDiscoveryCache {
	get(cwd: string): Promise<PrimaryAgentDiscoveryResult>;
	clear(): void;
}

interface DirectoryFingerprint {
	dir: string | null;
	fingerprint: string;
	files: string[];
}

interface DirectorySnapshot {
	dir: string;
	dirSignature: string;
	files: string[];
}

export interface AgentDiscoveryFileSystem {
	readdir(dir: string): Promise<fs.Dirent[]>;
	stat(candidatePath: string): Promise<fs.Stats>;
}

export interface AgentDiscoveryOptions {
	userAgentsDir?: string;
	fileSystem?: AgentDiscoveryFileSystem;
	includeSymlinks?: boolean;
}

export type PrimaryAgentNameResolution =
	| { status: "found"; agent: PrimaryAgentDefinition }
	| { status: "not-found" }
	| { status: "ambiguous"; matches: PrimaryAgentDefinition[] };

const nodeFileSystem: AgentDiscoveryFileSystem = {
	readdir: (dir) => readdir(dir, { withFileTypes: true }),
	stat,
};

export function getUserGremlinsDir(options: AgentDiscoveryOptions = {}): string {
	return options.userAgentsDir ?? path.join(getAgentDir(), "agents");
}

function isDirectory(candidatePath: string): boolean {
	try {
		return fs.statSync(candidatePath).isDirectory();
	} catch {
		return false;
	}
}

export function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = path.resolve(cwd);
	while (true) {
		const candidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

async function listMarkdownFiles(
	dir: string,
	fileSystem: AgentDiscoveryFileSystem,
	includeSymlinks: boolean,
): Promise<string[]> {
	try {
		const entries = await fileSystem.readdir(dir);
		return entries
			.filter((entry) => entry.name.endsWith(".md"))
			.filter((entry) => entry.isFile() || (includeSymlinks && entry.isSymbolicLink()))
			.map((entry) => path.join(dir, entry.name))
			.sort();
	} catch {
		return [];
	}
}

function createDirectorySignature(dirStat: fs.Stats): string {
	return [dirStat.mtimeMs, dirStat.ctimeMs, dirStat.size].join(":");
}

async function fingerprintKnownFiles(
	files: string[],
	fileSystem: AgentDiscoveryFileSystem,
): Promise<string[]> {
	return Promise.all(
		files.map(async (filePath) => {
			try {
				const fileStat = await fileSystem.stat(filePath);
				return `${path.basename(filePath)}:${fileStat.mtimeMs}:${fileStat.size}`;
			} catch {
				return `${path.basename(filePath)}:missing`;
			}
		}),
	);
}

async function fingerprintDirectory(
	dir: string | null,
	snapshots: Map<string, DirectorySnapshot>,
	fileSystem: AgentDiscoveryFileSystem,
	includeSymlinks: boolean,
): Promise<DirectoryFingerprint> {
	if (!dir) {
		return { dir: null, fingerprint: "none", files: [] };
	}

	let dirStat: fs.Stats;
	try {
		dirStat = await fileSystem.stat(dir);
		if (!dirStat.isDirectory()) throw new Error("not a directory");
	} catch {
		snapshots.delete(dir);
		return { dir, fingerprint: `${dir}|missing`, files: [] };
	}

	const dirSignature = createDirectorySignature(dirStat);
	const cached = snapshots.get(dir);
	if (cached && cached.dirSignature === dirSignature) {
		const parts = await fingerprintKnownFiles(cached.files, fileSystem);
		const fingerprint = `${dir}|${parts.join(",")}`;
		return { dir, fingerprint, files: cached.files };
	}

	const files = await listMarkdownFiles(dir, fileSystem, includeSymlinks);
	const parts = await fingerprintKnownFiles(files, fileSystem);
	const fingerprint = `${dir}|${parts.join(",")}`;
	snapshots.set(dir, {
		dir,
		dirSignature,
		files,
	});
	return { dir, fingerprint, files };
}

async function loadGremlinsFromFiles(
	files: string[],
	source: AgentSource,
): Promise<GremlinDefinition[]> {
	const definitions = await Promise.all(
		files.map(async (filePath) => {
			try {
				return await loadGremlinDefinition(filePath, source);
			} catch {
				return null;
			}
		}),
	);
	return definitions.filter((definition): definition is GremlinDefinition => Boolean(definition));
}

async function loadPrimaryAgentsFromFiles(
	files: string[],
	source: AgentSource,
): Promise<PrimaryAgentDefinition[]> {
	const definitions = await Promise.all(
		files.map(async (filePath) => {
			try {
				return await loadPrimaryAgentDefinition(filePath, source);
			} catch {
				return null;
			}
		}),
	);
	return definitions.filter((definition): definition is PrimaryAgentDefinition => Boolean(definition));
}

function mergeByName<T extends { name: string }>(
	userDefinitions: T[],
	projectDefinitions: T[],
): T[] {
	const merged = new Map<string, T>();
	for (const definition of userDefinitions) merged.set(definition.name, definition);
	for (const definition of projectDefinitions) merged.set(definition.name, definition);
	return Array.from(merged.values()).sort((left, right) =>
		left.name.localeCompare(right.name),
	);
}

export function resolveGremlinByName(
	gremlins: GremlinDefinition[],
	requestedName: string,
): GremlinDefinition | null {
	const exactMatch = gremlins.find((gremlin) => gremlin.name === requestedName);
	if (exactMatch) return exactMatch;
	const normalizedRequestedName = requestedName.toLowerCase();
	return (
		gremlins.find(
			(gremlin) => gremlin.name.toLowerCase() === normalizedRequestedName,
		) ?? null
	);
}

export function resolvePrimaryAgentByName(
	agents: PrimaryAgentDefinition[],
	requestedName: string,
): PrimaryAgentNameResolution {
	const exactMatch = agents.find((agent) => agent.name === requestedName);
	if (exactMatch) return { status: "found", agent: exactMatch };

	const normalizedRequestedName = requestedName.toLowerCase();
	const matches = agents.filter(
		(agent) => agent.name.toLowerCase() === normalizedRequestedName,
	);
	if (matches.length === 1) return { status: "found", agent: matches[0] };
	if (matches.length > 1) return { status: "ambiguous", matches };
	return { status: "not-found" };
}

interface RoleDiscoveryCache<TResult> {
	get(cwd: string): Promise<TResult>;
	clear(): void;
}

function createRoleDiscoveryCache<T extends { name: string }, TResult>(options: {
	discoveryOptions?: AgentDiscoveryOptions;
	includeSymlinks: boolean;
	loadDefinitions: (files: string[], source: AgentSource) => Promise<T[]>;
	toResult: (args: {
		definitions: T[];
		projectAgentsDir: string | null;
		fingerprint: string;
	}) => TResult;
}): RoleDiscoveryCache<TResult> {
	const discoveryOptions = options.discoveryOptions ?? {};
	const fileSystem = discoveryOptions.fileSystem ?? nodeFileSystem;
	const directorySnapshots = new Map<string, DirectorySnapshot>();
	let cachedResult: TResult | null = null;
	let cachedFingerprint: string | null = null;
	let cachedProjectAgentsDir: string | null = null;
	let cachedUserAgentsDir: string | null = null;

	return {
		async get(cwd: string) {
			const userAgentsDir = getUserGremlinsDir(discoveryOptions);
			const projectAgentsDir = findNearestProjectAgentsDir(cwd);
			const userFingerprint = await fingerprintDirectory(
				userAgentsDir,
				directorySnapshots,
				fileSystem,
				options.includeSymlinks,
			);
			const projectFingerprint = await fingerprintDirectory(
				projectAgentsDir,
				directorySnapshots,
				fileSystem,
				options.includeSymlinks,
			);
			const fingerprint = [userFingerprint.fingerprint, projectFingerprint.fingerprint].join(
				"::",
			);
			if (
				cachedResult &&
				cachedFingerprint === fingerprint &&
				cachedProjectAgentsDir === projectAgentsDir &&
				cachedUserAgentsDir === userAgentsDir
			) {
				return cachedResult;
			}

			const userDefinitions = await options.loadDefinitions(
				userFingerprint.files,
				"user",
			);
			const projectDefinitions = await options.loadDefinitions(
				projectFingerprint.files,
				"project",
			);
			cachedResult = options.toResult({
				definitions: mergeByName(userDefinitions, projectDefinitions),
				projectAgentsDir,
				fingerprint,
			});
			cachedFingerprint = fingerprint;
			cachedProjectAgentsDir = projectAgentsDir;
			cachedUserAgentsDir = userAgentsDir;
			return cachedResult;
		},
		clear() {
			directorySnapshots.clear();
			cachedResult = null;
			cachedFingerprint = null;
			cachedProjectAgentsDir = null;
			cachedUserAgentsDir = null;
		},
	};
}

export function createGremlinDiscoveryCache(
	options: AgentDiscoveryOptions = {},
): GremlinDiscoveryCache {
	return createRoleDiscoveryCache<GremlinDefinition, GremlinDiscoveryResult>({
		discoveryOptions: options,
		includeSymlinks: options.includeSymlinks ?? true,
		loadDefinitions: loadGremlinsFromFiles,
		toResult: ({ definitions, projectAgentsDir, fingerprint }) => ({
			gremlins: definitions,
			projectAgentsDir,
			fingerprint,
		}),
	}) as GremlinDiscoveryCache;
}

export function createPrimaryAgentDiscoveryCache(
	options: AgentDiscoveryOptions = {},
): PrimaryAgentDiscoveryCache {
	return createRoleDiscoveryCache<PrimaryAgentDefinition, PrimaryAgentDiscoveryResult>({
		discoveryOptions: options,
		includeSymlinks: options.includeSymlinks ?? false,
		loadDefinitions: loadPrimaryAgentsFromFiles,
		toResult: ({ definitions, projectAgentsDir, fingerprint }) => ({
			agents: definitions,
			projectAgentsDir,
			fingerprint,
		}),
	}) as PrimaryAgentDiscoveryCache;
}
