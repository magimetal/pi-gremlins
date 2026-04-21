import { describe, expect, mock, test } from "bun:test";

mock.module("@mariozechner/pi-tui", () => {
	const Key = {
		home: "home",
		end: "end",
		up: "up",
		down: "down",
		ctrl: (key) => `ctrl-${key}`,
	};
	const keyMap = new Map([
		["\x1b[H", Key.home],
		["\x1bOa", Key.ctrl(Key.up)],
		["\x1b[57419;5u", Key.ctrl(Key.up)],
		["\x1b[F", Key.end],
		["\x1bOb", Key.ctrl(Key.down)],
		["\x1b[57420;5u", Key.ctrl(Key.down)],
	]);
	return {
		Key,
		parseKey: (data) => keyMap.get(data) ?? null,
		truncateToWidth: (text, width, suffix = "") => {
			if (text.length <= width) return text;
			const budget = Math.max(0, width - suffix.length);
			return text.slice(0, budget) + suffix;
		},
		visibleWidth: (text) => text.length,
	};
});

const { truncateToWidth, visibleWidth } = await import("@mariozechner/pi-tui");

const viewerNavigationModuleUrl = new URL(
	"./viewer-result-navigation.ts?actual-viewer-navigation",
	import.meta.url,
).href;

const {
	buildSelectedResultBodyLines,
	getNavigatedViewerSelection,
	getRefreshedViewerSelection,
	getResultContextLabel,
	getViewerBodyHeight,
	getViewerChromeRowCount,
	getViewerChromeState,
	getViewerDialogHeight,
	getViewerNavigationHint,
	getViewerOverlayOptions,
	hasMultiResultNavigation,
	isViewerScrollToEndKey,
	isViewerScrollToStartKey,
	normalizeViewerTabs,
	VIEWER_SCROLL_LINE_STEP,
} = await import(viewerNavigationModuleUrl);

describe("viewer result navigation", () => {
	test("shows result chrome only for multi-result popup states", () => {
		expect(hasMultiResultNavigation(0)).toBe(false);
		expect(hasMultiResultNavigation(1)).toBe(false);
		expect(hasMultiResultNavigation(2)).toBe(true);
		expect(getViewerChromeState(0)).toEqual({
			showFrame: true,
			showInvocation: true,
			showMetadata: true,
			showResultContext: false,
			showTopRule: true,
			showBottomRule: true,
			showNavigationHint: false,
			chromeRowCount: 7,
		});
		expect(getViewerChromeState(1)).toEqual({
			showFrame: true,
			showInvocation: true,
			showMetadata: true,
			showResultContext: false,
			showTopRule: true,
			showBottomRule: true,
			showNavigationHint: false,
			chromeRowCount: 7,
		});
		expect(getViewerChromeState(3)).toEqual({
			showFrame: true,
			showInvocation: true,
			showMetadata: true,
			showResultContext: true,
			showTopRule: true,
			showBottomRule: true,
			showNavigationHint: true,
			chromeRowCount: 9,
		});
		expect(getViewerChromeRowCount(1)).toBe(7);
		expect(getViewerChromeRowCount(3)).toBe(9);
		expect(getViewerBodyHeight(24, 1)).toBe(17);
		expect(getViewerBodyHeight(24, 3)).toBe(15);
		expect(getViewerBodyHeight(12, 3)).toBe(3);
	});

	test("keeps rendered chrome and body within overlay height budget for all terminal sizes", () => {
		for (let terminalRows = 1; terminalRows <= 40; terminalRows++) {
			const dialogHeight = getViewerDialogHeight(terminalRows);
			for (const resultCount of [1, 3]) {
				const chromeState = getViewerChromeState(resultCount, dialogHeight);
				const bodyHeight = getViewerBodyHeight(dialogHeight, resultCount);
				expect(chromeState.chromeRowCount + bodyHeight).toBeLessThanOrEqual(
					dialogHeight,
				);
			}
		}
	});

	test("suppresses optional chrome intentionally on short terminals", () => {
		const cases = [
			{
				terminalRows: 8,
				expected: {
					dialogHeight: 5,
					showFrame: true,
					showInvocation: false,
					showMetadata: true,
					showResultContext: false,
					showTopRule: false,
					showBottomRule: false,
					showNavigationHint: false,
					chromeRowCount: 4,
					bodyHeight: 1,
				},
			},
			{
				terminalRows: 10,
				expected: {
					dialogHeight: 6,
					showFrame: true,
					showInvocation: true,
					showMetadata: true,
					showResultContext: false,
					showTopRule: false,
					showBottomRule: false,
					showNavigationHint: false,
					chromeRowCount: 5,
					bodyHeight: 1,
				},
			},
			{
				terminalRows: 12,
				expected: {
					dialogHeight: 8,
					showFrame: true,
					showInvocation: true,
					showMetadata: true,
					showResultContext: true,
					showTopRule: false,
					showBottomRule: false,
					showNavigationHint: true,
					chromeRowCount: 7,
					bodyHeight: 1,
				},
			},
			{
				terminalRows: 13,
				expected: {
					dialogHeight: 9,
					showFrame: true,
					showInvocation: true,
					showMetadata: true,
					showResultContext: true,
					showTopRule: false,
					showBottomRule: false,
					showNavigationHint: true,
					chromeRowCount: 7,
					bodyHeight: 2,
				},
			},
		];

		for (const testCase of cases) {
			const dialogHeight = getViewerDialogHeight(testCase.terminalRows);
			const chromeState = getViewerChromeState(3, dialogHeight);
			const bodyHeight = getViewerBodyHeight(dialogHeight, 3);
			expect(dialogHeight).toBe(testCase.expected.dialogHeight);
			expect(chromeState).toEqual({
				showFrame: testCase.expected.showFrame,
				showInvocation: testCase.expected.showInvocation,
				showMetadata: testCase.expected.showMetadata,
				showResultContext: testCase.expected.showResultContext,
				showTopRule: testCase.expected.showTopRule,
				showBottomRule: testCase.expected.showBottomRule,
				showNavigationHint: testCase.expected.showNavigationHint,
				chromeRowCount: testCase.expected.chromeRowCount,
			});
			expect(bodyHeight).toBe(testCase.expected.bodyHeight);
			expect(chromeState.chromeRowCount + bodyHeight).toBe(dialogHeight);
		}
	});

	test("surfaces full popup hints and keeps overlay keyboard-capturing", () => {
		expect(getViewerNavigationHint(1)).toBeNull();
		expect(getViewerNavigationHint(3)).toBe(
			"←/→ result · ↑/↓ scroll · PgUp/PgDn page · Home/End/Ctrl+↑/Ctrl+↓ · Esc close",
		);
		expect(VIEWER_SCROLL_LINE_STEP).toBe(3);
		expect(getViewerOverlayOptions()).toEqual({
			width: "78%",
			minWidth: 72,
			maxHeight: "78%",
			anchor: "top-center",
			margin: { top: 1, left: 2, right: 2 },
		});
	});

	test("treats legacy and CSI-u ctrl+up/down as home/end viewer aliases", () => {
		expect(isViewerScrollToStartKey("\x1b[H")).toBe(true);
		expect(isViewerScrollToStartKey("\x1bOa")).toBe(true);
		expect(isViewerScrollToStartKey("\x1b[57419;5u")).toBe(true);
		expect(isViewerScrollToStartKey("\x1b[A")).toBe(false);
		expect(isViewerScrollToEndKey("\x1b[F")).toBe(true);
		expect(isViewerScrollToEndKey("\x1bOb")).toBe(true);
		expect(isViewerScrollToEndKey("\x1b[57420;5u")).toBe(true);
		expect(isViewerScrollToEndKey("\x1b[B")).toBe(false);
	});

	test("keeps single-result body shape to task line plus result content only", () => {
		expect(
			buildSelectedResultBodyLines("Task: inspect output", [
				"assistant line",
				"tool result line",
			]),
		).toEqual(["Task: inspect output", "assistant line", "tool result line"]);
	});

	test("normalizes tab-indented viewer lines before width truncation", () => {
		const widthBudget = 20;
		const rawLine = "prefix:\t012345678901234";
		const truncatedRaw = truncateToWidth(rawLine, widthBudget, "");
		const renderedWidthBeforeFix = visibleWidth(
			truncatedRaw.replace(/\t/g, "    "),
		);
		expect(renderedWidthBeforeFix).toBeGreaterThan(widthBudget);

		const normalizedLine = normalizeViewerTabs(rawLine);
		const truncatedNormalized = truncateToWidth(
			normalizedLine,
			widthBudget,
			"",
		);
		expect(normalizedLine).not.toContain("\t");
		expect(visibleWidth(truncatedNormalized)).toBeLessThanOrEqual(widthBudget);
	});

	test("clamps left and right navigation and resets scroll only on actual change", () => {
		expect(
			getNavigatedViewerSelection(
				{ selectedResultIndex: 0, scrollOffset: 11 },
				0,
				1,
			),
		).toEqual({
			selectedResultIndex: 0,
			scrollOffset: 11,
			changed: false,
		});
		expect(
			getNavigatedViewerSelection(
				{ selectedResultIndex: 2, scrollOffset: 11 },
				3,
				1,
			),
		).toEqual({
			selectedResultIndex: 2,
			scrollOffset: 11,
			changed: false,
		});
		expect(
			getNavigatedViewerSelection(
				{ selectedResultIndex: 1, scrollOffset: 11 },
				3,
				1,
			),
		).toEqual({
			selectedResultIndex: 2,
			scrollOffset: 0,
			changed: true,
		});
		expect(
			getNavigatedViewerSelection(
				{ selectedResultIndex: 1, scrollOffset: 11 },
				3,
				-1,
			),
		).toEqual({
			selectedResultIndex: 0,
			scrollOffset: 0,
			changed: true,
		});
	});

	test("preserves selection across refresh and clamps cleanly when result count changes", () => {
		expect(
			getRefreshedViewerSelection(
				{ selectedResultIndex: 0, scrollOffset: 0 },
				0,
			),
		).toEqual({
			selectedResultIndex: 0,
			scrollOffset: 0,
			changed: false,
		});
		expect(
			getRefreshedViewerSelection(
				{ selectedResultIndex: 0, scrollOffset: 0 },
				1,
			),
		).toEqual({
			selectedResultIndex: 0,
			scrollOffset: 0,
			changed: false,
		});
		expect(
			getRefreshedViewerSelection(
				{ selectedResultIndex: 2, scrollOffset: 7 },
				3,
			),
		).toEqual({
			selectedResultIndex: 2,
			scrollOffset: 7,
			changed: false,
		});
		expect(
			getRefreshedViewerSelection(
				{ selectedResultIndex: 2, scrollOffset: 7 },
				2,
			),
		).toEqual({
			selectedResultIndex: 1,
			scrollOffset: 0,
			changed: true,
		});
	});

	test("formats chain and parallel context labels only for multi-result runs", () => {
		expect(
			getResultContextLabel("chain", 1, 3, {
				agent: "researcher",
				status: "Running",
				step: 2,
			}),
		).toBe("Result: Step 2/3 · researcher · Running");
		expect(
			getResultContextLabel("parallel", 1, 3, {
				agent: "reviewer",
				status: "Completed",
			}),
		).toBe("Result: Task 2/3 · reviewer · Completed");
		expect(
			getResultContextLabel("single", 0, 1, {
				agent: "writer",
				status: "Completed",
			}),
		).toBeNull();
	});
});
