import { mock } from "bun:test";

import { MockContainer, MockMarkdown, MockSpacer, MockText, parseFrontmatter } from "./test-helpers.js";

const state = {
	mockAgentDir: "/tmp",
	createAgentSessionImpl: async () => ({
		session: {
			subscribe: () => () => {},
			async prompt() {},
			async abort() {},
			dispose() {},
		},
		extensionsResult: {},
	}),
};

function resetState() {
	state.mockAgentDir = "/tmp";
	state.createAgentSessionImpl = async () => ({
		session: {
			subscribe: () => () => {},
			async prompt() {},
			async abort() {},
			dispose() {},
		},
		extensionsResult: {},
	});
}

mock.module("@mariozechner/pi-coding-agent", () => ({
	AuthStorage: {
		inMemory: () => ({}),
	},
	createAgentSession: (...args) => state.createAgentSessionImpl(...args),
	createExtensionRuntime: () => ({}),
	ModelRegistry: {
		inMemory: () => ({ getAll: () => [], find: () => undefined }),
	},
	SessionManager: {
		inMemory: () => ({ getCwd: () => process.cwd() }),
	},
	SettingsManager: {
		create: () => ({}),
		inMemory: () => ({}),
	},
	getAgentDir: () => state.mockAgentDir,
	getMarkdownTheme: () => ({}),
	parseFrontmatter,
	withFileMutationQueue: async (_filePath, operation) => await operation(),
}));

mock.module("@mariozechner/pi-ai", () => ({
	StringEnum: (_values, options = {}) => options,
}));

mock.module("typebox", () => ({
	Type: {
		Object: (value) => value,
		String: (value = {}) => value,
		Optional: (value) => value,
		Array: (value, options = {}) => ({ value, ...options }),
		Boolean: (value = {}) => value,
	},
}));

mock.module("@mariozechner/pi-tui", () => ({
	Container: MockContainer,
	Key: {
		home: "home",
		end: "end",
		up: "up",
		down: "down",
		ctrl: (key) => `ctrl-${key}`,
		alt: (key) => `alt-${key}`,
	},
	Markdown: MockMarkdown,
	Spacer: MockSpacer,
	Text: MockText,
	matchesKey: () => false,
	parseKey: () => null,
	truncateToWidth: (text) => text,
	visibleWidth: (text) => text.length,
	wrapTextWithAnsi: (text) => [text],
}));

const { default: registerPiGremlins } = await import("./index.ts");

export function resetV1ContractHarness() {
	resetState();
}

export function setMockAgentDir(path) {
	state.mockAgentDir = path;
}

export function setCreateAgentSessionImpl(impl) {
	state.createAgentSessionImpl = impl;
}

export function createExtensionHarness() {
	let registeredTool;
	const commands = new Map();
	const shortcuts = new Map();
	const handlers = new Map();
	const entries = [];
	const messages = [];
	registerPiGremlins({
		on: (event, handler) => {
			handlers.set(event, handler);
		},
		registerCommand: (name, command) => {
			commands.set(name, command);
		},
		registerShortcut: (shortcut, shortcutOptions) => {
			shortcuts.set(shortcut, shortcutOptions);
		},
		registerTool: (tool) => {
			registeredTool = tool;
		},
		appendEntry: (customType, data) => {
			entries.push({ customType, data });
		},
		sendMessage: (message) => {
			messages.push(message);
		},
	});
	return { tool: registeredTool, commands, shortcuts, handlers, entries, messages };
}

export function createRegisteredTool() {
	return createExtensionHarness().tool;
}

export function createExecutionContext(cwd) {
	return {
		cwd,
		hasUI: false,
		getSystemPrompt: () => "Parent system prompt",
		model: undefined,
		modelRegistry: {
			getAll: () => [{ provider: "openai", id: "gpt-5-mini" }],
			find: (provider, modelId) =>
				provider === "openai" && modelId === "gpt-5-mini"
					? { provider, id: modelId }
					: undefined,
		},
		ui: {
			confirm: async () => true,
			notify: () => {},
			custom: async () => {},
		},
	};
}

resetState();
