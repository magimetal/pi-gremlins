import * as fs from "node:fs";
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
	resolveGremlinByName,
} from "./gremlin-discovery.js";
import {
	renderGremlinInvocationText,
	styleGremlinInvocationText,
} from "./gremlin-rendering.js";
import { runSingleGremlin } from "./gremlin-runner.js";
import {
	PiGremlinsParams,
	type GremlinInvocationDetails,
	type GremlinRequest,
} from "./gremlin-schema.js";
import { runGremlinBatch } from "./gremlin-scheduler.js";
import { buildGremlinProgressSummary } from "./gremlin-summary.js";

const BRAND_NAME = "Gremlins🧌";
const TOOL_NAME = "pi-gremlins";
const TOOL_DESCRIPTION = [
	"Summon specialized gremlins with isolated context.",
	"Input uses gremlins: [{ agent, context, cwd? }].",
	"One gremlin runs single invocation. Multiple gremlins start in parallel.",
	"Gremlin definitions load from user and nearest project directories.",
	"Progress stays inline and expands with Ctrl+O.",
].join(" ");

function normalizeInvocationDetails(
	details?: Partial<GremlinInvocationDetails>,
): GremlinInvocationDetails {
	return {
		requestedCount: details?.requestedCount ?? 0,
		activeCount: details?.activeCount ?? 0,
		completedCount: details?.completedCount ?? 0,
		failedCount: details?.failedCount ?? 0,
		canceledCount: details?.canceledCount ?? 0,
		gremlins: details?.gremlins ?? [],
		revision: details?.revision,
	};
}

function getInvocationDetails(result: AgentToolResult<any>) {
	return normalizeInvocationDetails(result.details);
}

function renderCallText(params: { gremlins?: Array<{ agent?: string }> }): string {
	const names = (params.gremlins ?? []).map((gremlin) => gremlin.agent).filter(Boolean);
	if (names.length === 0) return BRAND_NAME;
	return `${BRAND_NAME} ${names.join(", ")}`;
}

function resolveGremlinCwd(
	requestCwd: string | undefined,
	baseCwd: string,
): string | undefined {
	if (!requestCwd) return undefined;
	return path.isAbsolute(requestCwd)
		? requestCwd
		: path.resolve(baseCwd, requestCwd);
}

function validateGremlinRequest(request: GremlinRequest): string | null {
	if (!request.agent?.trim()) return "Gremlin agent is required";
	if (!request.context?.trim()) return "Gremlin context is required";
	if (!request.cwd) return null;
	try {
		if (!fs.statSync(request.cwd).isDirectory()) {
			return `Invalid gremlin cwd: ${request.cwd}`;
		}
	} catch {
		return `Invalid gremlin cwd: ${request.cwd}`;
	}
	return null;
}

function createFailedGremlinResult(
	request: GremlinRequest,
	gremlinId: string,
	errorMessage: string,
) {
	return {
		gremlinId,
		agent: request.agent,
		source: "unknown" as const,
		status: "failed" as const,
		context: request.context,
		cwd: request.cwd,
		currentPhase: "settling",
		errorMessage,
		finishedAt: Date.now(),
	};
}

export default function registerPiGremlins(pi: ExtensionAPI) {
	const discovery = createGremlinDiscoveryCache({
		userAgentsDir: path.join(getAgentDir(), "agents"),
	});

	pi.on("session_start", () => {
		discovery.clear();
	});

	pi.on("session_shutdown", () => {
		discovery.clear();
	});

	type PiGremlinsArgs = { gremlins: GremlinRequest[] };
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
			if (!Array.isArray(params.gremlins) || params.gremlins.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: "Invalid parameters. Provide gremlins: [{ agent, context, cwd? }, ...].",
						},
					],
					isError: true,
					details: normalizeInvocationDetails(),
				};
			}
			const discovered = await discovery.get(ctx.cwd);
			const batch = await runGremlinBatch({
				gremlins: params.gremlins,
				signal,
				onUpdate: (details) => {
					onUpdate?.({
						content: [
							{
								type: "text",
								text: buildGremlinProgressSummary(details),
							},
						],
						details,
					});
				},
				runGremlin: async ({
					gremlin: rawRequest,
					gremlinId,
					signal: childSignal,
					onUpdate: publishUpdate,
				}) => {
					const resolvedCwd = resolveGremlinCwd(rawRequest.cwd, ctx.cwd);
					const request = resolvedCwd
						? { ...rawRequest, cwd: resolvedCwd }
						: rawRequest;
					const validationError = validateGremlinRequest(request);
					if (validationError) {
						return createFailedGremlinResult(request, gremlinId, validationError);
					}

					const gremlin = resolveGremlinByName(discovered.gremlins, request.agent);
					if (!gremlin) {
						return createFailedGremlinResult(
							request,
							gremlinId,
							`Unknown gremlin: ${request.agent}`,
						);
					}

					return runSingleGremlin({
						gremlinId,
						request,
						definition: gremlin,
						parentSystemPrompt: ctx.getSystemPrompt(),
						parentModel: ctx.model,
						modelRegistry: ctx.modelRegistry,
						signal: childSignal,
						onUpdate: ({ patch }) => publishUpdate?.(patch),
					});
				},
			});

			const details = normalizeInvocationDetails({
				requestedCount: params.gremlins.length,
				activeCount: batch.results.filter(
					(result) =>
						result.status === "queued" ||
						result.status === "starting" ||
						result.status === "active",
				).length,
				completedCount: batch.results.filter(
					(result) => result.status === "completed",
				).length,
				failedCount: batch.results.filter((result) => result.status === "failed")
					.length,
				canceledCount: batch.results.filter(
					(result) => result.status === "canceled",
				).length,
				gremlins: batch.results,
			});
			const partial: AgentToolResult<GremlinInvocationDetails> = {
				content: [{ type: "text", text: batch.summary }],
				details,
			};
			onUpdate?.(partial);

			return {
				content: [
					{
						type: "text",
						text: batch.summary,
					},
				],
				details,
				...(batch.anyError ? { isError: true } : {}),
			};
		},
	};

	// FIXME: Cast kept because pi 0.69.0 + TypeBox 1.x triggers TS2589 deep-instantiation at registerTool().
	// Keep unsoundness pinned to registration boundary. Revisit after upstream typings or TS inference improves.
	pi.registerTool(tool as any);
}
