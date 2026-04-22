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
}

export interface GremlinDiscoveryOptions {
	userAgentsDir?: string;
}

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

async function listMarkdownFiles(dir: string): Promise<string[]> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		return entries
			.filter((entry) => entry.name.endsWith(".md"))
			.filter((entry) => entry.isFile() || entry.isSymbolicLink())
			.map((entry) => path.join(dir, entry.name))
			.sort();
	} catch {
		return [];
	}
}

async function fingerprintDirectory(
	dir: string | null,
): Promise<DirectoryFingerprint> {
	if (!dir) {
		return { dir: null, fingerprint: "none" };
	}
	const files = await listMarkdownFiles(dir);
	const parts = await Promise.all(
		files.map(async (filePath) => {
			try {
				const fileStat = await stat(filePath);
				return `${path.basename(filePath)}:${fileStat.mtimeMs}`;
			} catch {
				return `${path.basename(filePath)}:missing`;
			}
		}),
	);
	return {
		dir,
		fingerprint: `${dir}|${parts.join(",")}`,
	};
}

async function loadGremlinsFromDir(
	dir: string | null,
	source: "user" | "project",
): Promise<GremlinDefinition[]> {
	if (!dir) return [];
	const files = await listMarkdownFiles(dir);
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
	let cachedResult: GremlinDiscoveryResult | null = null;
	let cachedFingerprint: string | null = null;
	let cachedProjectAgentsDir: string | null = null;
	let cachedUserAgentsDir: string | null = null;

	return {
		async get(cwd: string) {
			const userAgentsDir = getUserGremlinsDir(options);
			const projectAgentsDir = findNearestProjectAgentsDir(cwd);
			const userFingerprint = await fingerprintDirectory(userAgentsDir);
			const projectFingerprint = await fingerprintDirectory(projectAgentsDir);
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

			const userGremlins = await loadGremlinsFromDir(userAgentsDir, "user");
			const projectGremlins = await loadGremlinsFromDir(
				projectAgentsDir,
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
			cachedResult = null;
			cachedFingerprint = null;
			cachedProjectAgentsDir = null;
			cachedUserAgentsDir = null;
		},
	};
}
