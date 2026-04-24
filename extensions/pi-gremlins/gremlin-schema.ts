import { Type } from "typebox";

export const GremlinRequestSchema = Type.Object({
	agent: Type.String({ description: "Name of gremlin to invoke" }),
	context: Type.String({ description: "Task or context for gremlin" }),
	cwd: Type.Optional(
		Type.String({ description: "Optional working directory for gremlin" }),
	),
});

export const PiGremlinsParams = Type.Object({
	gremlins: Type.Array(GremlinRequestSchema, {
		description:
			"Gremlins to run. One entry runs single gremlin. Multiple entries start in parallel.",
		minItems: 1,
		maxItems: 10,
	}),
});

export type GremlinSource = "user" | "project" | "unknown";
export type GremlinStatus =
	| "queued"
	| "starting"
	| "active"
	| "completed"
	| "failed"
	| "canceled";

export interface GremlinRequest {
	agent: string;
	context: string;
	cwd?: string;
}

export interface GremlinUsage {
	turns: number;
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: number;
	contextTokens?: number;
}

export type GremlinActivityKind =
	| "error"
	| "tool-call"
	| "tool-result"
	| "text"
	| "task"
	| "idle";

export interface GremlinActivity {
	kind: GremlinActivityKind;
	text: string;
	phase?: string;
	timestamp?: number;
	sequence?: number;
}

export interface GremlinInvocationEntry {
	gremlinId?: string;
	agent: string;
	source: GremlinSource;
	status: GremlinStatus;
	context: string;
	cwd?: string;
	model?: string;
	thinking?: string;
	currentPhase?: string;
	latestText?: string;
	latestToolCall?: string;
	latestToolResult?: string;
	errorMessage?: string;
	activities?: GremlinActivity[];
	usage?: GremlinUsage;
	startedAt?: number;
	finishedAt?: number;
	revision?: number;
}

export interface GremlinInvocationDetails {
	requestedCount: number;
	activeCount: number;
	completedCount: number;
	failedCount: number;
	canceledCount: number;
	gremlins: GremlinInvocationEntry[];
	revision?: number;
}

export interface GremlinRunResult extends GremlinInvocationEntry {}
