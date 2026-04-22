import * as fs from "node:fs";
import * as path from "node:path";
import type { ResolvedPaths } from "@mariozechner/pi-coding-agent";
import {
	DefaultPackageManager,
	getAgentDir,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";
import {
	type AgentConfig,
	type AgentScope,
	discoverAgentsWithPackages,
	findNearestProjectAgentsDir,
	getEnabledPackageAgentPaths,
	getUserAgentsDir,
} from "./agents.js";

export interface PackageResolutionAttempt {
	resolvedPaths?: ResolvedPaths;
	warning?: string;
}

export interface CachedAgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
	packageDiscoveryWarning?: string;
	cacheHit: boolean;
}

interface DiscoveryCacheEntry {
	result: Omit<CachedAgentDiscoveryResult, "cacheHit">;
	freshnessSignature: string;
}

const PACKAGE_FINGERPRINT_FILES = [
	"package.json",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"bun.lock",
	"bun.lockb",
] as const;

function getStatFingerprint(candidatePath: string): string {
	try {
		const stat = fs.statSync(candidatePath);
		return `${candidatePath}:${stat.mtimeMs}:${stat.size}`;
	} catch {
		return `${candidatePath}:missing`;
	}
}

function getDirEntryFingerprints(dir: string | null): string[] {
	if (!dir) return ["(none)"];
	try {
		const entries = fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.name.endsWith(".md"))
			.filter((entry) => entry.isFile() || entry.isSymbolicLink())
			.map((entry) => getStatFingerprint(path.join(dir, entry.name)))
			.sort();
		return [`dir:${dir}`, ...entries];
	} catch {
		return [`dir:${dir}:missing`];
	}
}

function findNearestPackageRoot(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		if (
			PACKAGE_FINGERPRINT_FILES.some((fileName) =>
				fs.existsSync(path.join(currentDir, fileName)),
			)
		) {
			return currentDir;
		}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

function getManifestFingerprints(manifestRoot: string | null): string[] {
	if (!manifestRoot) return ["manifest:(none)"];
	const existingFiles = PACKAGE_FINGERPRINT_FILES.map((fileName) =>
		path.join(manifestRoot, fileName),
	).filter((candidatePath) => fs.existsSync(candidatePath));
	if (existingFiles.length === 0) return [`manifest:${manifestRoot}:empty`];
	return [`manifest:${manifestRoot}`, ...existingFiles.map(getStatFingerprint)];
}

function getFreshnessSignature({
	cwd,
	agentScope,
	userAgentsDir,
	projectAgentsDir,
	packageAgentPaths,
	manifestRoot,
	warning,
}: {
	cwd: string;
	agentScope: AgentScope;
	userAgentsDir: string;
	projectAgentsDir: string | null;
	packageAgentPaths: string[];
	manifestRoot: string | null;
	warning?: string;
}): string {
	const packageAgentFingerprints =
		packageAgentPaths.length > 0
			? packageAgentPaths.map(getStatFingerprint).sort()
			: ["package-agents:(none)"];
	return JSON.stringify({
		cwd,
		agentScope,
		warning: warning ?? null,
		userAgents: getDirEntryFingerprints(userAgentsDir),
		projectAgents: getDirEntryFingerprints(projectAgentsDir),
		packageAgents: packageAgentFingerprints,
		manifests: getManifestFingerprints(manifestRoot),
	});
}

function getPackageAgentPaths(
	packageResolution: PackageResolutionAttempt,
): string[] {
	return packageResolution.resolvedPaths
		? getEnabledPackageAgentPaths(packageResolution.resolvedPaths)
		: [];
}

function createDiscoveryCacheEntry(
	cwd: string,
	agentScope: AgentScope,
	packageResolution: PackageResolutionAttempt,
): DiscoveryCacheEntry {
	const userAgentsDir = getUserAgentsDir();
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);
	const manifestRoot = findNearestPackageRoot(cwd);
	const packageAgentPaths = getPackageAgentPaths(packageResolution);
	const discovery = discoverAgentsWithPackages(
		cwd,
		agentScope,
		packageResolution.resolvedPaths,
	);
	return {
		result: {
			agents: discovery.agents,
			projectAgentsDir: discovery.projectAgentsDir,
			packageDiscoveryWarning: packageResolution.warning,
		},
		freshnessSignature: getFreshnessSignature({
			cwd,
			agentScope,
			userAgentsDir,
			projectAgentsDir,
			packageAgentPaths,
			manifestRoot,
			warning: packageResolution.warning,
		}),
	};
}

function isDiscoveryCacheEntryFresh(
	entry: DiscoveryCacheEntry,
	cwd: string,
	agentScope: AgentScope,
	packageResolution: PackageResolutionAttempt,
): boolean {
	return (
		entry.freshnessSignature ===
		getFreshnessSignature({
			cwd,
			agentScope,
			userAgentsDir: getUserAgentsDir(),
			projectAgentsDir: findNearestProjectAgentsDir(cwd),
			packageAgentPaths: getPackageAgentPaths(packageResolution),
			manifestRoot: findNearestPackageRoot(cwd),
			warning: packageResolution.warning,
		})
	);
}

/**
 * Try to resolve package paths including agents resource.
 * Returns no warning when current pi build lacks package agent support.
 */
export async function tryResolvePackagePaths(
	cwd: string,
): Promise<PackageResolutionAttempt> {
	try {
		const agentDir = getAgentDir();
		const settingsManager = SettingsManager.create(cwd, agentDir);
		const packageManager = new DefaultPackageManager({
			cwd,
			agentDir,
			settingsManager,
		});
		const resolved = await packageManager.resolve();
		if (
			"agents" in resolved &&
			Array.isArray((resolved as Record<string, unknown>).agents)
		) {
			return { resolvedPaths: resolved };
		}
		return {};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			warning: `Package agent resolution failed: ${message}`,
		};
	}
}

export function createAgentDiscoveryCache() {
	const cache = new Map<string, DiscoveryCacheEntry>();

	return {
		clear(): void {
			cache.clear();
		},
		async get(
			cwd: string,
			agentScope: AgentScope,
		): Promise<CachedAgentDiscoveryResult> {
			const cacheKey = `${cwd}::${agentScope}`;
			const packageResolution = await tryResolvePackagePaths(cwd);
			const cached = cache.get(cacheKey);
			if (
				cached &&
				isDiscoveryCacheEntryFresh(cached, cwd, agentScope, packageResolution)
			) {
				return {
					...cached.result,
					cacheHit: true,
				};
			}
			const nextEntry = createDiscoveryCacheEntry(
				cwd,
				agentScope,
				packageResolution,
			);
			cache.set(cacheKey, nextEntry);
			return {
				...nextEntry.result,
				cacheHit: false,
			};
		},
	};
}
