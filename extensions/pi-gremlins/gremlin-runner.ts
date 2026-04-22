import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model, TextContent } from "@mariozechner/pi-ai";
import type {
	CreateAgentSessionResult,
	ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import type { GremlinDefinition } from "./gremlin-definition.js";
import {
	buildGremlinSessionConfig,
	createGremlinSession,
} from "./gremlin-session-factory.js";
import type { GremlinRequest, GremlinRunResult, GremlinUsage } from "./gremlin-schema.js";

export interface GremlinRunnerUpdate {
	gremlinId: string;
	patch: Partial<GremlinRunResult>;
}

export interface RunSingleGremlinOptions {
	gremlinId: string;
	request: GremlinRequest;
	definition: GremlinDefinition;
	parentSystemPrompt: string;
	parentModel?: string | Model<any>;
	parentThinking?: ThinkingLevel;
	modelRegistry?: ModelRegistry;
	signal?: AbortSignal;
	onUpdate?: (update: GremlinRunnerUpdate) => void;
	createSession?: (
		options: Parameters<typeof createGremlinSession>[0],
	) => Promise<CreateAgentSessionResult>;
}

function extractTextFromContent(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			if ((item as { type?: string }).type !== "text") return [];
			const text = (item as TextContent).text;
			return typeof text === "string" ? [text] : [];
		})
		.join("")
		.trim();
}

function formatToolCall(toolName: unknown, args: unknown): string {
	if (typeof toolName !== "string" || !toolName) return "tool";
	if (args && typeof args === "object") {
		const record = args as Record<string, unknown>;
		if (typeof record.path === "string") return `${toolName} ${record.path}`;
		if (typeof record.command === "string") return `${toolName} ${record.command}`;
	}
	return toolName;
}

function extractToolResultText(result: unknown): string {
	if (!result || typeof result !== "object") return "";
	return extractTextFromContent((result as { content?: unknown }).content);
}

function mergeUsage(
	current: GremlinUsage | undefined,
	message: unknown,
): GremlinUsage | undefined {
	if (!message || typeof message !== "object") return current;
	const usage = (message as { usage?: Record<string, any> }).usage;
	if (!usage || typeof usage !== "object") return current;
	return {
		turns: (current?.turns ?? 0) + 1,
		input: (current?.input ?? 0) + (typeof usage.input === "number" ? usage.input : 0),
		output:
			(current?.output ?? 0) + (typeof usage.output === "number" ? usage.output : 0),
		cacheRead:
			(current?.cacheRead ?? 0) +
			(typeof usage.cacheRead === "number" ? usage.cacheRead : 0),
		cacheWrite:
			(current?.cacheWrite ?? 0) +
			(typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0),
		cost:
			(current?.cost ?? 0) +
			(typeof usage.cost?.total === "number" ? usage.cost.total : 0),
		contextTokens:
			(current?.contextTokens ?? 0) +
			(typeof usage.totalTokens === "number" ? usage.totalTokens : 0),
	};
}

function buildBaseResult(
	gremlinId: string,
	request: GremlinRequest,
	definition: GremlinDefinition,
): GremlinRunResult {
	return {
		gremlinId,
		agent: request.agent,
		source: definition.source,
		status: "starting",
		context: request.context,
		cwd: request.cwd,
		currentPhase: "starting",
		latestText: "",
		usage: { turns: 0, input: 0, output: 0 },
		startedAt: Date.now(),
		revision: 0,
	};
}

export async function runSingleGremlin({
	gremlinId,
	request,
	definition,
	parentSystemPrompt,
	parentModel,
	parentThinking,
	modelRegistry,
	signal,
	onUpdate,
	createSession = createGremlinSession,
}: RunSingleGremlinOptions): Promise<GremlinRunResult> {
	const state = buildBaseResult(gremlinId, request, definition);
	const publish = (patch: Partial<GremlinRunResult>) => {
		Object.assign(state, patch, { revision: (state.revision ?? 0) + 1 });
		onUpdate?.({ gremlinId, patch: { ...patch, revision: state.revision } });
	};

	if (signal?.aborted) {
		publish({
			status: "canceled",
			currentPhase: "settling",
			errorMessage: "Gremlin run was aborted before start",
			finishedAt: Date.now(),
		});
		return { ...state };
	}

	publish({ status: "starting", currentPhase: "starting" });

	const sessionPlan = buildGremlinSessionConfig({
		parentSystemPrompt,
		parentModel,
		parentThinking,
		gremlin: definition,
		context: request.context,
		cwd: request.cwd,
		modelRegistry,
	});
	publish({
		model: sessionPlan.model,
		thinking: sessionPlan.thinking,
	});

	const created = await createSession({
		parentSystemPrompt,
		parentModel,
		parentThinking,
		gremlin: definition,
		context: request.context,
		cwd: request.cwd,
		modelRegistry,
	});
	const session = created.session as CreateAgentSessionResult["session"] & {
		subscribe?: (listener: (event: any) => void) => () => void;
		prompt: (text: string) => Promise<void>;
		abort?: () => Promise<void>;
		dispose: () => void;
	};
	let abortRequested = false;

	const unsubscribe = session.subscribe?.((event: any) => {
		switch (event?.type) {
			case "agent_start":
				publish({ status: "active", currentPhase: "prompting" });
				break;
			case "turn_start":
				publish({ status: "active", currentPhase: "streaming" });
				break;
			case "message_update":
				if (event.assistantMessageEvent?.type === "text_delta") {
					publish({
						status: "active",
						currentPhase: "streaming",
						latestText: `${state.latestText ?? ""}${event.assistantMessageEvent.delta ?? ""}`.trim(),
					});
				}
				break;
			case "tool_execution_start":
				publish({
					status: "active",
					currentPhase: `tool:${event.toolName}`,
					latestToolCall: formatToolCall(event.toolName, event.args),
				});
				break;
			case "tool_execution_update":
				publish({
					status: "active",
					currentPhase: `tool:${event.toolName}`,
					latestToolResult: extractToolResultText(event.partialResult),
				});
				break;
			case "tool_execution_end":
				publish({
					status: "active",
					currentPhase: "streaming",
					latestToolResult: extractToolResultText(event.result),
				});
				break;
			case "message_end": {
				const latestText = extractTextFromContent(event.message?.content);
				publish({
					status: "active",
					currentPhase: "settling",
					latestText: latestText || state.latestText,
					usage: mergeUsage(state.usage, event.message),
					model:
						typeof event.message?.model === "string"
							? event.message.model
							: state.model,
				});
				break;
			}
			case "agent_end":
				publish({ currentPhase: "settling" });
				break;
		}
	});

	const handleAbort = async () => {
		abortRequested = true;
		publish({
			status: "canceled",
			currentPhase: "settling",
			errorMessage: "Gremlin run was aborted",
		});
		await session.abort?.();
	};
	const abortListener = () => {
		void handleAbort();
	};
	signal?.addEventListener("abort", abortListener, { once: true });

	try {
		await session.prompt(sessionPlan.prompt);
		publish({
			status: abortRequested ? "canceled" : "completed",
			currentPhase: "settling",
			finishedAt: Date.now(),
		});
		return { ...state };
	} catch (error) {
		publish({
			status: abortRequested || signal?.aborted ? "canceled" : "failed",
			currentPhase: "settling",
			errorMessage:
				error instanceof Error ? error.message : String(error),
			finishedAt: Date.now(),
		});
		return { ...state };
	} finally {
		signal?.removeEventListener("abort", abortListener);
		unsubscribe?.();
		session.dispose();
	}
}
