import { Key, parseKey } from "@mariozechner/pi-tui";

export type ViewerResultContextMode = "single" | "parallel" | "chain";

export interface ViewerResultContext {
	agent: string;
	status: string;
	step?: number;
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
	showInvocation: boolean;
	showMetadata: boolean;
	showResultContext: boolean;
	showTopRule: boolean;
	showBottomRule: boolean;
	showNavigationHint: boolean;
	chromeRowCount: number;
}

const BASE_VIEWER_CHROME_ROW_COUNT = 7;
const MULTI_RESULT_EXTRA_CHROME_ROW_COUNT = 2;
const VIEWER_DIALOG_MAX_HEIGHT = 32;
const VIEWER_TAB_REPLACEMENT = "    ";
const VIEWER_OVERLAY_MAX_HEIGHT_RATIO = 0.78;
const VIEWER_OVERLAY_TOP_MARGIN = 1;
const MIN_DIALOG_HEIGHT_FOR_FRAME = 3;
const MIN_DIALOG_HEIGHT_FOR_METADATA = 5;
const MIN_DIALOG_HEIGHT_FOR_INVOCATION = 6;
const MIN_DIALOG_HEIGHT_FOR_RESULT_CONTEXT = 7;
const MIN_DIALOG_HEIGHT_FOR_NAVIGATION_HINT = 8;
const MIN_DIALOG_HEIGHT_FOR_FULL_SINGLE_CHROME =
	BASE_VIEWER_CHROME_ROW_COUNT + 1;
const MIN_DIALOG_HEIGHT_FOR_FULL_MULTI_CHROME =
	BASE_VIEWER_CHROME_ROW_COUNT + MULTI_RESULT_EXTRA_CHROME_ROW_COUNT + 1;

export const VIEWER_SCROLL_LINE_STEP = 3;

const VIEWER_SCROLL_TO_START_KEYS: string[] = [
	Key.home,
	Key.ctrl(Key.home),
	Key.ctrl(Key.up),
];

const VIEWER_SCROLL_TO_END_KEYS: string[] = [
	Key.end,
	Key.ctrl(Key.end),
	Key.ctrl(Key.down),
];

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
): ViewerChromeState {
	const boundedDialogHeight = Math.max(1, dialogHeight);
	const showMultiResultChrome = hasMultiResultNavigation(resultCount);
	const showFrame = boundedDialogHeight >= MIN_DIALOG_HEIGHT_FOR_FRAME;
	const showMetadata = boundedDialogHeight >= MIN_DIALOG_HEIGHT_FOR_METADATA;
	const showInvocation =
		boundedDialogHeight >= MIN_DIALOG_HEIGHT_FOR_INVOCATION;
	const showResultContext =
		showMultiResultChrome &&
		boundedDialogHeight >= MIN_DIALOG_HEIGHT_FOR_RESULT_CONTEXT;
	const showNavigationHint =
		showMultiResultChrome &&
		boundedDialogHeight >= MIN_DIALOG_HEIGHT_FOR_NAVIGATION_HINT;
	const showFullChromeRules =
		showFrame &&
		boundedDialogHeight >=
			(showMultiResultChrome
				? MIN_DIALOG_HEIGHT_FOR_FULL_MULTI_CHROME
				: MIN_DIALOG_HEIGHT_FOR_FULL_SINGLE_CHROME);
	const chromeRowCount =
		1 +
		(showFrame ? 2 : 0) +
		(showInvocation ? 1 : 0) +
		(showMetadata ? 1 : 0) +
		(showResultContext ? 1 : 0) +
		(showFullChromeRules ? 2 : 0) +
		(showNavigationHint ? 1 : 0);

	return {
		showFrame,
		showInvocation,
		showMetadata,
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
): number {
	return getViewerChromeState(resultCount, dialogHeight).chromeRowCount;
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
): number {
	return Math.max(
		0,
		dialogHeight - getViewerChromeRowCount(resultCount, dialogHeight),
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

export function getViewerNavigationHint(resultCount: number): string | null {
	if (!hasMultiResultNavigation(resultCount)) return null;
	return "←/→ result · ↑/↓ scroll · PgUp/PgDn page · Home/End/Ctrl+↑/Ctrl+↓ · Esc close";
}

export function getViewerOverlayOptions() {
	return {
		width: "78%",
		minWidth: 72,
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
): string | null {
	if (!hasMultiResultNavigation(resultCount)) return null;
	if (mode === "chain") {
		return `Result: Step ${result.step ?? selectedResultIndex + 1}/${resultCount} · ${result.agent} · ${result.status}`;
	}
	if (mode === "parallel") {
		return `Result: Task ${selectedResultIndex + 1}/${resultCount} · ${result.agent} · ${result.status}`;
	}
	return `Result: Item ${selectedResultIndex + 1}/${resultCount} · ${result.agent} · ${result.status}`;
}
