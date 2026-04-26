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

export function getPrimaryAgentSettingsPath(cwd: string): string {
	const nearestPiDir = findNearestPiDir(cwd);
	return path.join(nearestPiDir ?? path.join(path.resolve(cwd), ".pi"), "settings.json");
}

function formatSettingsReadError(settingsPath: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `Could not read primary-agent settings at ${settingsPath}: ${message}`;
}

function readSettingsFile(settingsPath: string): PrimaryAgentSettingsReadResult {
	try {
		return {
			settings: JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as PrimaryAgentSettingsRoot,
		};
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return { settings: {} };
		}
		return { settings: {}, diagnostic: formatSettingsReadError(settingsPath, error) };
	}
}

export function readPersistedPrimaryAgentSelectionWithDiagnostics(cwd: string): {
	selection: PrimaryAgentSessionEntryData | null;
	diagnostic?: string;
} {
	const { settings, diagnostic } = readSettingsFile(getPrimaryAgentSettingsPath(cwd));
	const value = settings[PRIMARY_AGENT_SETTINGS_NAMESPACE]?.[PRIMARY_AGENT_SETTINGS_KEY];
	return {
		selection: isPrimaryAgentSessionEntryData(value) ? value : null,
		diagnostic,
	};
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
	settings[PRIMARY_AGENT_SETTINGS_NAMESPACE] = {
		...(settings[PRIMARY_AGENT_SETTINGS_NAMESPACE] ?? {}),
		[PRIMARY_AGENT_SETTINGS_KEY]: selection,
	};
	fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
	fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

export function clearPersistedPrimaryAgentSelection(cwd: string): void {
	writePersistedPrimaryAgentSelection(cwd, NONE_SELECTION);
}
