import { describe, expect, test } from "bun:test";
import "./v1-contract-harness.js";
import {
	restoreSideChatThreadsFromBranch,
	SIDE_CHAT_RESET_ENTRY_TYPE,
	SIDE_CHAT_THREAD_ENTRY_TYPE,
} from "./side-chat-persistence.ts";

describe("side-chat persistence", () => {
	test("restores only entries after latest per-mode reset", () => {
		const branch = [
			{ type: "custom", customType: SIDE_CHAT_THREAD_ENTRY_TYPE, data: { mode: "chat", question: "old", answer: "old-a", timestamp: 1 } },
			{ type: "custom", customType: SIDE_CHAT_THREAD_ENTRY_TYPE, data: { mode: "tangent", question: "t1", answer: "t-a", timestamp: 2 } },
			{ type: "custom", customType: SIDE_CHAT_RESET_ENTRY_TYPE, data: { mode: "chat", timestamp: 3 } },
			{ type: "custom", customType: SIDE_CHAT_THREAD_ENTRY_TYPE, data: { mode: "chat", question: "new", answer: "new-a", timestamp: 4 } },
		];
		const restored = restoreSideChatThreadsFromBranch(branch);
		expect(restored.chat.exchanges.map((entry) => entry.question)).toEqual(["new"]);
		expect(restored.tangent.exchanges.map((entry) => entry.question)).toEqual(["t1"]);
	});
});
