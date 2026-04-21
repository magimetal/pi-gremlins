import {
	Key,
	parseKey,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";

export type ViewerResultContextMode = "single" | "parallel" | "chain";

export interface ViewerResultContext {
	agent: string;
	status: string;
	gremlinId: string;
	step?: number;
	sourceBadge?: string;
}

export interface ViewerSelectionState {
	selectedResultIndex: number;
	scrollOffset: number;
}

export interface ViewerSelectionTransition extends ViewerSelectionState {
	changed: boolean;
}

export interface ViewerChromeState {
	showFrame: boolean;
	showMetadata: boolean;
	showTelemetry: boolean;
	showInvocation: boolean;
	showResultContext: boolean;
	showTopRule: boolean;
	showBottomRule: boolean;
	showNavigationHint: boolean;
	chromeRowCount: number;
}

const BASE_VIEWER_CHROME_ROW_COUNT = 8;
const MULTI_RESULT_EXTRA_CHROME_ROW_COUNT = 2;
const VIEWER_DIALOG_MAX_HEIGHT = 32;
const VIEWER_TAB_REPLACEMENT = "    ";
const VIEWER_OVERLAY_MAX_HEIGHT_RATIO = 0.78;
const VIEWER_OVERLAY_TOP_MARGIN = 1;
const MIN_DIALOG_HEIGHT_FOR_FRAME = 3;
const MIN_DIALOG_HEIGHT_FOR_METADATA = 5;
const MIN_DIALOG_HEIGHT_FOR_TELEMETRY = 6;
const MIN_DIALOG_HEIGHT_FOR_INVOCATION = 7;
const MIN_DIALOG_HEIGHT_FOR_RESULT_CONTEXT = 8;
const MIN_DIALOG_HEIGHT_FOR_NAVIGATION_HINT = 10;
const MIN_DIALOG_HEIGHT_FOR_FULL_SINGLE_CHROME =
	BASE_VIEWER_CHROME_ROW_COUNT + 1;
const MIN_DIALOG_HEIGHT_FOR_FULL_MULTI_CHROME =
	BASE_VIEWER_CHROME_ROW_COUNT + MULTI_RESULT_EXTRA_CHROME_ROW_COUNT + 1;
const MIN_DIALOG_WIDTH_FOR_INVOCATION = 40;
const MIN_DIALOG_WIDTH_FOR_RESULT_CONTEXT = 44;
const MIN_DIALOG_WIDTH_FOR_NAVIGATION_HINT = 64;

export const VIEWER_SCROLL_LINE_STEP = 3;

const VIEWER_SCROLL_TO_START_KEYS: string[] = [
	Key.home,
	Key.ctrl(Key.home),
	Key.alt(Key.up),
];

const VIEWER_SCROLL_TO_END_KEYS: string[] = [
	Key.end,
	Key.ctrl(Key.end),
	Key.alt(Key.down),
];

function clampLine(text: string, width: number): string {
	if (visibleWidth(text) <= width) return text;
	return truncateToWidth(text, Math.max(1, width), "…");
}

function pickLineVariant(width: number, variants: readonly string[]): string {
	for (const variant of variants) {
		if (visibleWidth(variant) <= width) return variant;
	}
	return clampLine(variants.at(-1) ?? "", width);
}

export function clampSelectedResultIndex(
	selectedResultIndex: number,
	resultCount: number,
): number {
	if (resultCount <= 0) return 0;
	return Math.max(0, Math.min(selectedResultIndex, resultCount - 1));
}

export function hasMultiResultNavigation(resultCount: number): boolean {
	return resultCount > 1;
}

export function getViewerChromeState(
	resultCount: number,
	dialogHeight = VIEWER_DIALOG_MAX_HEIGHT,
	dialogWidth = 72,
): ViewerChromeState {
	const boundedDialogHeight = Math.max(1, dialogHeight);
	const boundedDialogWidth = Math.max(24, dialogWidth);
	const showMultiResultChrome = hasMultiResultNavigation(resultCount);
	const showFrame = boundedDialogHeight >= MIN_DIALOG_HEIGHT_FOR_FRAME;
	const showMetadata = boundedDialogHeight >= MIN_DIALOG_HEIGHT_FOR_METADATA;
	const showTelemetry = boundedDialogHeight >= MIN_DIALOG_HEIGHT_FOR_TELEMETRY;
	const showInvocation =
		boundedDialogHeight >= MIN_DIALOG_HEIGHT_FOR_INVOCATION &&
		boundedDialogWidth >= MIN_DIALOG_WIDTH_FOR_INVOCATION;
	const showResultContext =
		showMultiResultChrome &&
		boundedDialogHeight >= MIN_DIALOG_HEIGHT_FOR_RESULT_CONTEXT &&
		boundedDialogWidth >= MIN_DIALOG_WIDTH_FOR_RESULT_CONTEXT;
	const showNavigationHint =
		showMultiResultChrome &&
		boundedDialogHeight >= MIN_DIALOG_HEIGHT_FOR_NAVIGATION_HINT &&
		boundedDialogWidth >= MIN_DIALOG_WIDTH_FOR_NAVIGATION_HINT;
	const showFullChromeRules =
		showFrame &&
		boundedDialogHeight >=
			(showMultiResultChrome
				? MIN_DIALOG_HEIGHT_FOR_FULL_MULTI_CHROME
				: MIN_DIALOG_HEIGHT_FOR_FULL_SINGLE_CHROME);
	const chromeRowCount =
		1 +
		(showFrame ? 2 : 0) +
		(showMetadata ? 1 : 0) +
		(showTelemetry ? 1 : 0) +
		(showInvocation ? 1 : 0) +
		(showResultContext ? 1 : 0) +
		(showFullChromeRules ? 2 : 0) +
		(showNavigationHint ? 1 : 0);

	return {
		showFrame,
		showMetadata,
		showTelemetry,
		showInvocation,
		showResultContext,
		showTopRule: showFullChromeRules,
		showBottomRule: showFullChromeRules,
		showNavigationHint,
		chromeRowCount,
	};
}

export function getAdjacentResultSelection(
	selectedResultIndex: number,
	resultCount: number,
	direction: -1 | 1,
): { selectedResultIndex: number; changed: boolean } {
	const currentIndex = clampSelectedResultIndex(
		selectedResultIndex,
		resultCount,
	);
	if (!hasMultiResultNavigation(resultCount)) {
		return { selectedResultIndex: 0, changed: currentIndex !== 0 };
	}
	const nextIndex = clampSelectedResultIndex(
		currentIndex + direction,
		resultCount,
	);
	return {
		selectedResultIndex: nextIndex,
		changed: nextIndex !== currentIndex,
	};
}

export function getNavigatedViewerSelection(
	state: ViewerSelectionState,
	resultCount: number,
	direction: -1 | 1,
): ViewerSelectionTransition {
	const nextSelection = getAdjacentResultSelection(
		state.selectedResultIndex,
		resultCount,
		direction,
	);
	return {
		selectedResultIndex: nextSelection.selectedResultIndex,
		scrollOffset: nextSelection.changed ? 0 : state.scrollOffset,
		changed: nextSelection.changed,
	};
}

export function getRefreshedViewerSelection(
	state: ViewerSelectionState,
	resultCount: number,
): ViewerSelectionTransition {
	const selectedResultIndex = clampSelectedResultIndex(
		state.selectedResultIndex,
		resultCount,
	);
	const changed = selectedResultIndex !== state.selectedResultIndex;
	return {
		selectedResultIndex,
		scrollOffset: changed ? 0 : state.scrollOffset,
		changed,
	};
}

export function getViewerChromeRowCount(
	resultCount: number,
	dialogHeight = VIEWER_DIALOG_MAX_HEIGHT,
	dialogWidth = 72,
): number {
	return getViewerChromeState(resultCount, dialogHeight, dialogWidth)
		.chromeRowCount;
}

export function getViewerDialogHeight(terminalRows: number): number {
	const overlayMaxHeight = Math.max(
		1,
		Math.floor(terminalRows * VIEWER_OVERLAY_MAX_HEIGHT_RATIO),
	);
	const availableDialogHeight = Math.max(
		1,
		overlayMaxHeight - VIEWER_OVERLAY_TOP_MARGIN,
	);
	return Math.min(VIEWER_DIALOG_MAX_HEIGHT, availableDialogHeight);
}

export function getViewerBodyHeight(
	dialogHeight: number,
	resultCount: number,
	dialogWidth = 72,
): number {
	return Math.max(
		0,
		dialogHeight -
			getViewerChromeRowCount(resultCount, dialogHeight, dialogWidth),
	);
}

export function buildSelectedResultBodyLines(
	taskLine: string,
	contentLines: string[],
): string[] {
	return [taskLine, ...contentLines];
}

export function normalizeViewerTabs(line: string): string {
	if (!line.includes("\t")) return line;
	return line.replace(/\t/g, VIEWER_TAB_REPLACEMENT);
}

export function isViewerScrollToStartKey(data: string): boolean {
	const parsedKey = parseKey(data);
	return parsedKey ? VIEWER_SCROLL_TO_START_KEYS.includes(parsedKey) : false;
}

export function isViewerScrollToEndKey(data: string): boolean {
	const parsedKey = parseKey(data);
	return parsedKey ? VIEWER_SCROLL_TO_END_KEYS.includes(parsedKey) : false;
}

export function getViewerNavigationHint(
	resultCount: number,
	dialogWidth = 72,
): string | null {
	if (!hasMultiResultNavigation(resultCount)) return null;
	return pickLineVariant(dialogWidth, [
		"←/→ result · ↑/↓ scroll · PgUp/PgDn page · Home/End/Alt+↑/Alt+↓ · Esc close",
		"←/→ result · ↑/↓ scroll · PgUp/PgDn · Home/End · Esc close",
		"←/→ result · ↑/↓ scroll · Esc close",
	]);
}

export function getViewerOverlayOptions() {
	return {
		width: "78%",
		minWidth: 60,
		maxHeight: "78%",
		anchor: "top-center",
		margin: { top: 1, left: 2, right: 2 },
	} as const;
}

export function getResultContextLabel(
	mode: ViewerResultContextMode,
	selectedResultIndex: number,
	resultCount: number,
	result: ViewerResultContext,
	dialogWidth = 72,
): string | null {
	if (!hasMultiResultNavigation(resultCount)) return null;
	const position =
		mode === "chain"
			? `step ${result.step ?? selectedResultIndex + 1}/${resultCount}`
			: mode === "parallel"
				? `task ${selectedResultIndex + 1}/${resultCount}`
				: `item ${selectedResultIndex + 1}/${resultCount}`;
	const sourceBadge = result.sourceBadge ? ` ${result.sourceBadge}` : "";
	return pickLineVariant(dialogWidth, [
		`focus · ${position} · ${result.agent}${sourceBadge} · ${result.status} · ${result.gremlinId}`,
		`${position} · ${result.agent}${sourceBadge} · ${result.status} · ${result.gremlinId}`,
		`${position} · ${result.agent}${sourceBadge} · ${result.gremlinId}`,
	]);
}
