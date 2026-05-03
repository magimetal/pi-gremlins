import { describe, expect, test } from "bun:test";
import "../fixtures/v1-contract-harness.js";

describe("side-chat overlay component", () => {
	test("edits draft, submits enter, and closes escape", async () => {
		const { SideChatOverlayComponent } = await import("../../side-chat/side-chat-overlay.ts");
		const { createInitialSideChatTranscriptState } = await import("../../side-chat/side-chat-transcript-state.ts");
		let draft = "";
		let submitted = "";
		let closed = false;
		let done = false;
		let renderRequests = 0;
		const component = new SideChatOverlayComponent(
			{
				requestRender() { renderRequests += 1; },
				terminal: { rows: 30 },
			},
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
		expect(renderRequests).toBeGreaterThan(0);
	});

	test("renders bordered 80vh-height overlay with internal transcript space", async () => {
		const { SideChatOverlayComponent } = await import("../../side-chat/side-chat-overlay.ts");
		const { createInitialSideChatTranscriptState } = await import("../../side-chat/side-chat-transcript-state.ts");
		const component = new SideChatOverlayComponent(
			{ requestRender() {}, terminal: { rows: 30 } },
			{
				getMode: () => "chat",
				getTranscriptState: () => createInitialSideChatTranscriptState(),
				getDraft: () => "",
				setDraft: () => {},
				submitDraft: () => {},
				close: () => {},
			},
			() => {},
		);
		const lines = component.render(72);
		expect(lines.length).toBe(24);
		expect(lines[0]).toStartWith("┌");
		expect(lines.at(-1)).toStartWith("└");
		expect(lines.join("\n")).toContain("No side-chat messages yet.");
	});
});
