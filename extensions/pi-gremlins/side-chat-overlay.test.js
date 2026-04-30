import { describe, expect, test } from "bun:test";
import "./v1-contract-harness.js";
import { SideChatOverlayComponent } from "./side-chat-overlay.ts";
import { createInitialSideChatTranscriptState } from "./side-chat-transcript-state.ts";

describe("side-chat overlay component", () => {
	test("edits draft, submits enter, and closes escape", () => {
		let draft = "";
		let submitted = "";
		let closed = false;
		let done = false;
		const component = new SideChatOverlayComponent(
			{ requestRender() {} },
			{
				getMode: () => "chat",
				getTranscriptState: () => createInitialSideChatTranscriptState(),
				getDraft: () => draft,
				setDraft: (value) => { draft = value; },
				submitDraft: (value) => { submitted = value; draft = ""; },
				close: () => { closed = true; },
			},
			() => { done = true; },
		);
		component.handleInput("h");
		component.handleInput("i");
		expect(draft).toBe("hi");
		component.handleInput("\r");
		expect(submitted).toBe("hi");
		component.handleInput("\u001b");
		expect(closed).toBe(true);
		expect(done).toBe(true);
	});
});
