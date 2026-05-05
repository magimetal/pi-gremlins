import * as fs from "node:fs";
import * as path from "node:path";
import {
	isPrimaryAgentSessionEntryData,
	NONE_SELECTION,
	type PrimaryAgentSessionEntryData,
} from "./primary-agent-state.js";

export const PRIMARY_AGENT_SETTINGS_NAMESPACE = "pi-gremlins";
export const PRIMARY_AGENT_SETTINGS_KEY = "primaryAgent";

interface PrimaryAgentSettingsRoot {
	[PRIMARY_AGENT_SETTINGS_NAMESPACE]?: {
		[PRIMARY_AGENT_SETTINGS_KEY]?: unknown;
	};
}

interface PrimaryAgentSettingsReadResult {
	settings: PrimaryAgentSettingsRoot;
	exists: boolean;
	diagnostic?: string;
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

function getPrimaryAgentPiDir(cwd: string): string {
	return findNearestPiDir(cwd) ?? path.join(path.resolve(cwd), ".pi");
}

function getPrimaryAgentSettingsPath(cwd: string): string {
	return path.join(getPrimaryAgentPiDir(cwd), "agents", "settings.json");
}

function getLegacyPrimaryAgentSettingsPath(cwd: string): string {
	return path.join(getPrimaryAgentPiDir(cwd), "settings.json");
}

function formatSettingsReadError(settingsPath: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `Could not read primary-agent settings at ${settingsPath}: ${message}`;
}

function isMissingFileError(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
	);
}

function isSettingsRoot(value: unknown): value is PrimaryAgentSettingsRoot {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readSettingsFile(settingsPath: string): PrimaryAgentSettingsReadResult {
	try {
		const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
		return { settings: isSettingsRoot(parsed) ? parsed : {}, exists: true };
	} catch (error) {
		if (isMissingFileError(error)) {
			return { settings: {}, exists: false };
		}
		return {
			settings: {},
			exists: true,
			diagnostic: formatSettingsReadError(settingsPath, error),
		};
	}
}

function getPrimaryAgentSelection(settings: PrimaryAgentSettingsRoot): PrimaryAgentSessionEntryData | null {
	const value = settings[PRIMARY_AGENT_SETTINGS_NAMESPACE]?.[PRIMARY_AGENT_SETTINGS_KEY];
	return isPrimaryAgentSessionEntryData(value) ? value : null;
}

function settingsDefinesPrimaryAgent(settings: PrimaryAgentSettingsRoot): boolean {
	return Object.prototype.hasOwnProperty.call(
		settings[PRIMARY_AGENT_SETTINGS_NAMESPACE] ?? {},
		PRIMARY_AGENT_SETTINGS_KEY,
	);
}

function withPrimaryAgentSelection(
	settings: PrimaryAgentSettingsRoot,
	selection: PrimaryAgentSessionEntryData,
): PrimaryAgentSettingsRoot {
	const namespace = settings[PRIMARY_AGENT_SETTINGS_NAMESPACE];
	settings[PRIMARY_AGENT_SETTINGS_NAMESPACE] = {
		...(namespace && typeof namespace === "object" ? namespace : {}),
		[PRIMARY_AGENT_SETTINGS_KEY]: selection,
	};
	return settings;
}

function writeSettingsFile(settingsPath: string, settings: PrimaryAgentSettingsRoot): void {
	fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
	fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

export function readPersistedPrimaryAgentSelectionWithDiagnostics(cwd: string): {
	selection: PrimaryAgentSessionEntryData | null;
	diagnostic?: string;
} {
	const settingsPath = getPrimaryAgentSettingsPath(cwd);
	const newRead = readSettingsFile(settingsPath);
	if (newRead.diagnostic) {
		return { selection: null, diagnostic: newRead.diagnostic };
	}

	const newSelection = getPrimaryAgentSelection(newRead.settings);
	if (newSelection) {
		return { selection: newSelection };
	}

	if (newRead.exists && settingsDefinesPrimaryAgent(newRead.settings)) {
		return { selection: null };
	}

	const legacyRead = readSettingsFile(getLegacyPrimaryAgentSettingsPath(cwd));
	if (legacyRead.diagnostic) {
		return { selection: null, diagnostic: legacyRead.diagnostic };
	}

	const legacySelection = getPrimaryAgentSelection(legacyRead.settings);
	if (!legacySelection) {
		return { selection: null };
	}

	writeSettingsFile(settingsPath, withPrimaryAgentSelection(newRead.settings, legacySelection));
	return { selection: legacySelection };
}

export function readPersistedPrimaryAgentSelection(
	cwd: string,
): PrimaryAgentSessionEntryData | null {
	return readPersistedPrimaryAgentSelectionWithDiagnostics(cwd).selection;
}

export function writePersistedPrimaryAgentSelection(
	cwd: string,
	selection: PrimaryAgentSessionEntryData,
): void {
	const settingsPath = getPrimaryAgentSettingsPath(cwd);
	const { settings } = readSettingsFile(settingsPath);
	writeSettingsFile(settingsPath, withPrimaryAgentSelection(settings, selection));
}

export function clearPersistedPrimaryAgentSelection(cwd: string): void {
	writePersistedPrimaryAgentSelection(cwd, NONE_SELECTION);
}
