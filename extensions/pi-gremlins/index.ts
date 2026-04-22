/**
 * pi-gremlins tool for isolated gremlin runs.
 *
 * Spawns a separate `pi` process for each pi-gremlins invocation,
 * preserving single, parallel, and chain modes with fresh isolated context.
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { StringEnum } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { type OverlayHandle, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
	type AgentConfig,
	type AgentScope,
	resolveAgentByName,
} from "./agents.js";
import {
	executeChainMode,
	executeParallelMode,
	executeSingleMode,
	type PiGremlinsToolResult,
	type SteerableGremlinSession,
} from "./execution-modes.js";
import {
	createPendingResult,
	getInvocationStatus,
	type InvocationMode,
	type PiGremlinsDetails,
	type SingleResult,
} from "./execution-shared.js";
import {
	createInvocationUpdateController,
	type InvocationSnapshot,
	pruneInvocationRegistry,
} from "./invocation-state.js";
import { createAgentDiscoveryCache } from "./package-discovery.js";
import { renderPiGremlinsResult } from "./result-rendering.js";
import { runSingleAgent } from "./single-agent-runner.js";
import { formatToolCall } from "./tool-call-formatting.js";
import {
	formatAvailableAgents,
	formatPackageDiscoveryWarningText,
	getAgentSetupHint,
} from "./tool-text.js";
import { getViewerOpenAction } from "./viewer-open-action.js";
import { PiGremlinsViewerOverlay } from "./viewer-overlay.js";
import { getViewerOverlayOptions } from "./viewer-result-navigation.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const BRAND_NAME = "Gremlins🧌";
const VIEWER_COMMAND = "gremlins:view";
const STEER_COMMAND = "gremlins:steer";
const NO_INVOCATION_TEXT = `No ${BRAND_NAME} run available in this session.`;
const STEER_USAGE_TEXT = `Usage: /${STEER_COMMAND} <gremlin-id> <message>`;

interface ActiveGremlinSessionRecord {
	toolCallId: string;
	agent: string;
	session: SteerableGremlinSession;
}

interface ViewerOverlayRuntime {
	invocationId: string;
	handle?: OverlayHandle;
	refresh?: () => void;
	close?: () => void;
	finish?: () => void;
	closed?: boolean;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(
		Type.String({ description: "Working directory for the agent process" }),
	),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({
		description: "Task with optional {previous} placeholder for prior output",
	}),
	cwd: Type.Optional(
		Type.String({ description: "Working directory for the agent process" }),
	),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description:
		'Which gremlin directories to use. Default: "user". Use "both" to include repo-local .pi/agents gremlins.',
	default: "user",
});

const PiGremlinsParams = Type.Object({
	agent: Type.Optional(
		Type.String({
			description: "Name of the agent to invoke (for single mode)",
		}),
	),
	task: Type.Optional(
		Type.String({ description: "Task to delegate (for single mode)" }),
	),
	tasks: Type.Optional(
		Type.Array(TaskItem, {
			description: "Array of {agent, task} for parallel execution",
		}),
	),
	chain: Type.Optional(
		Type.Array(ChainItem, {
			description: "Array of {agent, task} for sequential execution",
		}),
	),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({
			description:
				"Prompt before running project-local gremlins. Default: true.",
			default: true,
		}),
	),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for the agent process (single mode)",
		}),
	),
});

export default function (pi: ExtensionAPI) {
	const agentDiscoveryCache = createAgentDiscoveryCache();
	const invocationRegistry = new Map<string, InvocationSnapshot>();
	const activeGremlinSessions = new Map<string, ActiveGremlinSessionRecord>();
	let latestToolCallId: string | null = null;
	let viewerOverlayRuntime: ViewerOverlayRuntime | null = null;
	let nextGremlinOrdinal = 1;

	const hasViewerSnapshot = (toolCallId: string | undefined): boolean => {
		return toolCallId ? invocationRegistry.has(toolCallId) : false;
	};

	const findGremlinResult = (gremlinId: string) => {
		const snapshots = Array.from(invocationRegistry.values()).reverse();
		for (const snapshot of snapshots) {
			const result = snapshot.results.find(
				(candidate) => candidate.gremlinId === gremlinId,
			);
			if (result) return { snapshot, result };
		}
		return null;
	};

	const publishInvocationSnapshot = (
		toolCallId: string,
		snapshot: InvocationSnapshot,
	): void => {
		invocationRegistry.set(toolCallId, snapshot);
		pruneInvocationRegistry(
			invocationRegistry,
			new Set(
				[latestToolCallId, viewerOverlayRuntime?.invocationId].filter(
					Boolean,
				) as string[],
			),
		);
		if (viewerOverlayRuntime?.invocationId === toolCallId) {
			viewerOverlayRuntime.refresh?.();
		}
	};

	const focusViewerOverlay = () => {
		const handle = viewerOverlayRuntime?.handle;
		if (!handle) return;
		handle.setHidden(false);
		handle.focus();
		viewerOverlayRuntime?.refresh?.();
	};

	const dismissViewerOverlay = () => {
		viewerOverlayRuntime?.close?.();
		viewerOverlayRuntime = null;
	};

	const clearViewerState = () => {
		dismissViewerOverlay();
		latestToolCallId = null;
		nextGremlinOrdinal = 1;
		activeGremlinSessions.clear();
		invocationRegistry.clear();
		agentDiscoveryCache.clear();
	};

	const openViewer = async (ctx: ExtensionCommandContext) => {
		if (!ctx.hasUI) return;
		switch (getViewerOpenAction(viewerOverlayRuntime)) {
			case "focus-existing":
				focusViewerOverlay();
				return;
			case "await-existing":
				return;
			case "open-new":
			default:
				break;
		}
		const targetInvocationId = latestToolCallId;
		if (!targetInvocationId || !invocationRegistry.has(targetInvocationId)) {
			ctx.ui.notify(NO_INVOCATION_TEXT, "warning");
			return;
		}

		const runtime: ViewerOverlayRuntime = { invocationId: targetInvocationId };
		const closeRuntime = () => {
			if (runtime.closed) return;
			runtime.closed = true;
			runtime.handle?.hide();
			if (viewerOverlayRuntime === runtime) viewerOverlayRuntime = null;
			runtime.finish?.();
		};

		runtime.close = closeRuntime;
		viewerOverlayRuntime = runtime;

		void ctx.ui
			.custom<void>(
				async (tui, theme, keybindings, done) => {
					runtime.finish = () => {
						done();
					};
					const overlay = new PiGremlinsViewerOverlay(
						tui,
						theme,
						keybindings,
						() => invocationRegistry.get(targetInvocationId),
						() => {
							dismissViewerOverlay();
						},
					);
					overlay.focused = runtime.handle?.isFocused() ?? true;
					runtime.refresh = () => {
						overlay.focused = runtime.handle?.isFocused() ?? false;
						overlay.refresh();
					};
					runtime.close = () => {
						closeRuntime();
					};
					if (runtime.closed) done();
					return overlay;
				},
				{
					overlay: true,
					overlayOptions: getViewerOverlayOptions(),
					onHandle: (handle) => {
						runtime.handle = handle;
						handle.focus();
						if (runtime.closed) closeRuntime();
					},
				},
			)
			.catch((error) => {
				if (viewerOverlayRuntime === runtime) viewerOverlayRuntime = null;
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			});
	};

	pi.on("session_start", () => {
		clearViewerState();
	});

	pi.on("session_shutdown", () => {
		clearViewerState();
	});

	pi.registerTool({
		name: "pi-gremlins",
		label: BRAND_NAME,
		description: [
			"Summon specialized gremlins with isolated context.",
			"Modes: single (one gremlin), parallel (many gremlins), chain (gremlins passing {previous} output along).",
			"Gremlin definitions still come from ~/.pi/agent/agents by default.",
			'Use agentScope: "both" or "project" to include repo-local .pi/agents gremlins.',
		].join(" "),
		parameters: PiGremlinsParams,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = await agentDiscoveryCache.get(ctx.cwd, agentScope);
			const packageDiscoveryWarning = discovery.packageDiscoveryWarning;
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
			let mode: InvocationMode = "single";
			if (hasChain) mode = "chain";
			else if (hasTasks) mode = "parallel";

			const makeDetails =
				(mode: InvocationMode) =>
				(results: SingleResult[]): PiGremlinsDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
				});
			const invocationUpdates = createInvocationUpdateController(
				(invocationId) => invocationRegistry.get(invocationId),
				publishInvocationSnapshot,
				(partial) => onUpdate?.(partial),
			);
			const updateInvocation = (
				invocationId: string,
				details: PiGremlinsDetails,
				status = getInvocationStatus(details.mode, details.results),
			) => {
				return invocationUpdates.publishDetails(invocationId, details, status);
			};
			const handleInvocationUpdate = (
				partial: AgentToolResult<PiGremlinsDetails>,
			) => invocationUpdates.applyPartial(toolCallId, partial);
			const readInvocationStatus = () =>
				invocationRegistry.get(toolCallId)?.status;
			const publishInvocationDetails = (
				details: PiGremlinsDetails,
				status = getInvocationStatus(details.mode, details.results),
			) => {
				updateInvocation(toolCallId, details, status);
			};
			const allocateGremlinId = () => `g${nextGremlinOrdinal++}`;
			const steerableSessionCallbacks = {
				register: (gremlinId: string, session: SteerableGremlinSession) => {
					const knownGremlin = findGremlinResult(gremlinId);
					activeGremlinSessions.set(gremlinId, {
						toolCallId,
						agent: knownGremlin?.result.agent ?? "unknown",
						session,
					});
				},
				unregister: (gremlinId: string) => {
					activeGremlinSessions.delete(gremlinId);
				},
			};
			const finalizeResult = (
				result: PiGremlinsToolResult,
			): PiGremlinsToolResult => {
				const snapshot = invocationRegistry.get(toolCallId);
				if (!snapshot) return result;
				return { ...result, details: snapshot };
			};

			if (modeCount !== 1) {
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nAvailable gremlins: ${formatAvailableAgents(agents)}\n${getAgentSetupHint()}${formatPackageDiscoveryWarningText(packageDiscoveryWarning)}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			if (
				(agentScope === "project" || agentScope === "both") &&
				confirmProjectAgents &&
				ctx.hasUI
			) {
				const requestedAgentNames = new Set<string>();
				if (params.chain) {
					for (const step of params.chain) requestedAgentNames.add(step.agent);
				}
				if (params.tasks) {
					for (const task of params.tasks) requestedAgentNames.add(task.agent);
				}
				if (params.agent) requestedAgentNames.add(params.agent);

				const projectAgentsRequested = Array.from(
					new Map(
						Array.from(requestedAgentNames)
							.map((name) => resolveAgentByName(agents, name).agent)
							.filter(
								(agent): agent is AgentConfig => agent?.source === "project",
							)
							.map((agent) => [agent.filePath, agent]),
					).values(),
				);

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested
						.map((agent) => agent.name)
						.join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run project-local gremlins?",
						`Gremlins: ${names}\nSource: ${dir}\n\nProject gremlins are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok) {
						let canceledMode: InvocationMode = "single";
						if (hasChain) canceledMode = "chain";
						else if (hasTasks) canceledMode = "parallel";
						return {
							content: [
								{
									type: "text",
									text: "Canceled: project-local gremlins not approved.",
								},
							],
							details: makeDetails(canceledMode)([]),
						};
					}
				}
			}

			if (params.tasks && params.tasks.length > MAX_PARALLEL_TASKS) {
				const details = makeDetails("parallel")([]);
				return {
					content: [
						{
							type: "text",
							text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
						},
					],
					details,
				};
			}

			latestToolCallId = toolCallId;
			updateInvocation(toolCallId, makeDetails(mode)([]), "Running");
			let singleGremlinId: string | undefined;
			if (params.agent && params.task) {
				singleGremlinId = allocateGremlinId();
				updateInvocation(
					toolCallId,
					makeDetails("single")([
						createPendingResult(
							params.agent,
							params.task,
							undefined,
							"unknown",
							singleGremlinId,
						),
					]),
					"Running",
				);
			}

			if (params.chain && params.chain.length > 0) {
				return finalizeResult(
					await executeChainMode({
						chain: params.chain,
						ctxCwd: ctx.cwd,
						agents,
						signal,
						runSingleAgent,
						handleInvocationUpdate,
						makeDetails,
						readInvocationStatus,
						publishInvocationDetails,
						allocateGremlinId,
						packageDiscoveryWarning,
						steerableSessionCallbacks,
					}),
				);
			}

			if (params.tasks && params.tasks.length > 0) {
				return finalizeResult(
					await executeParallelMode({
						tasks: params.tasks,
						ctxCwd: ctx.cwd,
						agents,
						signal,
						runSingleAgent,
						handleInvocationUpdate,
						readInvocationStatus,
						publishInvocationDetails,
						makeDetails,
						allocateGremlinId,
						maxConcurrency: MAX_CONCURRENCY,
						mapWithConcurrencyLimit,
						packageDiscoveryWarning,
						steerableSessionCallbacks,
					}),
				);
			}

			if (params.agent && params.task && singleGremlinId) {
				return finalizeResult(
					await executeSingleMode({
						agent: params.agent,
						task: params.task,
						cwd: params.cwd,
						ctxCwd: ctx.cwd,
						agents,
						signal,
						runSingleAgent,
						handleInvocationUpdate,
						readInvocationStatus,
						publishInvocationDetails,
						makeDetails,
						packageDiscoveryWarning,
						gremlinId: singleGremlinId,
						steerableSessionCallbacks,
					}),
				);
			}

			return {
				content: [
					{
						type: "text",
						text: `Invalid parameters. Available gremlins: ${formatAvailableAgents(agents)}\n${getAgentSetupHint()}${formatPackageDiscoveryWarningText(packageDiscoveryWarning)}`,
					},
				],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme, _context) {
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold(`${BRAND_NAME} `)) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					const preview =
						cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", step.agent) +
						theme.fg("dim", ` ${preview}`);
				}
				if (args.chain.length > 3) {
					text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				}
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold(`${BRAND_NAME} `)) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const task of args.tasks.slice(0, 3)) {
					const preview =
						task.task.length > 40 ? `${task.task.slice(0, 40)}...` : task.task;
					text += `\n  ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) {
					text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				}
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			let preview = "...";
			if (args.task) {
				preview =
					args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task;
			}
			let text =
				theme.fg("toolTitle", theme.bold(`${BRAND_NAME} `)) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, context) {
			return renderPiGremlinsResult(result, { expanded }, theme, context, {
				hasViewerSnapshot,
				formatToolCall,
			});
		},
	});

	pi.registerCommand(VIEWER_COMMAND, {
		description: `Open popup lair for latest ${BRAND_NAME} run in this session.`,
		handler: async (_args, ctx) => {
			await openViewer(ctx);
		},
	});

	pi.registerCommand(STEER_COMMAND, {
		description: `Steer one active ${BRAND_NAME} run by gremlin id.`,
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			const argText = Array.isArray(args) ? args.join(" ") : args;
			const argParts = argText.trim() ? argText.trim().split(/\s+/) : [];
			const gremlinId = argParts[0]?.trim();
			const message = argParts.slice(1).join(" ").trim();
			if (!gremlinId || !message) {
				ctx.ui.notify(STEER_USAGE_TEXT, "error");
				return;
			}

			const activeSession = activeGremlinSessions.get(gremlinId);
			if (!activeSession) {
				const knownGremlin = findGremlinResult(gremlinId);
				if (!knownGremlin) {
					ctx.ui.notify(`Unknown gremlin id: ${gremlinId}.`, "error");
					return;
				}
				const inactiveMessage =
					knownGremlin.snapshot.status === "Running"
						? `Gremlin ${gremlinId} is no longer steerable.`
						: `Gremlin ${gremlinId} is no longer active.`;
				ctx.ui.notify(inactiveMessage, "error");
				return;
			}

			try {
				await activeSession.session.steer(message);
				ctx.ui.notify(
					`Steered ${gremlinId} (${activeSession.agent}): ${message}`,
					"info",
				);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});
}
