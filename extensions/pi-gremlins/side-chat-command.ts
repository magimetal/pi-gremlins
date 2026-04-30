/**
 * Side-chat command surface (PRD-0004 / ADR-0004).
 *
 * Registers `/gremlins:chat` and `/gremlins:tangent`. Chat captures a
 * snapshot of the parent transcript at invocation time via
 * `ctx.sessionManager.getBranch()` and feeds it to the side-chat session as
 * conversational input only (never as system prompt, tool, or extension).
 * Tangent gets a clean child session.
 *
 * Confirmed surfaces (Observed):
 * - `pi.registerCommand(name, { description?, handler: (args, ctx) => Promise<void> })`
 *   — extensions/types.d.ts:758, 800.
 * - `pi.registerMessageRenderer<T>(customType, renderer)` — types.d.ts:815.
 * - `pi.sendMessage({ customType, content, display, details })` is
 *   fire-and-forget — types.d.ts:817.
 * - `ctx.ui.notify(text, "info" | "warning" | "error")` — types.d.ts:74.
 * - `ctx.sessionManager.getBranch()` returns `SessionEntry[]`; project
 *   only `SessionMessageEntry` (entry.type === "message") with role
 *   user|assistant — session-manager.d.ts:23–25, 244.
 *
 * Guardrails (ADR-0004):
 * - No overlay/popup viewer (D1).
 * - No `pi.appendEntry` for side-chat messages (D2).
 * - Tangent never captures parent transcript (D3).
 * - Zero tools on session (D4).
 * - No primary-agent injection (PRD-0003 isolation).
 * - No nested CLI / temp prompt files / subprocess (ADR-0002).
 */

import type { TextContent } from "@mariozechner/pi-ai";
import {
	getMarkdownTheme,
	type CreateAgentSessionResult,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type MessageRenderer,
} from "@mariozechner/pi-coding-agent";
import {
	Container,
	Markdown,
	type MarkdownTheme,
	Spacer,
	Text,
} from "@mariozechner/pi-tui";
import {
	buildSideChatSessionConfig,
	createSideChatSession as defaultCreateSideChatSession,
	type ParentTranscriptEntry,
	type ParentTranscriptSnapshot,
	type SideChatMode,
} from "./side-chat-session-factory.js";

export const SIDE_CHAT_CHAT_COMMAND = "gremlins:chat";
export const SIDE_CHAT_TANGENT_COMMAND = "gremlins:tangent";
export const SIDE_CHAT_MESSAGE_TYPE = "pi-gremlins:side-chat";

export const SIDE_CHAT_CHAT_LABEL = "💬 side-chat (chat)";
export const SIDE_CHAT_TANGENT_LABEL = "🧭 side-chat (tangent)";
export const SIDE_CHAT_FOOTER = "└─ side-chat ended ─";

const CHAT_DESCRIPTION =
	"Side-chat with parent-transcript context (zero tools, fresh per invocation).";
const TANGENT_DESCRIPTION =
	"Side-chat in a clean child session, no parent context (zero tools, fresh per invocation).";

const CHAT_USAGE = `Usage: /gremlins:chat <prompt>\n${CHAT_DESCRIPTION}`;
const TANGENT_USAGE = `Usage: /gremlins:tangent <prompt>\n${TANGENT_DESCRIPTION}`;

export interface SideChatCommandDeps {
	createSideChatSession?: typeof defaultCreateSideChatSession;
	capturedAtFactory?: () => string;
}

export interface SideChatMessageDetails {
	mode: SideChatMode;
	capturedAt?: string;
	label: string;
	footer: string;
}

interface SideChatEvent {
	type?: string;
	assistantMessageEvent?: { type?: string; delta?: unknown };
	message?: {
		role?: unknown;
		content?: unknown;
	};
}

type SideChatSession = CreateAgentSessionResult["session"] & {
	subscribe?: (listener: (event: SideChatEvent) => void) => () => void;
	prompt: (text: string) => Promise<void>;
	abort?: () => Promise<void>;
	dispose: () => void;
};

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

export function parseSideChatArgs(
	args: string,
): { ok: true; userPrompt: string } | { ok: false } {
	const trimmed = (args ?? "").trim();
	if (!trimmed) return { ok: false };
	return { ok: true, userPrompt: trimmed };
}

export function captureParentTranscriptSnapshot(
	ctx: ExtensionCommandContext,
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

function emitUsage(ctx: ExtensionCommandContext, usageText: string): void {
	if (ctx.hasUI && ctx.ui?.notify) {
		ctx.ui.notify(usageText, "info");
		return;
	}
	// Fallback: emit a non-LLM-bound notification via console for non-UI modes.
	// eslint-disable-next-line no-console
	console.log(usageText);
}

async function driveSideChatSession(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	created: CreateAgentSessionResult,
	prompt: string,
	details: SideChatMessageDetails,
): Promise<void> {
	const session = created.session as SideChatSession;
	let aggregatedDeltaText = "";
	let lastAssistantMessageText = "";
	const unsubscribe = session.subscribe?.((event) => {
		if (!event || typeof event !== "object") return;
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent?.type === "text_delta"
		) {
			const delta = event.assistantMessageEvent.delta;
			if (typeof delta === "string") aggregatedDeltaText += delta;
			return;
		}
		if (event.type === "message_end") {
			const message = event.message;
			if (!message) return;
			if (message.role === "assistant") {
				const text = extractTextFromContent(message.content).trim();
				if (text) lastAssistantMessageText = text;
			}
		}
	});

	const abortListener = () => {
		void session.abort?.();
	};
	const signal = ctx.signal;
	if (signal) {
		if (signal.aborted) {
			abortListener();
		} else {
			signal.addEventListener("abort", abortListener, { once: true });
		}
	}

	let errorMessage: string | undefined;
	try {
		await session.prompt(prompt);
	} catch (error) {
		errorMessage = error instanceof Error ? error.message : String(error);
	} finally {
		signal?.removeEventListener("abort", abortListener);
		unsubscribe?.();
		try {
			session.dispose();
		} catch {
			// dispose may throw on already-disposed sessions; ignore.
		}
	}

	const aborted = Boolean(signal?.aborted);
	const finalText =
		(lastAssistantMessageText || aggregatedDeltaText.trim()) || "";

	let content = finalText;
	if (aborted && !content) content = "(side-chat aborted)";
	if (errorMessage && !content) content = `(side-chat error: ${errorMessage})`;
	if (!content) content = "(side-chat produced no response)";

	pi.sendMessage<SideChatMessageDetails>({
		customType: SIDE_CHAT_MESSAGE_TYPE,
		content,
		display: true,
		details: { ...details },
	});
}

function makeHandler(
	pi: ExtensionAPI,
	mode: SideChatMode,
	deps: SideChatCommandDeps,
): (args: string, ctx: ExtensionCommandContext) => Promise<void> {
	const createSession =
		deps.createSideChatSession ?? defaultCreateSideChatSession;
	const capturedAtFactory =
		deps.capturedAtFactory ?? (() => new Date().toISOString());
	const usageText = mode === "chat" ? CHAT_USAGE : TANGENT_USAGE;
	const label = mode === "chat" ? SIDE_CHAT_CHAT_LABEL : SIDE_CHAT_TANGENT_LABEL;

	return async function sideChatHandler(args, ctx) {
		const parsed = parseSideChatArgs(args);
		if (!parsed.ok) {
			emitUsage(ctx, usageText);
			return;
		}

		const parentSnapshot =
			mode === "chat"
				? captureParentTranscriptSnapshot(ctx, capturedAtFactory)
				: undefined;

		let created: CreateAgentSessionResult;
		try {
			created = await createSession({
				mode,
				userPrompt: parsed.userPrompt,
				parentSnapshot,
				parentModel: ctx.model,
				parentThinking: undefined,
				cwd: ctx.cwd,
				modelRegistry: ctx.modelRegistry,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			pi.sendMessage<SideChatMessageDetails>({
				customType: SIDE_CHAT_MESSAGE_TYPE,
				content: `(side-chat failed to start: ${message})`,
				display: true,
				details: {
					mode,
					capturedAt: parentSnapshot?.capturedAt,
					label,
					footer: SIDE_CHAT_FOOTER,
				},
			});
			return;
		}

		// Build the session plan to get plan.prompt for `session.prompt(...)`.
		// createSideChatSession may have built its own plan internally; that
		// duplication is cheap (pure data construction) and lets the test stub
		// receive flat options without coordinating session config exchange.
		const plan = buildSideChatSessionConfig({
			mode,
			userPrompt: parsed.userPrompt,
			parentSnapshot,
			parentModel: ctx.model,
			cwd: ctx.cwd,
			modelRegistry: ctx.modelRegistry,
		});

		await driveSideChatSession(pi, ctx, created, plan.prompt, {
			mode,
			capturedAt: parentSnapshot?.capturedAt,
			label,
			footer: SIDE_CHAT_FOOTER,
		});
	};
}

export function registerSideChatCommands(
	pi: ExtensionAPI,
	deps: SideChatCommandDeps = {},
): void {
	pi.registerCommand(SIDE_CHAT_CHAT_COMMAND, {
		description: CHAT_DESCRIPTION,
		handler: makeHandler(pi, "chat", deps),
	});
	pi.registerCommand(SIDE_CHAT_TANGENT_COMMAND, {
		description: TANGENT_DESCRIPTION,
		handler: makeHandler(pi, "tangent", deps),
	});
}

/**
 * Inline message renderer for `pi-gremlins:side-chat` custom messages.
 * Returns a Container with a label header, the assistant markdown body,
 * and a fixed footer line. ADR-0004 D1: inline only.
 */
export const sideChatMessageRenderer: MessageRenderer<SideChatMessageDetails> =
	(message, _options, _theme) => {
		const details = message.details ?? {
			mode: "chat",
			label: SIDE_CHAT_CHAT_LABEL,
			footer: SIDE_CHAT_FOOTER,
		};
		const container = new Container();
		container.addChild(new Text(details.label));
		container.addChild(new Spacer(1));
		const body =
			typeof message.content === "string"
				? message.content
				: extractTextFromContent(message.content);
		container.addChild(new Markdown(body, 0, 0, getMarkdownThemeSafely()));
		/* prettier-ignore */
		container.addChild(new Spacer(1));
		container.addChild(new Text(details.footer));
		return container;
	};

function getMarkdownThemeSafely(): MarkdownTheme {
	try {
		return (getMarkdownTheme?.() ?? ({} as MarkdownTheme)) as MarkdownTheme;
	} catch {
		return {} as MarkdownTheme;
	}
}
