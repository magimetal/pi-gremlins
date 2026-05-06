import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import type {
	CreateAgentSessionResult,
	ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import type { GremlinDefinition } from "./gremlin-definition.js";
import { extractTextFromContent } from "../shared/gremlin-content-utils.js";
import {
	buildGremlinSessionConfig,
	createGremlinSession,
} from "./gremlin-session-factory.js";
import type {
	GremlinActivity,
	GremlinRequest,
	GremlinRunResult,
	GremlinUsage,
} from "../shared/gremlin-schema.js";
import type {
	ActiveGremlinSessionHandle,
	ActiveGremlinSessionRegistry,
	ActiveGremlinSteeringEvent,
} from "./gremlin-session-registry.js";
import type { GremlinSessionTranscriptStore } from "./gremlin-session-transcript-store.js";

export interface GremlinRunnerUpdate {
	gremlinId: string;
	patch: Partial<GremlinRunResult>;
}

const ACTIVITY_HISTORY_LIMIT = 12;
const ACTIVITY_TEXT_PREVIEW_LIMIT = 512;
const STREAM_TEXT_UPDATE_MIN_CHARS = 64;
const STREAM_TEXT_UPDATE_MIN_MS = 50;

interface GremlinSessionMessage {
	content?: unknown;
	model?: unknown;
	usage?: Record<string, unknown>;
}

interface GremlinEvent {
	type?: string;
	assistantMessageEvent?: {
		type?: string;
		delta?: unknown;
	};
	toolName?: unknown;
	args?: unknown;
	partialResult?: unknown;
	result?: unknown;
	message?: GremlinSessionMessage;
}

type GremlinSession = CreateAgentSessionResult["session"] & {
	subscribe?: (listener: (event: GremlinEvent) => void) => () => void;
	prompt: (text: string) => Promise<void>;
	steer: (message: string) => Promise<unknown> | unknown;
	abort?: () => Promise<void>;
	dispose: () => void;
	getContextUsage?: () => { tokens: number | null } | undefined;
};

type PublishGremlinPatch = (
	patch: Partial<GremlinRunResult>,
	activity?: Omit<GremlinActivity, "sequence" | "timestamp">,
) => void;

interface TextDeltaPublisher {
	apply(delta: unknown): void;
	flush(): void;
}

export interface RunSingleGremlinOptions {
	gremlinId: string;
	toolCallId?: string;
	request: GremlinRequest;
	definition: GremlinDefinition;
	parentModel?: string | Model<any>;
	parentThinking?: ThinkingLevel;
	modelRegistry?: ModelRegistry;
	signal?: AbortSignal;
	onUpdate?: (update: GremlinRunnerUpdate) => void;
	activeSessionRegistry?: ActiveGremlinSessionRegistry;
	transcriptStore?: GremlinSessionTranscriptStore;
	createSession?: (
		options: Parameters<typeof createGremlinSession>[0],
	) => Promise<CreateAgentSessionResult>;
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
	return extractTextFromContent((result as { content?: unknown }).content).trim();
}

function mergeUsage(
	current: GremlinUsage | undefined,
	message: unknown,
	contextTokens?: number,
): GremlinUsage | undefined {
	if (!message || typeof message !== "object") return current;
	const usage = (message as { usage?: Record<string, unknown> }).usage;
	if (!usage || typeof usage !== "object") return current;
	const cost = usage.cost;
	const totalCost =
		cost && typeof cost === "object" && "total" in cost
			? (cost as { total?: unknown }).total
			: undefined;
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
			(current?.cost ?? 0) + (typeof totalCost === "number" ? totalCost : 0),
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
		intent: request.intent,
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

function createActivityTextPreview(text: string): string {
	if (text.length <= ACTIVITY_TEXT_PREVIEW_LIMIT) return text;
	return `${text.slice(0, ACTIVITY_TEXT_PREVIEW_LIMIT - 1).trimEnd()}…`;
}

function createActivityRecorder(state: GremlinRunResult) {
	let activitySequence = 0;
	return (activity: Omit<GremlinActivity, "sequence" | "timestamp">) => {
		const nextActivity: GremlinActivity = {
			...activity,
			text: createActivityTextPreview(activity.text),
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
}

function createGremlinPublisher(
	gremlinId: string,
	toolCallId: string,
	state: GremlinRunResult,
	onUpdate?: (update: GremlinRunnerUpdate) => void,
	transcriptStore?: GremlinSessionTranscriptStore,
): PublishGremlinPatch {
	const addActivity = createActivityRecorder(state);
	return (patch, activity) => {
		const nextPatch = activity
			? { ...patch, activities: addActivity(activity) }
			: patch;
		Object.assign(state, nextPatch, { revision: (state.revision ?? 0) + 1 });
		if (nextPatch.status) {
			transcriptStore?.updateSession({ gremlinId, toolCallId, status: nextPatch.status });
		}
		onUpdate?.({ gremlinId, patch: { ...nextPatch, revision: state.revision } });
	};
}

function appendLatestTextDelta(currentText: string | undefined, delta: unknown) {
	if (typeof delta !== "string" || !delta) return currentText ?? "";
	const baseText = currentText ?? "";
	const nextText = `${baseText}${baseText ? delta : delta.trimStart()}`;
	let end = nextText.length;
	while (end > 0 && /\s/.test(nextText[end - 1]!)) end -= 1;
	return end === nextText.length ? nextText : nextText.slice(0, end);
}

function createTextDeltaPublisher(
	state: GremlinRunResult,
	publish: PublishGremlinPatch,
): TextDeltaPublisher {
	let unpublishedChars = 0;
	let lastPublishedAt = Date.now();

	function publishStreamingText() {
		if (!unpublishedChars) return;
		unpublishedChars = 0;
		lastPublishedAt = Date.now();
		publish(
			{
				status: "active",
				currentPhase: "streaming",
				latestText: state.latestText,
			},
			{ kind: "text", phase: "streaming", text: state.latestText },
		);
	}

	return {
		apply(delta: unknown) {
			if (typeof delta !== "string" || !delta) return;
			state.latestText = appendLatestTextDelta(state.latestText, delta);
			unpublishedChars += delta.length;
			const elapsedMs = Date.now() - lastPublishedAt;
			if (
				unpublishedChars >= STREAM_TEXT_UPDATE_MIN_CHARS ||
				elapsedMs >= STREAM_TEXT_UPDATE_MIN_MS
			) {
				publishStreamingText();
			}
		},
		flush: publishStreamingText,
	};
}

function projectGremlinEvent(
	event: GremlinEvent,
	state: GremlinRunResult,
	session: GremlinSession | undefined,
	publish: PublishGremlinPatch,
	textDeltaPublisher: TextDeltaPublisher,
) {
	switch (event?.type) {
		case "agent_start":
			textDeltaPublisher.flush();
			publish({ status: "active", currentPhase: "prompting" });
			break;
		case "turn_start":
			textDeltaPublisher.flush();
			publish({ status: "active", currentPhase: "streaming" });
			break;
		case "message_update":
			if (event.assistantMessageEvent?.type === "text_delta") {
				textDeltaPublisher.apply(event.assistantMessageEvent.delta);
			}
			break;
		case "tool_execution_start": {
			textDeltaPublisher.flush();
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
			textDeltaPublisher.flush();
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
			textDeltaPublisher.flush();
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
			textDeltaPublisher.flush();
			const latestText = extractTextFromContent(event.message?.content).trim();
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
			textDeltaPublisher.flush();
			publish({ currentPhase: "settling" });
			break;
	}
}

export async function runSingleGremlin({
	gremlinId,
	request,
	definition,
	parentModel,
	toolCallId = "unknown-tool-call",
	parentThinking,
	modelRegistry,
	signal,
	onUpdate,
	activeSessionRegistry,
	transcriptStore,
	createSession = createGremlinSession,
}: RunSingleGremlinOptions): Promise<GremlinRunResult> {
	const state = buildBaseResult(gremlinId, request, definition);
	transcriptStore?.upsertSession({
		gremlinId,
		toolCallId,
		agent: request.agent,
		status: state.status,
	});
	const publish = createGremlinPublisher(
		gremlinId,
		toolCallId,
		state,
		onUpdate,
		transcriptStore,
	);
	const textDeltaPublisher = createTextDeltaPublisher(state, publish);

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
		parentModel,
		parentThinking,
		gremlin: definition,
		intent: request.intent,
		context: request.context,
		cwd: request.cwd,
		modelRegistry,
	});
	publish({
		model: sessionPlan.model,
		thinking: sessionPlan.thinking,
	});
	if (sessionPlan.modelResolutionError) {
		publish({
			status: "failed",
			currentPhase: "settling",
			errorMessage: sessionPlan.modelResolutionError,
			finishedAt: Date.now(),
		});
		return { ...state };
	}

	let session: GremlinSession | undefined;
	let activeSessionHandle: ActiveGremlinSessionHandle | undefined;
	let unsubscribe: (() => void) | undefined;
	let abortPromise: Promise<void> | undefined;
	let abortError: unknown;
	let abortRequested = false;

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
		await session?.abort?.();
	};
	const abortListener = () => {
		abortPromise = handleAbort().catch((error) => {
			abortError = error;
		});
	};

	try {
		const created = await createSession({
			sessionConfig: sessionPlan,
			parentModel,
			parentThinking,
			gremlin: definition,
			intent: request.intent,
			context: request.context,
			cwd: request.cwd,
			modelRegistry,
		});
		session = created.session as GremlinSession;
		activeSessionHandle = activeSessionRegistry?.registerActiveGremlinSession({
			gremlinId,
			toolCallId,
			agent: request.agent,
			session,
			recordSteeringEvent(event: ActiveGremlinSteeringEvent) {
				const phase = event.status === "queued" ? "steering:queued" : "steering:rejected";
				const text =
					event.status === "queued"
						? `queued · ${event.message}`
						: `rejected · ${event.errorMessage} · ${event.message}`;
				publish({}, { kind: "steering", phase, text });
			},
		});
		unsubscribe = session.subscribe?.((event: GremlinEvent) => {
			transcriptStore?.recordEvent({ gremlinId, toolCallId, event });
			projectGremlinEvent(event, state, session, publish, textDeltaPublisher);
		});
		signal?.addEventListener("abort", abortListener, { once: true });
		if (signal?.aborted && !abortRequested) abortListener();

		await session.prompt(sessionPlan.prompt);
		textDeltaPublisher.flush();
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
		if (activeSessionHandle) {
			activeSessionRegistry?.unregisterActiveGremlinSession(activeSessionHandle);
			activeSessionHandle = undefined;
		}
		await abortPromise;
		if (abortError && !state.errorMessage) {
			publish({
				status: "canceled",
				currentPhase: "settling",
				errorMessage:
					abortError instanceof Error ? abortError.message : String(abortError),
				finishedAt: Date.now(),
			});
		}
		session?.dispose();
	}
}
