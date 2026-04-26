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

function readSettingsFile(settingsPath: string): PrimaryAgentSettingsRoot {
	try {
		return JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as PrimaryAgentSettingsRoot;
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return {};
		}
		throw error;
	}
}

export function readPersistedPrimaryAgentSelection(
	cwd: string,
): PrimaryAgentSessionEntryData | null {
	const settings = readSettingsFile(getPrimaryAgentSettingsPath(cwd));
	const value = settings[PRIMARY_AGENT_SETTINGS_NAMESPACE]?.[PRIMARY_AGENT_SETTINGS_KEY];
	return isPrimaryAgentSessionEntryData(value) ? value : null;
}

export function writePersistedPrimaryAgentSelection(
	cwd: string,
	selection: PrimaryAgentSessionEntryData,
): void {
	const settingsPath = getPrimaryAgentSettingsPath(cwd);
	const settings = readSettingsFile(settingsPath);
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
