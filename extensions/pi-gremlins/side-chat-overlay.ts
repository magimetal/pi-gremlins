import {
	Container,
	Markdown,
	Spacer,
	Text,
	type Component,
	type MarkdownTheme,
	type OverlayOptions,
	type TUI,
} from "@mariozechner/pi-tui";

const CURSOR_MARKER = "\u001b_pi:c\u0007";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type { SideChatMode } from "./side-chat-session-factory.js";
import type {
	SideChatTranscriptRow,
	SideChatTranscriptState,
} from "./side-chat-transcript-state.js";

export const SIDE_CHAT_OVERLAY_OPTIONS: OverlayOptions = {
	anchor: "top-center",
	width: "78%",
	minWidth: 72,
	maxHeight: "78%",
	margin: { top: 1, left: 2, right: 2 },
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
	private focused = true;

	constructor(
		private readonly tui: TUI | undefined,
		private readonly controller: SideChatOverlayController,
		private readonly done: () => void,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const mode = this.controller.getMode();
		const state = this.controller.getTranscriptState();
		const draft = this.controller.getDraft();
		const container = new Container();
		container.addChild(
			new Text(
				`${mode === "chat" ? "💬 chat" : "🧭 tangent"} │ ${formatStatus(state.status)} │ Enter submits · Esc closes · Alt+/ focuses`,
				1,
				0,
			),
		);
		container.addChild(new Text("─".repeat(Math.max(8, width - 2)), 1, 0));
		const body = new Container();
		const visibleRows = this.getVisibleRows(state.rows, 18);
		if (visibleRows.length === 0) {
			body.addChild(new Text("No side-chat messages yet.", 1, 0));
		} else {
			for (const row of visibleRows) body.addChild(this.renderRow(row));
		}
		container.addChild(body);
		container.addChild(new Spacer(1));
		container.addChild(
			new Text(
				`› ${draft}${this.focused ? CURSOR_MARKER : ""}`,
				1,
				0,
			),
		);
		container.addChild(new Text("Scroll: ↑/↓ PgUp/PgDn Home/End", 1, 0));
		return container.render(width);
	}

	handleInput(data: string): void {
		if (data === "\u001b") {
			this.controller.close();
			this.done();
			this.tui?.requestRender();
			return;
		}
		if (data === "\r" || data === "\n") {
			const draft = this.controller.getDraft().trim();
			if (draft) this.controller.submitDraft(draft);
			this.tui?.requestRender();
			return;
		}
		if (data === "\u007f" || data === "\b") {
			const draft = this.controller.getDraft();
			this.controller.setDraft(draft.slice(0, -1));
			this.tui?.requestRender();
			return;
		}
		if (data === "\u001b[A") {
			this.scrollOffset += 1;
			this.tui?.requestRender();
			return;
		}
		if (data === "\u001b[B") {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.tui?.requestRender();
			return;
		}
		if (data === "\u001b[5~") {
			this.scrollOffset += 8;
			this.tui?.requestRender();
			return;
		}
		if (data === "\u001b[6~") {
			this.scrollOffset = Math.max(0, this.scrollOffset - 8);
			this.tui?.requestRender();
			return;
		}
		if (data === "\u001b[H") {
			this.scrollOffset = Number.MAX_SAFE_INTEGER;
			this.tui?.requestRender();
			return;
		}
		if (data === "\u001b[F") {
			this.scrollOffset = 0;
			this.tui?.requestRender();
			return;
		}
		if (isPrintable(data)) {
			this.controller.setDraft(this.controller.getDraft() + data);
			this.tui?.requestRender();
		}
	}

	setFocused(focused: boolean): void {
		this.focused = focused;
	}

	private getVisibleRows(
		rows: SideChatTranscriptRow[],
		maxRows: number,
	): SideChatTranscriptRow[] {
		const maxOffset = Math.max(0, rows.length - maxRows);
		const offset = Math.min(this.scrollOffset, maxOffset);
		const end = rows.length - offset;
		return rows.slice(Math.max(0, end - maxRows), end);
	}

	private renderRow(row: SideChatTranscriptRow): Component {
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
