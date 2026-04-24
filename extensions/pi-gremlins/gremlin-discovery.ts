import * as fs from "node:fs";
import { readdir, stat } from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import {
	loadGremlinDefinition,
	type GremlinDefinition,
} from "./gremlin-definition.js";

export interface GremlinDiscoveryResult {
	gremlins: GremlinDefinition[];
	projectAgentsDir: string | null;
	fingerprint: string;
}

export interface GremlinDiscoveryCache {
	get(cwd: string): Promise<GremlinDiscoveryResult>;
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

export interface GremlinDiscoveryFileSystem {
	readdir(dir: string): Promise<fs.Dirent[]>;
	stat(candidatePath: string): Promise<fs.Stats>;
}

export interface GremlinDiscoveryOptions {
	userAgentsDir?: string;
	fileSystem?: GremlinDiscoveryFileSystem;
}

const nodeFileSystem: GremlinDiscoveryFileSystem = {
	readdir: (dir) => readdir(dir, { withFileTypes: true }),
	stat,
};

export function getUserGremlinsDir(options: GremlinDiscoveryOptions = {}): string {
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
	fileSystem: GremlinDiscoveryFileSystem,
): Promise<string[]> {
	try {
		const entries = await fileSystem.readdir(dir);
		return entries
			.filter((entry) => entry.name.endsWith(".md"))
			.filter((entry) => entry.isFile() || entry.isSymbolicLink())
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
	fileSystem: GremlinDiscoveryFileSystem,
): Promise<string[]> {
	return Promise.all(
		files.map(async (filePath) => {
			try {
				const fileStat = await fileSystem.stat(filePath);
				return `${path.basename(filePath)}:${fileStat.mtimeMs}`;
			} catch {
				return `${path.basename(filePath)}:missing`;
			}
		}),
	);
}

async function fingerprintDirectory(
	dir: string | null,
	snapshots: Map<string, DirectorySnapshot>,
	fileSystem: GremlinDiscoveryFileSystem,
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

	const files = await listMarkdownFiles(dir, fileSystem);
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
	source: "user" | "project",
): Promise<GremlinDefinition[]> {
	const definitions = await Promise.all(
		files.map((filePath) => loadGremlinDefinition(filePath, source)),
	);
	return definitions.filter((definition): definition is GremlinDefinition => Boolean(definition));
}

function mergeGremlins(
	userGremlins: GremlinDefinition[],
	projectGremlins: GremlinDefinition[],
): GremlinDefinition[] {
	const merged = new Map<string, GremlinDefinition>();
	for (const gremlin of userGremlins) merged.set(gremlin.name, gremlin);
	for (const gremlin of projectGremlins) merged.set(gremlin.name, gremlin);
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

export function createGremlinDiscoveryCache(
	options: GremlinDiscoveryOptions = {},
): GremlinDiscoveryCache {
	const fileSystem = options.fileSystem ?? nodeFileSystem;
	const directorySnapshots = new Map<string, DirectorySnapshot>();
	let cachedResult: GremlinDiscoveryResult | null = null;
	let cachedFingerprint: string | null = null;
	let cachedProjectAgentsDir: string | null = null;
	let cachedUserAgentsDir: string | null = null;

	return {
		async get(cwd: string) {
			const userAgentsDir = getUserGremlinsDir(options);
			const projectAgentsDir = findNearestProjectAgentsDir(cwd);
			const userFingerprint = await fingerprintDirectory(
				userAgentsDir,
				directorySnapshots,
				fileSystem,
			);
			const projectFingerprint = await fingerprintDirectory(
				projectAgentsDir,
				directorySnapshots,
				fileSystem,
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

			const userGremlins = await loadGremlinsFromFiles(
				userFingerprint.files,
				"user",
			);
			const projectGremlins = await loadGremlinsFromFiles(
				projectFingerprint.files,
				"project",
			);
			cachedResult = {
				gremlins: mergeGremlins(userGremlins, projectGremlins),
				projectAgentsDir,
				fingerprint,
			};
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
