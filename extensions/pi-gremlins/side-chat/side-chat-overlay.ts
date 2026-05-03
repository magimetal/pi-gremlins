import {
	Key,
	Markdown,
	Text,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Component,
	type MarkdownTheme,
	type OverlayOptions,
	type TUI,
} from "@mariozechner/pi-tui";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type { SideChatMode } from "./side-chat-session-factory.js";
import type {
	SideChatTranscriptRow,
	SideChatTranscriptState,
} from "./side-chat-transcript-state.js";

const CURSOR_MARKER = "\u001b_pi:c\u0007";
const OVERLAY_HEIGHT_RATIO = 0.8;
const FALLBACK_TERM_HEIGHT = 24;
const MIN_OVERLAY_HEIGHT = 10;
const BOX_HORIZONTAL_CHROME = 4;
const FIXED_BOX_LINES = 9;

export const SIDE_CHAT_OVERLAY_OPTIONS: OverlayOptions = {
	anchor: "center",
	width: "78%",
	minWidth: 72,
	maxHeight: "80%",
	margin: { top: 2, right: 4, bottom: 2, left: 4 },
	nonCapturing: true,
};

export interface SideChatOverlayController {
	getMode(): SideChatMode;
	getTranscriptState(): SideChatTranscriptState;
	getDraft(): string;
	setDraft(value: string): void;
	submitDraft(value: string): void;
	close(): void;
}

export class SideChatOverlayComponent implements Component {
	private scrollOffset = 0;
	focused = true;

	constructor(
		private readonly tui: TUI | undefined,
		private readonly controller: SideChatOverlayController,
		private readonly done: () => void,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const safeWidth = Math.max(8, width);
		const innerWidth = Math.max(1, safeWidth - BOX_HORIZONTAL_CHROME);
		const targetHeight = this.getTargetHeight();
		const bodyHeight = Math.max(1, targetHeight - FIXED_BOX_LINES);
		const mode = this.controller.getMode();
		const state = this.controller.getTranscriptState();
		const draft = this.controller.getDraft();
		const bodyLines = this.getVisibleTranscriptLines(
			state.rows,
			innerWidth,
			bodyHeight,
		);
		const contentLines = [
			"",
			`${mode === "chat" ? "💬 chat" : "🧭 tangent"} │ ${formatStatus(state.status)} │ Enter submits · Esc closes · Alt+/ focuses`,
			"─".repeat(innerWidth),
			...bodyLines,
			"",
			`› ${draft}${this.focused ? CURSOR_MARKER : ""}`,
			"Scroll: ↑/↓ PgUp/PgDn Home/End",
			"",
		];
		return [
			`┌${"─".repeat(Math.max(0, safeWidth - 2))}┐`,
			...contentLines.map((line) => boxLine(line, innerWidth)),
			`└${"─".repeat(Math.max(0, safeWidth - 2))}┘`,
		];
	}

	handleInput(data: string): void {
		if (isEscape(data)) {
			this.controller.close();
			this.done();
			this.tui?.requestRender();
			return;
		}
		if (isEnter(data)) {
			const draft = this.controller.getDraft().trim();
			if (draft) this.controller.submitDraft(draft);
			this.tui?.requestRender();
			return;
		}
		if (isBackspace(data)) {
			const draft = this.controller.getDraft();
			this.controller.setDraft(draft.slice(0, -1));
			this.tui?.requestRender();
			return;
		}
		if (isUp(data)) {
			this.scrollOffset += 1;
			this.tui?.requestRender();
			return;
		}
		if (isDown(data)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.tui?.requestRender();
			return;
		}
		if (isPageUp(data)) {
			this.scrollOffset += 8;
			this.tui?.requestRender();
			return;
		}
		if (isPageDown(data)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 8);
			this.tui?.requestRender();
			return;
		}
		if (isHome(data)) {
			this.scrollOffset = Number.MAX_SAFE_INTEGER;
			this.tui?.requestRender();
			return;
		}
		if (isEnd(data)) {
			this.scrollOffset = 0;
			this.tui?.requestRender();
			return;
		}
		if (isPrintable(data)) {
			this.controller.setDraft(this.controller.getDraft() + data);
			this.tui?.requestRender();
		}
	}

	private getTargetHeight(): number {
		const termHeight = this.tui?.terminal?.rows ?? FALLBACK_TERM_HEIGHT;
		const availableHeight = Math.max(1, termHeight - 4);
		const ratioHeight = Math.floor(termHeight * OVERLAY_HEIGHT_RATIO);
		return Math.max(
			Math.min(MIN_OVERLAY_HEIGHT, availableHeight),
			Math.min(ratioHeight, availableHeight),
		);
	}

	private getVisibleTranscriptLines(
		rows: SideChatTranscriptRow[],
		width: number,
		height: number,
	): string[] {
		const transcriptLines = rows.length === 0
			? new Text("No side-chat messages yet.", 0, 0).render(width)
			: rows.flatMap((row) => this.renderRow(row, width));
		const maxOffset = Math.max(0, transcriptLines.length - height);
		const offset = Math.min(this.scrollOffset, maxOffset);
		const end = transcriptLines.length - offset;
		const visible = transcriptLines.slice(Math.max(0, end - height), end);
		while (visible.length < height) visible.push("");
		return visible;
	}

	private renderRow(row: SideChatTranscriptRow, width: number): string[] {
		return this.renderRowComponent(row).render(width);
	}

	private renderRowComponent(row: SideChatTranscriptRow): Component {
		switch (row.type) {
			case "user-message":
				return new Text(`you: ${row.text}`, 0, 0);
			case "assistant-text":
				return new Markdown(
					`${row.streaming ? "gremlin is typing…\n" : "gremlin:\n"}${row.text || "…"}`,
					0,
					0,
					getMarkdownThemeSafely(),
				);
			case "turn-boundary":
				return new Text(row.phase === "start" ? "↳ turn started" : "↲ turn ended", 0, 0);
			case "status":
				return new Text(row.text, 0, 0);
		}
	}
}

function boxLine(line: string, innerWidth: number): string {
	const truncated = truncateToWidth(line, innerWidth, "…");
	const padding = Math.max(0, innerWidth - visibleWidth(truncated));
	return `│ ${truncated}${" ".repeat(padding)} │`;
}

function isEscape(data: string): boolean {
	return data === "\u001b" || matchesKey(data, Key.escape);
}

function isEnter(data: string): boolean {
	return data === "\r" || data === "\n" || matchesKey(data, Key.enter);
}

function isBackspace(data: string): boolean {
	return data === "\u007f" || data === "\b" || matchesKey(data, Key.backspace);
}

function isUp(data: string): boolean {
	return data === "\u001b[A" || matchesKey(data, Key.up);
}

function isDown(data: string): boolean {
	return data === "\u001b[B" || matchesKey(data, Key.down);
}

function isPageUp(data: string): boolean {
	return data === "\u001b[5~" || matchesKey(data, Key.pageUp);
}

function isPageDown(data: string): boolean {
	return data === "\u001b[6~" || matchesKey(data, Key.pageDown);
}

function isHome(data: string): boolean {
	return data === "\u001b[H" || matchesKey(data, Key.home);
}

function isEnd(data: string): boolean {
	return data === "\u001b[F" || matchesKey(data, Key.end);
}

function isPrintable(data: string): boolean {
	return data.length > 0 && !data.startsWith("\u001b") && data >= " ";
}

function formatStatus(status: SideChatTranscriptState["status"]): string {
	if (status === "replying") return "replying";
	if (status === "thinking") return "thinking";
	if (status === "tool") return "running tool";
	if (status === "error") return "error";
	return "idle";
}

function getMarkdownThemeSafely(): MarkdownTheme {
	try {
		return (getMarkdownTheme?.() ?? ({} as MarkdownTheme)) as MarkdownTheme;
	} catch {
		return {} as MarkdownTheme;
	}
}
