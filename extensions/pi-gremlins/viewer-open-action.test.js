import { describe, expect, test } from "bun:test";
import { getViewerOpenAction } from "./viewer-open-action.ts";

describe("getViewerOpenAction", () => {
	test("opens new viewer when no runtime exists", () => {
		expect(getViewerOpenAction(null)).toBe("open-new");
	});

	test("focuses existing overlay when handle already attached", () => {
		expect(getViewerOpenAction({ handle: {} })).toBe("focus-existing");
	});

	test("does not allow duplicate open while existing overlay still attaching", () => {
		expect(getViewerOpenAction({})).toBe("await-existing");
	});

	test("allows reopen after runtime closed", () => {
		expect(getViewerOpenAction({ closed: true })).toBe("open-new");
	});
});
