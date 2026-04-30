import type { TextContent } from "@mariozechner/pi-ai";
import type {
	CreateAgentSessionResult,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { OverlayHandle } from "@mariozechner/pi-tui";
import {
	buildSideChatSessionConfig,
	createSideChatSession as defaultCreateSideChatSession,
	type ParentTranscriptEntry,
	type ParentTranscriptSnapshot,
	type SideChatMode,
} from "./side-chat-session-factory.js";
import {
	SIDE_CHAT_OVERLAY_OPTIONS,
	SideChatOverlayComponent,
	type SideChatOverlayController,
} from "./side-chat-overlay.js";
import {
	buildThreadHistoryPrompt,
	createEmptySideChatThreads,
	filterSideChatMessagesFromContext,
	restoreSideChatThreadsFromBranch,
	SIDE_CHAT_RESET_ENTRY_TYPE,
	SIDE_CHAT_THREAD_ENTRY_TYPE,
	type RestoredSideChatThreads,
	type SideChatThreadEntryData,
} from "./side-chat-persistence.js";
import {
	appendSideChatError,
	appendSideChatUserMessage,
	createInitialSideChatTranscriptState,
	reduceSideChatTranscriptEvent,
	sideChatRowsFromThread,
	type SideChatTranscriptEvent,
	type SideChatTranscriptState,
} from "./side-chat-transcript-state.js";

export const SIDE_CHAT_CHAT_COMMAND = "gremlins:chat";
export const SIDE_CHAT_CHAT_NEW_COMMAND = "gremlins:chat:new";
export const SIDE_CHAT_TANGENT_COMMAND = "gremlins:tangent";
export const SIDE_CHAT_TANGENT_NEW_COMMAND = "gremlins:tangent:new";

export const SIDE_CHAT_CHAT_LABEL = "💬 side-chat (chat)";
export const SIDE_CHAT_TANGENT_LABEL = "🧭 side-chat (tangent)";
export const SIDE_CHAT_FOOTER = "└─ side-chat persists in overlay ─";

const CHAT_DESCRIPTION =
	"Open the persistent Gremlins side-chat overlay; resumes the chat thread.";
const CHAT_NEW_DESCRIPTION =
	"Open the Gremlins side-chat overlay with a fresh chat thread.";
const TANGENT_DESCRIPTION =
	"Open the persistent Gremlins tangent overlay; resumes the tangent thread.";
const TANGENT_NEW_DESCRIPTION =
	"Open the Gremlins tangent overlay with a fresh tangent thread.";

export interface SideChatCommandDeps {
	createSideChatSession?: typeof defaultCreateSideChatSession;
	capturedAtFactory?: () => string;
}

type SideChatSession = CreateAgentSessionResult["session"] & {
	subscribe?: (listener: (event: SideChatTranscriptEvent) => void) => () => void;
	prompt: (text: string) => Promise<void>;
	abort?: () => Promise<void>;
	dispose: () => void;
};

interface SideChatRuntime {
	threads: RestoredSideChatThreads;
	activeMode: SideChatMode;
	activeSession: SideChatSession | null;
	activeSessionMode: SideChatMode | null;
	overlayHandle: OverlayHandle | null;
	overlayPromise: Promise<void> | null;
	overlayDraft: string;
	transcriptState: SideChatTranscriptState;
	subscriptions: Set<() => void>;
	lastSubmittedQuestion: string | null;
}

function createRuntime(): SideChatRuntime {
	return {
		threads: createEmptySideChatThreads(),
		activeMode: "chat",
		activeSession: null,
		activeSessionMode: null,
		overlayHandle: null,
		overlayPromise: null,
		overlayDraft: "",
		transcriptState: createInitialSideChatTranscriptState(),
		subscriptions: new Set(),
		lastSubmittedQuestion: null,
	};
}

export function parseSideChatArgs(
	args: string,
): { ok: true; userPrompt?: string } {
	const trimmed = (args ?? "").trim();
	return trimmed ? { ok: true, userPrompt: trimmed } : { ok: true };
}

export function captureParentTranscriptSnapshot(
	ctx: ExtensionCommandContext | ExtensionContext,
	capturedAtFactory: () => string = () => new Date().toISOString(),
): ParentTranscriptSnapshot | undefined {
	try {
		const branch = ctx.sessionManager?.getBranch?.();
		if (!Array.isArray(branch)) return undefined;
		const entries: ParentTranscriptEntry[] = [];
		for (const entry of branch) {
			if (!entry || typeof entry !== "object") continue;
			if ((entry as { type?: unknown }).type !== "message") continue;
			const message = (entry as { message?: { role?: unknown; content?: unknown } })
				.message;
			if (!message || typeof message !== "object") continue;
			const role = message.role;
			if (role !== "user" && role !== "assistant") continue;
			const text = extractTextFromContent(message.content).trim();
			if (!text) continue;
			entries.push({ role, text });
		}
		return { entries, capturedAt: capturedAtFactory() };
	} catch {
		return undefined;
	}
}

export function registerSideChatCommands(
	pi: ExtensionAPI,
	deps: SideChatCommandDeps = {},
): void {
	let runtime = createRuntime();
	const createSession = deps.createSideChatSession ?? defaultCreateSideChatSession;
	const capturedAtFactory = deps.capturedAtFactory ?? (() => new Date().toISOString());

	function restore(ctx: ExtensionContext): void {
		runtime.threads = restoreSideChatThreadsFromBranch(
			ctx.sessionManager?.getBranch?.(),
		);
		resetActiveSession(runtime);
		runtime.transcriptState = createInitialSideChatTranscriptState(
			sideChatRowsFromThread(runtime.threads[runtime.activeMode].exchanges),
		);
	}

	pi.on("session_start", (_event, ctx) => {
		runtime = createRuntime();
		restore(ctx);
	});
	pi.on("session_tree", (_event, ctx) => {
		restore(ctx);
	});
	pi.on("session_shutdown", () => {
		resetActiveSession(runtime);
		for (const unsubscribe of runtime.subscriptions) unsubscribe();
		runtime.subscriptions.clear();
		runtime.overlayHandle?.hide();
		runtime.overlayHandle = null;
		runtime.overlayPromise = null;
	});
	pi.on("context", (event) => {
		return { messages: filterSideChatMessagesFromContext(event.messages) };
	});

	pi.registerCommand(SIDE_CHAT_CHAT_COMMAND, {
		description: CHAT_DESCRIPTION,
		handler: makeHandler("chat", false),
	});
	pi.registerCommand(SIDE_CHAT_CHAT_NEW_COMMAND, {
		description: CHAT_NEW_DESCRIPTION,
		handler: makeHandler("chat", true),
	});
	pi.registerCommand(SIDE_CHAT_TANGENT_COMMAND, {
		description: TANGENT_DESCRIPTION,
		handler: makeHandler("tangent", false),
	});
	pi.registerCommand(SIDE_CHAT_TANGENT_NEW_COMMAND, {
		description: TANGENT_NEW_DESCRIPTION,
		handler: makeHandler("tangent", true),
	});
	pi.registerShortcut("alt+/", {
		description: "Toggle focus for the Gremlins side-chat overlay",
		handler: (ctx) => {
			if (!runtime.overlayHandle) {
				ctx.ui?.notify?.("Open /gremlins:chat or /gremlins:tangent first.", "info");
				return;
			}
			if (runtime.overlayHandle.isFocused()) runtime.overlayHandle.unfocus();
			else runtime.overlayHandle.focus();
		},
	});

	function makeHandler(mode: SideChatMode, forceNew: boolean) {
		return async (args: string, ctx: ExtensionCommandContext) => {
			const parsed = parseSideChatArgs(args);
			runtime.activeMode = mode;
			if (forceNew) {
				pi.appendEntry(SIDE_CHAT_RESET_ENTRY_TYPE, {
					mode,
					timestamp: Date.now(),
				});
				runtime.threads[mode] = { mode, exchanges: [] };
				if (runtime.activeSessionMode === mode) resetActiveSession(runtime);
			}
			if (mode === "chat" && runtime.threads.chat.exchanges.length === 0) {
				const parentSnapshot = captureParentTranscriptSnapshot(
					ctx,
					capturedAtFactory,
				);
				runtime.threads.chat.parentSnapshot = parentSnapshot;
				runtime.threads.chat.originCapturedAt = parentSnapshot?.capturedAt;
			}
			runtime.transcriptState = createInitialSideChatTranscriptState(
				sideChatRowsFromThread(runtime.threads[mode].exchanges),
			);
			ensureOverlay(ctx);
			if (parsed.userPrompt) {
				await submitSideChatPrompt(ctx, parsed.userPrompt);
			}
		};
	}

	function ensureOverlay(ctx: ExtensionCommandContext): void {
		if (!ctx.hasUI || !ctx.ui?.custom) {
			ctx.ui?.notify?.("Side-chat overlay requires interactive UI.", "warning");
			return;
		}
		if (runtime.overlayHandle) {
			runtime.overlayHandle.setHidden(false);
			runtime.overlayHandle.focus();
			return;
		}
		const controller: SideChatOverlayController = {
			getMode: () => runtime.activeMode,
			getTranscriptState: () => runtime.transcriptState,
			getDraft: () => runtime.overlayDraft,
			setDraft: (value) => {
				runtime.overlayDraft = value;
			},
			submitDraft: (value) => {
				runtime.overlayDraft = "";
				void submitSideChatPrompt(ctx, value);
			},
			close: () => {
				runtime.overlayHandle?.setHidden(true);
			},
		};
		runtime.overlayPromise = ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) =>
				new SideChatOverlayComponent(tui, theme, controller, done),
			{
				overlay: true,
				overlayOptions: SIDE_CHAT_OVERLAY_OPTIONS,
				onHandle: (handle) => {
					runtime.overlayHandle = handle;
					handle.focus();
				},
			},
		);
		runtime.overlayPromise.finally(() => {
			runtime.overlayHandle = null;
			runtime.overlayPromise = null;
		});
	}

	async function submitSideChatPrompt(
		ctx: ExtensionCommandContext,
		userPrompt: string,
	): Promise<void> {
		const mode = runtime.activeMode;
		const thread = runtime.threads[mode];
		runtime.lastSubmittedQuestion = userPrompt;
		runtime.transcriptState = appendSideChatUserMessage(
			runtime.transcriptState,
			userPrompt,
		);
		let session = runtime.activeSession;
		if (!session || runtime.activeSessionMode !== mode) {
			resetActiveSession(runtime);
			try {
				const config = buildSideChatSessionConfig({
					mode,
					userPrompt: buildThreadHistoryPrompt(thread, userPrompt),
					parentSnapshot: mode === "chat" ? thread.parentSnapshot : undefined,
					parentModel: ctx.model,
					parentThinking: undefined,
					cwd: ctx.cwd,
					modelRegistry: ctx.modelRegistry,
				});
				const created = await createSession({
					mode,
					userPrompt,
					parentSnapshot: mode === "chat" ? thread.parentSnapshot : undefined,
					parentModel: ctx.model,
					parentThinking: undefined,
					cwd: ctx.cwd,
					modelRegistry: ctx.modelRegistry,
					sessionConfig: config,
				});
				session = created.session as SideChatSession;
				runtime.activeSession = session;
				runtime.activeSessionMode = mode;
				const unsubscribe = session.subscribe?.((event) => {
					runtime.transcriptState = reduceSideChatTranscriptEvent(
						runtime.transcriptState,
						event,
					);
					if (event.type === "turn_end") finalizeExchange(pi, runtime, mode);
				});
				if (unsubscribe) runtime.subscriptions.add(unsubscribe);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				runtime.transcriptState = appendSideChatError(runtime.transcriptState, message);
				ctx.ui?.notify?.(`Side-chat failed to start: ${message}`, "error");
				return;
			}
		}

		const prompt = buildSideChatSessionConfig({
			mode,
			userPrompt: buildThreadHistoryPrompt(thread, userPrompt),
			parentSnapshot: mode === "chat" ? thread.parentSnapshot : undefined,
			parentModel: ctx.model,
			parentThinking: undefined,
			cwd: ctx.cwd,
			modelRegistry: ctx.modelRegistry,
		}).prompt;
		try {
			await session.prompt(prompt);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			runtime.transcriptState = appendSideChatError(runtime.transcriptState, message);
			ctx.ui?.notify?.(`Side-chat prompt failed: ${message}`, "error");
		}
	}
}

function finalizeExchange(
	pi: ExtensionAPI,
	runtime: SideChatRuntime,
	mode: SideChatMode,
): void {
	const question = runtime.lastSubmittedQuestion;
	if (!question) return;
	const answer = runtime.transcriptState.lastAssistantText.trim();
	const thread = runtime.threads[mode];
	const data: SideChatThreadEntryData = {
		mode,
		question,
		answer,
		capturedAt: thread.originCapturedAt,
		parentSnapshot: mode === "chat" ? thread.parentSnapshot : undefined,
		timestamp: Date.now(),
	};
	thread.exchanges.push(data);
	pi.appendEntry(SIDE_CHAT_THREAD_ENTRY_TYPE, data);
	runtime.lastSubmittedQuestion = null;
}

function resetActiveSession(runtime: SideChatRuntime): void {
	for (const unsubscribe of runtime.subscriptions) unsubscribe();
	runtime.subscriptions.clear();
	try {
		runtime.activeSession?.dispose();
	} catch {
		// Ignore already-disposed child sessions.
	}
	runtime.activeSession = null;
	runtime.activeSessionMode = null;
}

function extractTextFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			if ((item as { type?: string }).type !== "text") return [];
			const text = (item as TextContent).text;
			return typeof text === "string" ? [text] : [];
		})
		.join("");
}
