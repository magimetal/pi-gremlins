import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import {
	type ExtensionAPI,
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
import { PiGremlinsParams, type GremlinInvocationDetails } from "./gremlin-schema.js";
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

function countStatuses(details: GremlinInvocationDetails): GremlinInvocationDetails {
	const gremlins = details.gremlins ?? [];
	return {
		...details,
		gremlins,
		activeCount: gremlins.filter(
			(gremlin) =>
				gremlin.status === "queued" ||
				gremlin.status === "starting" ||
				gremlin.status === "active",
		).length,
		completedCount: gremlins.filter((gremlin) => gremlin.status === "completed")
			.length,
		failedCount: gremlins.filter((gremlin) => gremlin.status === "failed").length,
		canceledCount: gremlins.filter(
			(gremlin) => gremlin.status === "canceled",
		).length,
	};
}

function getInvocationDetails(result: AgentToolResult<any>) {
	const emptyDetails: GremlinInvocationDetails = {
		requestedCount: 0,
		activeCount: 0,
		completedCount: 0,
		failedCount: 0,
		canceledCount: 0,
		gremlins: [],
	};
	if (!result.details) return emptyDetails;
	return countStatuses(result.details);
}

function renderCallText(params: { gremlins?: Array<{ agent?: string }> }): string {
	const names = (params.gremlins ?? []).map((gremlin) => gremlin.agent).filter(Boolean);
	if (names.length === 0) return BRAND_NAME;
	return `${BRAND_NAME} ${names.join(", ")}`;
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

	pi.registerTool({
		name: TOOL_NAME,
		label: BRAND_NAME,
		description: TOOL_DESCRIPTION,
		parameters: PiGremlinsParams,

		renderCall(params) {
			return new Text(renderCallText(params));
		},

		renderResult(result, options, theme) {
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

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!Array.isArray(params.gremlins) || params.gremlins.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: "Invalid parameters. Provide gremlins: [{ agent, context, cwd? }, ...].",
						},
					],
					isError: true,
					details: countStatuses({
						requestedCount: 0,
						activeCount: 0,
						completedCount: 0,
						failedCount: 0,
						canceledCount: 0,
						gremlins: [],
					}),
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
				runGremlin: async ({ gremlin: request, gremlinId, signal: childSignal, onUpdate: publishUpdate }) => {
					const gremlin = resolveGremlinByName(discovered.gremlins, request.agent);
					if (!gremlin) {
						return {
							gremlinId,
							agent: request.agent,
							source: "unknown",
							status: "failed",
							context: request.context,
							cwd: request.cwd,
							currentPhase: "settling",
							errorMessage: `Unknown gremlin: ${request.agent}`,
						};
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

			const details = countStatuses({
				requestedCount: params.gremlins.length,
				activeCount: 0,
				completedCount: 0,
				failedCount: 0,
				canceledCount: 0,
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
	});
}
