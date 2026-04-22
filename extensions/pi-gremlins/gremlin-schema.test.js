import { beforeEach, describe, expect, test } from "bun:test";

import {
	createRegisteredTool,
	resetV1ContractHarness,
} from "./v1-contract-harness.js";

describe("gremlin schema v1 contract", () => {
	beforeEach(() => {
		resetV1ContractHarness();
	});

	test("exposes only gremlins array input with 1..10 bounds and no legacy single parallel chain fields", () => {
		const tool = createRegisteredTool();

		expect(tool.parameters).toHaveProperty("gremlins");
		expect(tool.parameters.gremlins).toMatchObject({
			minItems: 1,
			maxItems: 10,
		});
		expect(tool.parameters.gremlins.value).toMatchObject({
			agent: expect.any(Object),
			context: expect.any(Object),
			cwd: expect.any(Object),
		});
		expect(tool.parameters.gremlins.value).not.toHaveProperty("task");

		for (const legacyField of [
			"agent",
			"task",
			"tasks",
			"chain",
			"agentScope",
			"confirmProjectAgents",
		]) {
			expect(tool.parameters).not.toHaveProperty(legacyField);
		}
	});

	test("describes v1 narrow surface without mode scope chain or popup language", () => {
		const tool = createRegisteredTool();

		expect(tool.description).toContain("gremlins");
		expect(tool.description).toContain("parallel");
		expect(tool.description).not.toContain("Modes:");
		expect(tool.description).not.toContain("chain");
		expect(tool.description).not.toContain("agentScope");
		expect(tool.description).not.toContain("popup");
	});
});
