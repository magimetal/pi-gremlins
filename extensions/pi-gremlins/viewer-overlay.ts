import {
	Container,
	type Focusable,
	Key,
	type KeybindingsManager,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";
import {
	formatAgentSourceBadgeText,
	getSingleResultStatus,
	type InvocationMode,
	type SingleResult,
} from "./execution-shared.js";
import type { InvocationSnapshot } from "./invocation-state.js";
import {
	buildViewerInvocationLine,
	buildViewerMetadataLine,
	buildViewerTelemetryLine,
	buildViewerTitleLine,
	getCachedInvocationBodyLines,
	getCachedWrappedBodyLines,
	VIEWER_TITLE,
	type ViewerBodyCacheEntry,
	type ViewerWrapCacheEntry,
} from "./viewer-body-cache.js";
import {
	getNavigatedViewerSelection,
	getRefreshedViewerSelection,
	getResultContextLabel,
	getViewerBodyHeight,
	getViewerChromeState,
	getViewerDialogHeight,
	getViewerNavigationHint,
	isViewerScrollToEndKey,
	isViewerScrollToStartKey,
	normalizeViewerTabs,
	VIEWER_SCROLL_LINE_STEP,
} from "./viewer-result-navigation.js";

type ViewerTheme = {
	fg: (color: any, text: string) => string;
	bold: (text: string) => string;
};

export class PiGremlinsViewerOverlay extends Container implements Focusable {
	private readonly tui: TUI;
	private readonly theme: ViewerTheme;
	private readonly keybindings: KeybindingsManager;
	private readonly readSnapshot: () => InvocationSnapshot | undefined;
	private readonly onDismiss: () => void;
	private bodyCache: ViewerBodyCacheEntry | null = null;
	private wrapCache: ViewerWrapCacheEntry | null = null;
	private titleLine = VIEWER_TITLE;
	private invocationLine = "";
	private metadataLine = "";
	private telemetryLine = "";
	private resultCount = 0;
	private snapshotMode: InvocationMode = "single";
	private selectedResult: SingleResult | undefined;
	private selectedResultIndex = 0;
	private scrollOffset = 0;
	private viewportHeight = 8;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	constructor(
		tui: TUI,
		theme: ViewerTheme,
		keybindings: KeybindingsManager,
		readSnapshot: () => InvocationSnapshot | undefined,
		onDismiss: () => void,
	) {
		super();
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.readSnapshot = readSnapshot;
		this.onDismiss = onDismiss;
		this.refresh();
	}

	private contentLine(
		content: string,
		dialogWidth: number,
		showFrame: boolean,
	): string {
		const innerWidth = Math.max(1, dialogWidth - (showFrame ? 2 : 0));
		const normalizedContent = normalizeViewerTabs(content);
		const truncated = truncateToWidth(normalizedContent, innerWidth, "…");
		const padding = Math.max(0, innerWidth - visibleWidth(truncated));
		if (!showFrame) return `${truncated}${" ".repeat(padding)}`;
		return `${this.theme.fg("borderMuted", "│")}${truncated}${" ".repeat(padding)}${this.theme.fg("borderMuted", "│")}`;
	}

	private borderLine(innerWidth: number, edge: "top" | "bottom"): string {
		const left = edge === "top" ? "┌" : "└";
		const right = edge === "top" ? "┐" : "┘";
		return this.theme.fg(
			"borderMuted",
			`${left}${"─".repeat(innerWidth)}${right}`,
		);
	}

	private ruleLine(innerWidth: number): string {
		return this.theme.fg("borderMuted", `├${"─".repeat(innerWidth)}┤`);
	}

	private getDialogHeight(): number {
		return getViewerDialogHeight(process.stdout.rows ?? 30);
	}

	private moveSelection(direction: -1 | 1): void {
		const snapshot = this.readSnapshot();
		const nextSelection = getNavigatedViewerSelection(
			{
				selectedResultIndex: this.selectedResultIndex,
				scrollOffset: this.scrollOffset,
			},
			snapshot?.results.length ?? 0,
			direction,
		);
		if (!nextSelection.changed) return;
		this.selectedResultIndex = nextSelection.selectedResultIndex;
		this.scrollOffset = nextSelection.scrollOffset;
		this.refresh();
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.onDismiss();
			return;
		}
		if (matchesKey(data, Key.left)) {
			this.moveSelection(-1);
			return;
		}
		if (matchesKey(data, Key.right)) {
			this.moveSelection(1);
			return;
		}
		if (matchesKey(data, Key.pageUp)) {
			this.scrollOffset = Math.max(
				0,
				this.scrollOffset - this.viewportHeight + 1,
			);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.pageDown)) {
			this.scrollOffset += this.viewportHeight - 1;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.up)) {
			this.scrollOffset = Math.max(
				0,
				this.scrollOffset - VIEWER_SCROLL_LINE_STEP,
			);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.scrollOffset += VIEWER_SCROLL_LINE_STEP;
			this.tui.requestRender();
			return;
		}
		if (isViewerScrollToStartKey(data)) {
			this.scrollOffset = 0;
			this.tui.requestRender();
			return;
		}
		if (isViewerScrollToEndKey(data)) {
			this.scrollOffset = Number.MAX_SAFE_INTEGER;
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const dialogWidth = Math.max(36, width);
		const innerWidth = Math.max(34, dialogWidth - 2);
		if (!this.bodyCache) {
			const snapshot = this.readSnapshot();
			const bodyState = getCachedInvocationBodyLines(
				null,
				snapshot,
				this.selectedResultIndex,
				this.theme,
			);
			this.bodyCache = bodyState.cache;
		}
		const wrappedBodyState = getCachedWrappedBodyLines(
			this.wrapCache,
			this.bodyCache,
			innerWidth,
		);
		this.wrapCache = wrappedBodyState.cache;
		const wrappedBody = wrappedBodyState.lines;
		const dialogHeight = this.getDialogHeight();
		const chromeState = getViewerChromeState(
			this.resultCount,
			dialogHeight,
			dialogWidth,
		);
		const bodyHeight = getViewerBodyHeight(
			dialogHeight,
			this.resultCount,
			dialogWidth,
		);
		this.viewportHeight = Math.max(1, bodyHeight);
		const maxScroll = Math.max(0, wrappedBody.length - bodyHeight);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));
		const visibleBody = wrappedBody.slice(
			this.scrollOffset,
			this.scrollOffset + bodyHeight,
		);
		const resultContextLine =
			this.selectedResult && chromeState.showResultContext
				? (getResultContextLabel(
						this.snapshotMode,
						this.selectedResultIndex,
						this.resultCount,
						{
							agent: this.selectedResult.agent,
							status: getSingleResultStatus(this.selectedResult),
							gremlinId: this.selectedResult.gremlinId,
							step: this.selectedResult.step,
							sourceBadge: this.theme.fg(
								"muted",
								formatAgentSourceBadgeText(this.selectedResult.agentSource),
							),
						},
						innerWidth,
					) ?? "")
				: "";
		const navigationHintLine = chromeState.showNavigationHint
			? (getViewerNavigationHint(this.resultCount, innerWidth) ?? "")
			: "";
		const lines: string[] = [];
		if (chromeState.showFrame) {
			lines.push(this.borderLine(innerWidth, "top"));
		}
		lines.push(
			this.contentLine(this.titleLine, dialogWidth, chromeState.showFrame),
		);
		if (chromeState.showMetadata) {
			lines.push(
				this.contentLine(this.metadataLine, dialogWidth, chromeState.showFrame),
			);
		}
		if (chromeState.showTelemetry) {
			lines.push(
				this.contentLine(
					this.telemetryLine,
					dialogWidth,
					chromeState.showFrame,
				),
			);
		}
		if (chromeState.showInvocation) {
			lines.push(
				this.contentLine(
					this.invocationLine,
					dialogWidth,
					chromeState.showFrame,
				),
			);
		}
		if (chromeState.showResultContext && resultContextLine) {
			lines.push(
				this.contentLine(resultContextLine, dialogWidth, chromeState.showFrame),
			);
		}
		if (chromeState.showTopRule) {
			lines.push(this.ruleLine(innerWidth));
		}
		for (const line of visibleBody) {
			lines.push(this.contentLine(line, dialogWidth, chromeState.showFrame));
		}
		for (let i = visibleBody.length; i < bodyHeight; i++) {
			lines.push(this.contentLine("", dialogWidth, chromeState.showFrame));
		}
		if (chromeState.showBottomRule) {
			lines.push(this.ruleLine(innerWidth));
		}
		if (chromeState.showNavigationHint && navigationHintLine) {
			lines.push(
				this.contentLine(
					navigationHintLine,
					dialogWidth,
					chromeState.showFrame,
				),
			);
		}
		if (chromeState.showFrame) {
			lines.push(this.borderLine(innerWidth, "bottom"));
		}
		return lines.slice(0, dialogHeight);
	}

	refresh(): void {
		const snapshot = this.readSnapshot();
		const resultCount = snapshot?.results.length ?? 0;
		const nextSelection = getRefreshedViewerSelection(
			{
				selectedResultIndex: this.selectedResultIndex,
				scrollOffset: this.scrollOffset,
			},
			resultCount,
		);
		this.selectedResultIndex = nextSelection.selectedResultIndex;
		this.scrollOffset = nextSelection.scrollOffset;
		this.resultCount = resultCount;
		this.snapshotMode = snapshot?.mode ?? "single";
		this.selectedResult =
			snapshot && resultCount > 0
				? snapshot.results[this.selectedResultIndex]
				: undefined;
		this.titleLine = buildViewerTitleLine(
			this.theme,
			snapshot?.status ?? "Running",
			this.snapshotMode,
		);
		this.metadataLine = buildViewerMetadataLine(
			this.theme,
			this.selectedResult,
		);
		this.telemetryLine = buildViewerTelemetryLine(
			this.theme,
			snapshot,
			this.selectedResultIndex,
		);
		this.invocationLine = buildViewerInvocationLine(
			this.theme,
			snapshot?.toolCallId,
		);
		const bodyState = getCachedInvocationBodyLines(
			this.bodyCache,
			snapshot,
			this.selectedResultIndex,
			this.theme,
		);
		this.bodyCache = bodyState.cache;
		this.tui.requestRender();
	}
}
