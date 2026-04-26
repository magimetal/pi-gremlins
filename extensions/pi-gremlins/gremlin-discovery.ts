import * as fs from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { AgentSource } from "./agent-definition.js";
import {
	loadGremlinDefinition,
	type GremlinDefinition,
} from "./gremlin-definition.js";
import { hashString } from "./gremlin-cache-utils.js";
import {
	loadPrimaryAgentDefinition,
	type PrimaryAgentDefinition,
} from "./primary-agent-definition.js";

export interface AgentDiscoveryDiagnostic {
	filePath: string;
	message: string;
}

export interface GremlinDiscoveryResult {
	gremlins: GremlinDefinition[];
	projectAgentsDir: string | null;
	fingerprint: string;
	diagnostics: AgentDiscoveryDiagnostic[];
}

export interface GremlinDiscoveryCache {
	get(cwd: string): Promise<GremlinDiscoveryResult>;
	clear(): void;
}

export interface PrimaryAgentDiscoveryResult {
	agents: PrimaryAgentDefinition[];
	projectAgentsDir: string | null;
	fingerprint: string;
	diagnostics: AgentDiscoveryDiagnostic[];
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

interface FileFingerprintSnapshot {
	metadataSignature: string;
	fingerprintPart: string;
}

interface DirectorySnapshot {
	dir: string;
	dirSignature: string;
	files: string[];
	fileFingerprints: Map<string, FileFingerprintSnapshot>;
}

export interface AgentDiscoveryFileSystem {
	readdir(dir: string): Promise<fs.Dirent[]>;
	stat(candidatePath: string): Promise<fs.Stats>;
	readFile?(candidatePath: string, encoding: BufferEncoding): Promise<string>;
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
	readFile,
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

async function readFileContents(
	filePath: string,
	fileSystem: AgentDiscoveryFileSystem,
): Promise<string> {
	if (fileSystem.readFile) return fileSystem.readFile(filePath, "utf-8");
	return fs.promises.readFile(filePath, "utf-8");
}

function createFileMetadataSignature(fileStat: fs.Stats): string {
	return [fileStat.mtimeMs, fileStat.ctimeMs, fileStat.size].join(":");
}

async function fingerprintKnownFiles(
	files: string[],
	previousFingerprints: Map<string, FileFingerprintSnapshot>,
	fileSystem: AgentDiscoveryFileSystem,
): Promise<{
	parts: string[];
	fileFingerprints: Map<string, FileFingerprintSnapshot>;
}> {
	const nextFingerprints = new Map<string, FileFingerprintSnapshot>();
	const parts = await Promise.all(
		files.map(async (filePath) => {
			try {
				const fileStat = await fileSystem.stat(filePath);
				const metadataSignature = createFileMetadataSignature(fileStat);
				const cached = previousFingerprints.get(filePath);
				if (cached?.metadataSignature === metadataSignature) {
					nextFingerprints.set(filePath, cached);
					return cached.fingerprintPart;
				}

				const content = await readFileContents(filePath, fileSystem);
				const fingerprintPart = `${path.basename(filePath)}:${metadataSignature}:${hashString(content)}`;
				const snapshot = { metadataSignature, fingerprintPart };
				nextFingerprints.set(filePath, snapshot);
				return fingerprintPart;
			} catch {
				return `${path.basename(filePath)}:missing`;
			}
		}),
	);
	return { parts, fileFingerprints: nextFingerprints };
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
		const { parts, fileFingerprints } = await fingerprintKnownFiles(
			cached.files,
			cached.fileFingerprints,
			fileSystem,
		);
		const fingerprint = `${dir}|${parts.join(",")}`;
		snapshots.set(dir, { ...cached, fileFingerprints });
		return { dir, fingerprint, files: cached.files };
	}

	const files = await listMarkdownFiles(dir, fileSystem, includeSymlinks);
	const { parts, fileFingerprints } = await fingerprintKnownFiles(
		files,
		cached?.fileFingerprints ?? new Map(),
		fileSystem,
	);
	const fingerprint = `${dir}|${parts.join(",")}`;
	snapshots.set(dir, {
		dir,
		dirSignature,
		files,
		fileFingerprints,
	});
	return { dir, fingerprint, files };
}

function formatLoadDiagnostic(filePath: string, error: unknown): AgentDiscoveryDiagnostic {
	const message = error instanceof Error ? error.message : String(error);
	return { filePath, message: `${path.basename(filePath)}: ${message}` };
}

async function loadDefinitionsFromFiles<T>(
	files: string[],
	source: AgentSource,
	loader: (filePath: string, source: AgentSource) => Promise<T | null>,
): Promise<{ definitions: T[]; diagnostics: AgentDiscoveryDiagnostic[] }> {
	const results = await Promise.all(
		files.map(async (filePath) => {
			try {
				return { definition: await loader(filePath, source), diagnostic: null };
			} catch (error) {
				return { definition: null, diagnostic: formatLoadDiagnostic(filePath, error) };
			}
		}),
	);
	return {
		definitions: results
			.map((result) => result.definition)
			.filter((definition): definition is T => Boolean(definition)),
		diagnostics: results
			.map((result) => result.diagnostic)
			.filter((diagnostic): diagnostic is AgentDiscoveryDiagnostic => Boolean(diagnostic)),
	};
}

async function loadGremlinsFromFiles(
	files: string[],
	source: AgentSource,
): Promise<{ definitions: GremlinDefinition[]; diagnostics: AgentDiscoveryDiagnostic[] }> {
	return loadDefinitionsFromFiles(files, source, loadGremlinDefinition);
}

async function loadPrimaryAgentsFromFiles(
	files: string[],
	source: AgentSource,
): Promise<{ definitions: PrimaryAgentDefinition[]; diagnostics: AgentDiscoveryDiagnostic[] }> {
	return loadDefinitionsFromFiles(files, source, loadPrimaryAgentDefinition);
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
	loadDefinitions: (
		files: string[],
		source: AgentSource,
	) => Promise<{ definitions: T[]; diagnostics: AgentDiscoveryDiagnostic[] }>;
	toResult: (args: {
		definitions: T[];
		projectAgentsDir: string | null;
		fingerprint: string;
		diagnostics: AgentDiscoveryDiagnostic[];
	}) => TResult;
}): RoleDiscoveryCache<TResult> {
	const discoveryOptions = options.discoveryOptions ?? {};
	const fileSystem = discoveryOptions.fileSystem ?? nodeFileSystem;
	const directorySnapshots = new Map<string, DirectorySnapshot>();
	let cachedResult: TResult | null = null;
	let cachedFingerprint: string | null = null;
	let cachedProjectAgentsDir: string | null = null;
	let cachedUserAgentsDir: string | null = null;
	const inFlightDiscoveries = new Map<string, Promise<TResult>>();

	async function discover(userAgentsDir: string, projectAgentsDir: string | null) {
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

		const userLoad = await options.loadDefinitions(
			userFingerprint.files,
			"user",
		);
		const projectLoad = await options.loadDefinitions(
			projectFingerprint.files,
			"project",
		);
		cachedResult = options.toResult({
			definitions: mergeByName(userLoad.definitions, projectLoad.definitions),
			projectAgentsDir,
			fingerprint,
			diagnostics: [...userLoad.diagnostics, ...projectLoad.diagnostics],
		});
		cachedFingerprint = fingerprint;
		cachedProjectAgentsDir = projectAgentsDir;
		cachedUserAgentsDir = userAgentsDir;
		return cachedResult;
	}

	return {
		async get(cwd: string) {
			const userAgentsDir = getUserGremlinsDir(discoveryOptions);
			const projectAgentsDir = findNearestProjectAgentsDir(cwd);
			const discoveryKey = [userAgentsDir, projectAgentsDir ?? ""].join("\u001f");
			const inFlight = inFlightDiscoveries.get(discoveryKey);
			if (inFlight) return inFlight;

			const discovery = discover(userAgentsDir, projectAgentsDir).finally(() => {
				inFlightDiscoveries.delete(discoveryKey);
			});
			inFlightDiscoveries.set(discoveryKey, discovery);
			return discovery;
		},
		clear() {
			directorySnapshots.clear();
			inFlightDiscoveries.clear();
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
		toResult: ({ definitions, projectAgentsDir, fingerprint, diagnostics }) => ({
			gremlins: definitions,
			projectAgentsDir,
			fingerprint,
			diagnostics,
		}),
	});
}

export function createPrimaryAgentDiscoveryCache(
	options: AgentDiscoveryOptions = {},
): PrimaryAgentDiscoveryCache {
	return createRoleDiscoveryCache<PrimaryAgentDefinition, PrimaryAgentDiscoveryResult>({
		discoveryOptions: options,
		includeSymlinks: options.includeSymlinks ?? false,
		loadDefinitions: loadPrimaryAgentsFromFiles,
		toResult: ({ definitions, projectAgentsDir, fingerprint, diagnostics }) => ({
			agents: definitions,
			projectAgentsDir,
			fingerprint,
			diagnostics,
		}),
	});
}
