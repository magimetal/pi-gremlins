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
import type {
	GremlinActivity,
	GremlinRequest,
	GremlinRunResult,
	GremlinUsage,
} from "./gremlin-schema.js";

export interface GremlinRunnerUpdate {
	gremlinId: string;
	patch: Partial<GremlinRunResult>;
}

const ACTIVITY_HISTORY_LIMIT = 12;

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
	contextTokens?: number,
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
		contextTokens,
	};
}

function getContextWindowTokens(
	session: { getContextUsage?: () => { tokens: number | null } | undefined },
): number | undefined {
	const contextTokens = session.getContextUsage?.()?.tokens;
	return typeof contextTokens === "number" ? contextTokens : undefined;
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
		activities: [],
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
	let activitySequence = 0;
	const addActivity = (activity: Omit<GremlinActivity, "sequence" | "timestamp">) => {
		const nextActivity: GremlinActivity = {
			...activity,
			timestamp: Date.now(),
			sequence: ++activitySequence,
		};
		const currentActivities = state.activities ?? [];
		const previous = currentActivities[currentActivities.length - 1];
		const nextActivities =
			previous?.kind === nextActivity.kind && previous.phase === nextActivity.phase
				? [...currentActivities.slice(0, -1), nextActivity]
				: [...currentActivities, nextActivity];
		return nextActivities.slice(-ACTIVITY_HISTORY_LIMIT);
	};
	const publish = (
		patch: Partial<GremlinRunResult>,
		activity?: Omit<GremlinActivity, "sequence" | "timestamp">,
	) => {
		const nextPatch = activity
			? { ...patch, activities: addActivity(activity) }
			: patch;
		Object.assign(state, nextPatch, { revision: (state.revision ?? 0) + 1 });
		onUpdate?.({ gremlinId, patch: { ...nextPatch, revision: state.revision } });
	};

	if (signal?.aborted) {
		const errorMessage = "Gremlin run was aborted before start";
		publish(
			{
				status: "canceled",
				currentPhase: "settling",
				errorMessage,
				finishedAt: Date.now(),
			},
			{ kind: "error", phase: "settling", text: errorMessage },
		);
		return { ...state };
	}

	publish({
		source: definition.source,
		status: "starting",
		currentPhase: "starting",
		usage: state.usage,
	});

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
		getContextUsage?: () => { tokens: number | null } | undefined;
	};
	let abortRequested = false;

	const appendLatestTextDelta = (delta: unknown) => {
		if (typeof delta !== "string" || !delta) return state.latestText ?? "";
		const baseText = state.latestText ?? "";
		const nextText = `${baseText}${baseText ? delta : delta.trimStart()}`;
		let end = nextText.length;
		while (end > 0 && /\s/.test(nextText[end - 1]!)) end -= 1;
		return end === nextText.length ? nextText : nextText.slice(0, end);
	};

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
					const latestText = appendLatestTextDelta(event.assistantMessageEvent.delta);
					publish(
						{
							status: "active",
							currentPhase: "streaming",
							latestText,
						},
						{ kind: "text", phase: "streaming", text: latestText },
					);
				}
				break;
			case "tool_execution_start": {
				const phase = `tool:${event.toolName}`;
				const latestToolCall = formatToolCall(event.toolName, event.args);
				publish(
					{
						status: "active",
						currentPhase: phase,
						latestToolCall,
					},
					{ kind: "tool-call", phase, text: latestToolCall },
				);
				break;
			}
			case "tool_execution_update": {
				const phase = `tool:${event.toolName}`;
				const latestToolResult = extractToolResultText(event.partialResult);
				publish(
					{
						status: "active",
						currentPhase: phase,
						latestToolResult,
					},
					{ kind: "tool-result", phase, text: latestToolResult },
				);
				break;
			}
			case "tool_execution_end": {
				const latestToolResult = extractToolResultText(event.result);
				publish(
					{
						status: "active",
						currentPhase: "streaming",
						latestToolResult,
					},
					{ kind: "tool-result", phase: "streaming", text: latestToolResult },
				);
				break;
			}
			case "message_end": {
				const latestText = extractTextFromContent(event.message?.content);
				const finalText = latestText || state.latestText;
				const patch = {
					status: "active" as const,
					currentPhase: "settling",
					latestText: finalText,
					usage: mergeUsage(
						state.usage,
						event.message,
						getContextWindowTokens(session),
					),
					model:
						typeof event.message?.model === "string"
							? event.message.model
							: state.model,
				};
				if (latestText && latestText !== state.latestText) {
					publish(patch, { kind: "text", phase: "settling", text: latestText });
				} else {
					publish(patch);
				}
				break;
			}
			case "agent_end":
				publish({ currentPhase: "settling" });
				break;
		}
	});

	const handleAbort = async () => {
		abortRequested = true;
		const errorMessage = "Gremlin run was aborted";
		publish(
			{
				status: "canceled",
				currentPhase: "settling",
				errorMessage,
			},
			{ kind: "error", phase: "settling", text: errorMessage },
		);
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
		const errorMessage = error instanceof Error ? error.message : String(error);
		publish(
			{
				status: abortRequested || signal?.aborted ? "canceled" : "failed",
				currentPhase: "settling",
				errorMessage,
				finishedAt: Date.now(),
			},
			{ kind: "error", phase: "settling", text: errorMessage },
		);
		return { ...state };
	} finally {
		signal?.removeEventListener("abort", abortListener);
		unsubscribe?.();
		session.dispose();
	}
}
