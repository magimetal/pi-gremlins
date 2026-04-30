import * as fs from "node:fs";
import * as path from "node:path";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@mariozechner/pi-agent-core";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	resolveGremlinByName,
	type AgentDiscoveryDiagnostic,
	type GremlinDiscoveryCache,
} from "./gremlin-discovery.js";
import { runSingleGremlin } from "./gremlin-runner.js";
import type {
	GremlinInvocationDetails,
	GremlinRequest,
	GremlinRunResult,
} from "./gremlin-schema.js";
import { runGremlinBatch } from "./gremlin-scheduler.js";
import { buildGremlinProgressSummary } from "./gremlin-summary.js";

export type PiGremlinsArgs = { gremlins: GremlinRequest[] };
type PiGremlinsToolResult = AgentToolResult<GremlinInvocationDetails> & {
	isError?: boolean;
};

export interface ExecutePiGremlinsToolOptions {
	params: PiGremlinsArgs;
	signal?: AbortSignal;
	onUpdate?: AgentToolUpdateCallback<GremlinInvocationDetails>;
	ctx: ExtensionContext;
	discovery: GremlinDiscoveryCache;
	notifyDiagnostics: (diagnostics: AgentDiscoveryDiagnostic[]) => void;
}

export function normalizeInvocationDetails(
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
	if (!request.intent?.trim()) return "Gremlin intent is required";
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
): GremlinRunResult {
	return {
		gremlinId,
		intent: request.intent ?? "",
		agent: request.agent,
		source: "unknown",
		status: "failed",
		context: request.context,
		cwd: request.cwd,
		currentPhase: "settling",
		errorMessage,
		activities: [{ kind: "error", phase: "settling", text: errorMessage }],
		usage: { turns: 0, input: 0, output: 0 },
		finishedAt: Date.now(),
	};
}

function createInvalidParametersResult(): PiGremlinsToolResult {
	return {
		content: [
			{
				type: "text",
				text: "Invalid parameters. Provide gremlins: [{ intent, agent, context, cwd? }, ...].",
			},
		],
		isError: true,
		details: normalizeInvocationDetails(),
	};
}

function buildModelVisibleContent(
	summary: string,
	results: GremlinRunResult[],
): PiGremlinsToolResult["content"] {
	const content: PiGremlinsToolResult["content"] = [{ type: "text", text: summary }];
	for (const result of results) {
		const terminalText =
			result.status === "completed"
				? result.latestText
				: result.status === "failed" || result.status === "canceled"
					? result.errorMessage
					: undefined;
		if (!terminalText?.trim()) continue;
		content.push({
			type: "text",
			text: `=== ${result.gremlinId ?? "g?"} · ${result.agent} ===\n${terminalText}`,
		});
	}
	return content;
}

export async function executePiGremlinsTool({
	params,
	signal,
	onUpdate,
	ctx,
	discovery,
	notifyDiagnostics,
}: ExecutePiGremlinsToolOptions): Promise<PiGremlinsToolResult> {
	if (!Array.isArray(params.gremlins) || params.gremlins.length === 0) {
		return createInvalidParametersResult();
	}

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
			const request = resolvedCwd ? { ...rawRequest, cwd: resolvedCwd } : rawRequest;
			const validationError = validateGremlinRequest(request);
			if (validationError) {
				return createFailedGremlinResult(request, gremlinId, validationError);
			}

			const effectiveCwd = request.cwd ?? ctx.cwd;
			const discovered = await discovery.get(effectiveCwd);
			notifyDiagnostics(discovered.diagnostics);
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
		completedCount: batch.results.filter((result) => result.status === "completed")
			.length,
		failedCount: batch.results.filter((result) => result.status === "failed")
			.length,
		canceledCount: batch.results.filter((result) => result.status === "canceled")
			.length,
		gremlins: batch.results,
	});
	const content = buildModelVisibleContent(batch.summary, batch.results);
	const partial: AgentToolResult<GremlinInvocationDetails> = {
		content,
		details,
	};
	onUpdate?.(partial);

	return {
		content,
		details,
		...(batch.anyError ? { isError: true } : {}),
	};
}
