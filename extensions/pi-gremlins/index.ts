import * as path from "node:path";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@mariozechner/pi-agent-core";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
	createGremlinDiscoveryCache,
	createPrimaryAgentDiscoveryCache,
	type AgentDiscoveryDiagnostic,
	type GremlinDiscoveryCache,
	type PrimaryAgentDiscoveryCache,
} from "./gremlin-discovery.js";
import {
	renderGremlinInvocationText,
	styleGremlinInvocationText,
} from "./gremlin-rendering.js";
import {
	PiGremlinsParams,
	type GremlinInvocationDetails,
} from "./gremlin-schema.js";
import {
	executePiGremlinsTool,
	normalizeInvocationDetails,
	type PiGremlinsArgs,
} from "./gremlin-tool-execution.js";
import {
	cyclePrimaryAgent,
	notifyPrimaryAgent,
	PRIMARY_SHORTCUT,
	runPrimaryAgentCommand,
	updatePrimaryAgentStatus,
} from "./primary-agent-controls.js";
import { applyPrimaryAgentPromptInjection } from "./primary-agent-prompt.js";
import {
	clearPersistedPrimaryAgentSelection,
	readPersistedPrimaryAgentSelectionWithDiagnostics,
} from "./primary-agent-persistence.js";
import {
	createInitialPrimaryAgentState,
	getLatestPrimaryAgentSessionEntryData,
	reconstructPrimaryAgentStateFromData,
	type PrimaryAgentState,
} from "./primary-agent-state.js";

const BRAND_NAME = "Gremlins🧌";
const TOOL_NAME = "pi-gremlins";
const TOOL_DESCRIPTION = [
	"Summon specialized gremlins with isolated context.",
	"Input uses gremlins: [{ intent, agent, context, cwd? }].",
	"intent is required: concise delegation rationale or desired outcome.",
	"context is required: task details, constraints, paths, findings, and requested output.",
	"Example intent: Get independent architecture read before editing runtime code.",
	"Example context: Inspect extensions/pi-gremlins scheduler and runner flow; report risks and exact files to change.",
	"One gremlin runs single invocation. Multiple gremlins start in parallel.",
	"Gremlin definitions load from user and nearest project directories when agent_type is sub-agent.",
	"Progress stays inline and expands with Ctrl+O.",
].join(" ");

function getInvocationDetails(result: AgentToolResult<GremlinInvocationDetails>) {
	return normalizeInvocationDetails(result.details);
}

function renderCallText(params: { gremlins?: Array<{ agent?: string }> }): string {
	const names = (params.gremlins ?? []).map((gremlin) => gremlin.agent).filter(Boolean);
	if (names.length === 0) return BRAND_NAME;
	return `🕯️🔥🕯️ Summoning the gremlins: ${names.join(", ")}`;
}

function notifyDiscoveryDiagnostics(
	ctx: ExtensionContext,
	diagnostics: AgentDiscoveryDiagnostic[],
): void {
	for (const diagnostic of diagnostics) {
		ctx.ui?.notify?.(`Gremlin discovery skipped ${diagnostic.message}`, "warning");
	}
}

export interface PiGremlinsExtensionOptions {
	discoveryCache?: GremlinDiscoveryCache;
	primaryAgentDiscoveryCache?: PrimaryAgentDiscoveryCache;
}

export function createPiGremlinsExtension(options: PiGremlinsExtensionOptions = {}) {
	return function registerPiGremlins(pi: ExtensionAPI) {
		const agentsDir = path.join(getAgentDir(), "agents");
		const discovery =
			options.discoveryCache ??
			createGremlinDiscoveryCache({
				userAgentsDir: agentsDir,
			});
		const primaryAgentDiscovery =
			options.primaryAgentDiscoveryCache ??
			createPrimaryAgentDiscoveryCache({
				userAgentsDir: agentsDir,
			});
		let primaryAgentState: PrimaryAgentState = createInitialPrimaryAgentState();

		pi.on("session_start", async (_event, ctx) => {
			discovery.clear();
			primaryAgentDiscovery.clear();
			const primaryAgentDiscoveryResult = await primaryAgentDiscovery.get(ctx.cwd);
			const { agents } = primaryAgentDiscoveryResult;
			const branchSelection = getLatestPrimaryAgentSessionEntryData(
				ctx.sessionManager.getBranch(),
			);
			const persistedRead = branchSelection
				? { selection: null as null, diagnostic: undefined }
				: readPersistedPrimaryAgentSelectionWithDiagnostics(ctx.cwd);
			if (persistedRead.diagnostic) {
				notifyPrimaryAgent(ctx, persistedRead.diagnostic, "warning");
			}
			notifyDiscoveryDiagnostics(ctx, primaryAgentDiscoveryResult.diagnostics);
			primaryAgentState = reconstructPrimaryAgentStateFromData(
				branchSelection ?? persistedRead.selection,
				agents,
			);
			updatePrimaryAgentStatus(ctx, primaryAgentState);
			if (primaryAgentState.missingSelectedName) {
				clearPersistedPrimaryAgentSelection(ctx.cwd);
				notifyPrimaryAgent(
					ctx,
					`Primary agent unavailable, reset to None: ${primaryAgentState.missingSelectedName}`,
					"warning",
				);
			}
		});

		pi.on("session_shutdown", () => {
			discovery.clear();
			primaryAgentDiscovery.clear();
		});

		pi.registerCommand("gremlins:primary", {
			description: "Select current-session primary agent",
			handler: async (args, ctx) => {
				primaryAgentState = await runPrimaryAgentCommand(
					pi,
					ctx,
					primaryAgentState,
					primaryAgentDiscovery,
					args,
				);
			},
		});

		pi.registerShortcut(PRIMARY_SHORTCUT, {
			description: "Cycle primary agent",
			handler: async (ctx) => {
				primaryAgentState = await cyclePrimaryAgent(
					pi,
					ctx,
					primaryAgentState,
					primaryAgentDiscovery,
				);
			},
		});

		pi.on("before_agent_start", async (event, ctx) => {
			const injection = await applyPrimaryAgentPromptInjection({
				pi,
				event,
				ctx,
				state: primaryAgentState,
				discoveryCache: primaryAgentDiscovery,
				updateStatus: updatePrimaryAgentStatus,
				notify: notifyPrimaryAgent,
			});
			primaryAgentState = injection.state;
			return injection.result;
		});

		const tool = {
			name: TOOL_NAME,
			label: BRAND_NAME,
			description: TOOL_DESCRIPTION,
			parameters: PiGremlinsParams,

			renderCall(params: PiGremlinsArgs) {
				return new Text(renderCallText(params));
			},

			renderResult(
				result: AgentToolResult<GremlinInvocationDetails>,
				options: Parameters<typeof styleGremlinInvocationText>[2],
				theme: Parameters<typeof styleGremlinInvocationText>[1],
			) {
				if (!result.details) {
					const firstContent = result.content?.[0];
					const fallbackText =
						firstContent && "text" in firstContent ? firstContent.text : "";
					return new Text(fallbackText);
				}
				const text = renderGremlinInvocationText(getInvocationDetails(result), {
					expanded: options.expanded,
				});
				return new Text(styleGremlinInvocationText(text, theme, options));
			},

			async execute(
				_toolCallId: string,
				params: PiGremlinsArgs,
				signal: AbortSignal | undefined,
				onUpdate: AgentToolUpdateCallback<GremlinInvocationDetails> | undefined,
				ctx: ExtensionContext,
			) {
				return executePiGremlinsTool({
					params,
					signal,
					onUpdate,
					ctx,
					discovery,
					notifyDiagnostics: (diagnostics) =>
						notifyDiscoveryDiagnostics(ctx, diagnostics),
				});
			},
		};

		// FIXME: Cast kept because pi 0.69.0 + TypeBox 1.x triggers TS2589 deep-instantiation at registerTool().
		// Keep unsoundness pinned to registration boundary. Revisit after upstream typings or TS inference improves.
		pi.registerTool(tool as any);
	};
}

export default createPiGremlinsExtension();
