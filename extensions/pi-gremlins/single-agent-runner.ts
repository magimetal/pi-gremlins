import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	AssistantMessage,
	Message,
	ToolResultMessage,
	UserMessage,
} from "@mariozechner/pi-ai";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { resolveAgentByName } from "./agents.js";
import type {
	RunSingleAgentFn,
	SteerableSessionCallbacks,
} from "./execution-modes.js";
import {
	bumpResultDerivedRevision,
	bumpResultVisibleRevision,
	createSingleViewerState,
	createUsageStats,
	getResultFinalOutput,
	initializeResultRevisions,
	type ResultLifecycle,
	type SingleResult,
	type SingleRunViewerState,
	type ViewerEntry,
	type ViewerToolCallRecord,
} from "./execution-shared.js";
import { formatAgentLookupError } from "./tool-text.js";

const CHILD_PROCESS_EXIT_GRACE_MS = 50;
const CHILD_PROCESS_KILL_GRACE_MS = 5000;
const CHILD_PROTOCOL_TERMINAL_GRACE_MS = 100;
const CHILD_PROTOCOL_ERROR_PREVIEW_LENGTH = 180;
const CHILD_PROTOCOL_ERROR_PREFIX = "[Gremlins🧌]";

function coerceRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function extractMessageText(
	message: AssistantMessage | UserMessage | ToolResultMessage,
): string {
	const { content } = message;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return part.type === "text" && typeof part.text === "string";
		})
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function summarizeToolResult(
	value: unknown,
	maxLength = 1200,
): { content: string; truncated: boolean } {
	let content = "";
	if (value && typeof value === "object") {
		const toolValue = value as {
			content?: Array<{ type?: string; text?: string }>;
			error?: unknown;
			message?: unknown;
		};
		if (Array.isArray(toolValue.content)) {
			content = toolValue.content
				.filter((part) => part.type === "text" && typeof part.text === "string")
				.map((part) => part.text ?? "")
				.join("\n")
				.trim();
		}
		if (!content && typeof toolValue.error === "string") {
			content = toolValue.error;
		}
		if (!content && typeof toolValue.message === "string") {
			content = toolValue.message;
		}
	}
	if (!content) {
		if (typeof value === "string") {
			content = value;
		} else if (value !== undefined) {
			try {
				content = JSON.stringify(value, null, 2);
			} catch {
				content = String(value);
			}
		}
	}
	if (!content) content = "(no tool output)";
	const truncated = content.length > maxLength;
	return {
		content: truncated ? `${content.slice(0, maxLength - 3)}...` : content,
		truncated,
	};
}

function createViewerEntryTimestamps(): {
	createdAt: number;
	updatedAt: number;
} {
	const timestamp = Date.now();
	return { createdAt: timestamp, updatedAt: timestamp };
}

function touchViewerEntryTimestamp(entry: ViewerEntry): void {
	const timestamp = Date.now();
	entry.updatedAt = timestamp;
	entry.createdAt ??= timestamp;
}

function upsertAssistantViewerEntry(
	result: SingleResult,
	state: SingleRunViewerState,
	text: string,
	streaming: boolean,
): boolean {
	if (!text) return false;
	const entryIndex = state.currentAssistantEntryIndex;
	if (entryIndex !== null) {
		const existing = result.viewerEntries[entryIndex];
		if (existing?.type === "assistant-text") {
			if (existing.text === text && existing.streaming === streaming) {
				return false;
			}
			existing.text = text;
			existing.streaming = streaming;
			touchViewerEntryTimestamp(existing);
			return true;
		}
	}
	state.currentAssistantEntryIndex =
		result.viewerEntries.push({
			type: "assistant-text",
			text,
			streaming,
			...createViewerEntryTimestamps(),
		}) - 1;
	return true;
}

function finishAssistantViewerEntry(
	result: SingleResult,
	state: SingleRunViewerState,
	{ clearIndex = true }: { clearIndex?: boolean } = {},
): boolean {
	const entryIndex = state.currentAssistantEntryIndex;
	let changed = false;
	if (entryIndex !== null) {
		const existing = result.viewerEntries[entryIndex];
		if (existing?.type === "assistant-text" && existing.streaming) {
			existing.streaming = false;
			touchViewerEntryTimestamp(existing);
			changed = true;
		}
	}
	if (clearIndex) state.currentAssistantEntryIndex = null;
	return changed;
}

function appendSteerViewerEntry(
	result: SingleResult,
	state: SingleRunViewerState,
	text: string,
	isError: boolean,
): boolean {
	const assistantEntryChanged = finishAssistantViewerEntry(result, state);
	result.viewerEntries.push({
		type: "steer",
		text,
		streaming: false,
		isError,
		...createViewerEntryTimestamps(),
	});
	return true || assistantEntryChanged;
}

function ensureToolCallViewerEntry(
	result: SingleResult,
	state: SingleRunViewerState,
	toolCallId: string,
	toolName: string,
	args: Record<string, unknown>,
): { record: ViewerToolCallRecord; changed: boolean } {
	const existing = state.toolCalls.get(toolCallId);
	if (existing) {
		const entry = result.viewerEntries[existing.callEntryIndex];
		if (
			entry?.type === "tool-call" &&
			Object.keys(entry.args).length === 0 &&
			Object.keys(args).length > 0
		) {
			entry.args = args;
			touchViewerEntryTimestamp(entry);
			return { record: existing, changed: true };
		}
		return { record: existing, changed: false };
	}
	const callEntryIndex =
		result.viewerEntries.push({
			type: "tool-call",
			toolCallId,
			toolName,
			args,
			...createViewerEntryTimestamps(),
		}) - 1;
	const record: ViewerToolCallRecord = { callEntryIndex };
	state.toolCalls.set(toolCallId, record);
	return { record, changed: true };
}

function upsertToolResultViewerEntry(
	result: SingleResult,
	state: SingleRunViewerState,
	toolCallId: string,
	toolName: string,
	args: Record<string, unknown>,
	content: string,
	streaming: boolean,
	truncated: boolean,
	isError: boolean,
): boolean {
	const { record, changed: toolCallChanged } = ensureToolCallViewerEntry(
		result,
		state,
		toolCallId,
		toolName,
		args,
	);
	if (record.resultEntryIndex !== undefined) {
		const existing = result.viewerEntries[record.resultEntryIndex];
		if (existing?.type === "tool-result") {
			if (
				existing.content === content &&
				existing.streaming === streaming &&
				existing.truncated === truncated &&
				existing.isError === isError
			) {
				return toolCallChanged;
			}
			existing.content = content;
			existing.streaming = streaming;
			existing.truncated = truncated;
			existing.isError = isError;
			touchViewerEntryTimestamp(existing);
			return true;
		}
	}
	record.resultEntryIndex =
		result.viewerEntries.push({
			type: "tool-result",
			toolCallId,
			toolName,
			content,
			streaming,
			truncated,
			isError,
			...createViewerEntryTimestamps(),
		}) - 1;
	return true;
}

function applyChildEventToSingleResult(
	result: SingleResult,
	state: SingleRunViewerState,
	event: Record<string, unknown>,
): boolean {
	const eventType = typeof event.type === "string" ? event.type : null;
	if (!eventType) return false;

	if (eventType === "turn_start") {
		return finishAssistantViewerEntry(result, state);
	}

	if (eventType === "turn_end") {
		return finishAssistantViewerEntry(result, state, { clearIndex: false });
	}

	if (
		eventType === "message_start" ||
		eventType === "message_update" ||
		eventType === "message_end"
	) {
		const messageValue = event.message;
		if (!messageValue || typeof messageValue !== "object") return false;
		const message = messageValue as Message;
		if (message.role === "assistant") {
			let contentBearingChanged = false;
			const text = extractMessageText(message as AssistantMessage);
			if (text) {
				contentBearingChanged =
					upsertAssistantViewerEntry(
						result,
						state,
						text,
						eventType !== "message_end",
					) || contentBearingChanged;
			}
			for (const part of message.content) {
				if (part.type === "toolCall") {
					contentBearingChanged =
						ensureToolCallViewerEntry(
							result,
							state,
							part.id,
							part.name,
							coerceRecord(part.arguments),
						).changed || contentBearingChanged;
				}
			}
			if (eventType === "message_end") {
				contentBearingChanged =
					finishAssistantViewerEntry(result, state) || contentBearingChanged;
			}
			return contentBearingChanged;
		}
		if (message.role === "toolResult" && eventType === "message_end") {
			const toolResult = message as ToolResultMessage;
			const summary = summarizeToolResult(toolResult);
			return upsertToolResultViewerEntry(
				result,
				state,
				toolResult.toolCallId,
				toolResult.toolName,
				{},
				summary.content,
				false,
				summary.truncated,
				Boolean(toolResult.isError),
			);
		}
		return false;
	}

	if (eventType === "tool_execution_start") {
		const toolCallId =
			typeof event.toolCallId === "string" ? event.toolCallId : null;
		const toolName = typeof event.toolName === "string" ? event.toolName : null;
		if (!toolCallId || !toolName) return false;
		return ensureToolCallViewerEntry(
			result,
			state,
			toolCallId,
			toolName,
			coerceRecord(event.args),
		).changed;
	}

	if (
		eventType === "tool_execution_update" ||
		eventType === "tool_execution_end"
	) {
		const toolCallId =
			typeof event.toolCallId === "string" ? event.toolCallId : null;
		const toolName = typeof event.toolName === "string" ? event.toolName : null;
		if (!toolCallId || !toolName) return false;
		const summary = summarizeToolResult(
			eventType === "tool_execution_update"
				? event.partialResult
				: event.result,
		);
		return upsertToolResultViewerEntry(
			result,
			state,
			toolCallId,
			toolName,
			coerceRecord(event.args),
			summary.content,
			eventType === "tool_execution_update",
			summary.truncated,
			Boolean(eventType === "tool_execution_end" && event.isError),
		);
	}

	if (eventType === "tool_result_end") {
		const messageValue = event.message;
		if (!messageValue || typeof messageValue !== "object") return false;
		const toolResult = messageValue as ToolResultMessage;
		const summary = summarizeToolResult(toolResult);
		return upsertToolResultViewerEntry(
			result,
			state,
			toolResult.toolCallId,
			toolResult.toolName,
			{},
			summary.content,
			false,
			summary.truncated,
			Boolean(toolResult.isError),
		);
	}

	return false;
}

function sanitizeChildProtocolPreview(line: string): string {
	const normalized = line.replace(/\s+/g, " ").trim();
	if (!normalized) return "(blank line)";
	if (normalized.length <= CHILD_PROTOCOL_ERROR_PREVIEW_LENGTH) {
		return normalized;
	}
	return `${normalized.slice(0, CHILD_PROTOCOL_ERROR_PREVIEW_LENGTH - 3)}...`;
}

function appendStderrLine(result: SingleResult, text: string): void {
	result.stderr = result.stderr ? `${result.stderr}\n${text}` : text;
}

function formatChildProtocolError(
	count: number,
	lastPreview: string | null,
): string {
	const noun = count === 1 ? "line" : "lines";
	const previewSuffix = lastPreview ? ` Last line preview: ${lastPreview}` : "";
	return `Gremlin protocol error: child emitted ${count} malformed JSON stdout ${noun}.${previewSuffix}`;
}

function formatChildProcessError(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return `Gremlin process error: ${error.message.trim()}`;
	}
	if (typeof error === "string" && error.trim()) {
		return `Gremlin process error: ${error.trim()}`;
	}
	return "Gremlin process error: failed to start child process";
}

function hasCapturedChildContent(result: SingleResult): boolean {
	return result.messages.length > 0 || result.viewerEntries.length > 0;
}

function setResultLifecycle(
	result: SingleResult,
	lifecycle: ResultLifecycle,
): boolean {
	if (result.lifecycle === lifecycle) return false;
	result.lifecycle = lifecycle;
	return true;
}

function writeChildFailureDetails(
	result: SingleResult,
	message: string,
): boolean {
	let changed = false;
	if (result.stopReason !== "error") {
		result.stopReason = "error";
		changed = true;
	}
	if (result.errorMessage !== message) {
		result.errorMessage = message;
		changed = true;
	}
	return changed;
}

function writeChildCanceledDetails(
	result: SingleResult,
	{
		forceDefaultErrorMessage = false,
	}: { forceDefaultErrorMessage?: boolean } = {},
): boolean {
	let changed = false;
	if (result.stopReason !== "aborted") {
		result.stopReason = "aborted";
		changed = true;
	}
	if (
		forceDefaultErrorMessage ||
		(!result.errorMessage?.trim() && !getResultFinalOutput(result).trim())
	) {
		if (result.errorMessage !== "Gremlins🧌 run was aborted") {
			result.errorMessage = "Gremlins🧌 run was aborted";
			changed = true;
		}
	}
	return changed;
}

function formatLateChildExitDiagnostic(exitCode: number): string {
	return `${CHILD_PROTOCOL_ERROR_PREFIX} child exited with code ${exitCode} after terminal completion; keeping published status.`;
}

function writePromptTempFile(
	agentName: string,
	prompt: string,
): Promise<{ dir: string; filePath: string }> {
	return fs.promises
		.mkdtemp(path.join(os.tmpdir(), "pi-gremlins-"))
		.then(async (tmpDir) => {
			const safeName = agentName.replace(/[^\w.-]+/g, "_");
			const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
			await withFileMutationQueue(filePath, async () => {
				await fs.promises.writeFile(filePath, prompt, {
					encoding: "utf-8",
					mode: 0o600,
				});
			});
			return { dir: tmpDir, filePath };
		});
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualPath = currentScript?.startsWith("/$bunfs/");

	if (currentScript && !isBunVirtualPath && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

function unregisterSteerableSession(
	callbacks: SteerableSessionCallbacks | undefined,
	gremlinId: string,
): void {
	callbacks?.unregister(gremlinId);
}

export const runSingleAgent: RunSingleAgentFn = async (
	defaultCwd,
	agents,
	agentName,
	task,
	cwd,
	step,
	gremlinId,
	signal,
	onUpdate,
	makeDetails,
	packageDiscoveryWarning,
	steerableSessionCallbacks,
): Promise<SingleResult> => {
	const agentLookup = resolveAgentByName(agents, agentName);
	const agent = agentLookup.agent;

	if (!agent) {
		const missingAgentResult = initializeResultRevisions({
			gremlinId,
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			lifecycle: "failed",
			messages: [],
			viewerEntries: [],
			stderr: formatAgentLookupError(
				agentName,
				agents,
				agentLookup.ambiguousMatches,
				packageDiscoveryWarning,
			),
			usage: createUsageStats(),
			step,
		});
		bumpResultVisibleRevision(missingAgentResult);
		return missingAgentResult;
	}

	const args: string[] = ["--mode", "rpc", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.thinking) args.push("--thinking", agent.thinking);
	if (agent.tools && agent.tools.length > 0) {
		args.push("--tools", agent.tools.join(","));
	}

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const currentResult: SingleResult = initializeResultRevisions({
		gremlinId,
		agent: agent.name,
		agentSource: agent.source,
		task,
		exitCode: -1,
		lifecycle: "pending",
		messages: [],
		viewerEntries: [],
		stderr: "",
		usage: createUsageStats(),
		model: agent.model,
		step,
	});
	const viewerState = createSingleViewerState();
	const liveResults: SingleResult[] = [currentResult];
	const liveDetails = makeDetails(liveResults);

	const emitUpdate = () => {
		onUpdate?.({
			content: [
				{
					type: "text",
					text: getResultFinalOutput(currentResult) || "(running...)",
				},
			],
			details: liveDetails,
		});
	};

	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		let wasAborted = false;
		let childProcessErrorMessage: string | null = null;
		let malformedStdoutCount = 0;
		let lastMalformedStdoutPreview: string | null = null;
		let lateTerminalExitDiagnostic: string | null = null;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: cwd ?? defaultCwd,
				shell: false,
				stdio: ["pipe", "pipe", "pipe"],
			});
			let buffer = "";
			let settled = false;
			let observedExitCode: number | undefined;
			let exitFallbackTimer: ReturnType<typeof setTimeout> | undefined;
			let protocolTerminalGraceTimer: ReturnType<typeof setTimeout> | undefined;
			let protocolTerminalGraceSource:
				| "agent_end"
				| "assistant_message_end"
				| null = null;
			let removeAbortListener: (() => void) | undefined;
			let steeringActive = true;
			let stdinClosed = false;
			let terminalPublished = false;
			let turnActive = false;
			const activeToolExecutionIds = new Set<string>();

			const closeStdin = () => {
				if (stdinClosed) return;
				stdinClosed = true;
				try {
					proc.stdin?.end();
				} catch {
					/* ignore child stdin shutdown errors */
				}
			};

			const deactivateSteering = () => {
				if (!steeringActive) return;
				steeringActive = false;
				unregisterSteerableSession(steerableSessionCallbacks, gremlinId);
			};

			const clearProtocolTerminalGrace = () => {
				if (protocolTerminalGraceTimer) {
					clearTimeout(protocolTerminalGraceTimer);
				}
				protocolTerminalGraceTimer = undefined;
				protocolTerminalGraceSource = null;
			};

			const publishTerminalLifecycle = (
				lifecycle: ResultLifecycle,
				applyDetails?: () => boolean,
			) => {
				if (terminalPublished) return false;
				clearProtocolTerminalGrace();
				deactivateSteering();
				let visibleChanged = setResultLifecycle(currentResult, lifecycle);
				if (applyDetails) {
					visibleChanged = applyDetails() || visibleChanged;
				}
				if (finishAssistantViewerEntry(currentResult, viewerState)) {
					bumpResultDerivedRevision(currentResult);
				} else if (visibleChanged) {
					bumpResultVisibleRevision(currentResult);
				}
				terminalPublished = true;
				emitUpdate();
				return true;
			};

			const failBeforeTerminal = (message?: string) => {
				publishTerminalLifecycle("failed", () => {
					if (!message) return false;
					return writeChildFailureDetails(currentResult, message);
				});
			};

			const cancelBeforeTerminal = (forceDefaultErrorMessage = false) => {
				publishTerminalLifecycle("canceled", () => {
					return writeChildCanceledDetails(currentResult, {
						forceDefaultErrorMessage,
					});
				});
			};

			const armProtocolTerminalGrace = (
				source: "agent_end" | "assistant_message_end",
			) => {
				if (
					settled ||
					terminalPublished ||
					currentResult.lifecycle !== "pending"
				) {
					return;
				}
				if (
					protocolTerminalGraceSource === "agent_end" &&
					source !== "agent_end"
				) {
					return;
				}
				clearProtocolTerminalGrace();
				protocolTerminalGraceSource = source;
				protocolTerminalGraceTimer = setTimeout(() => {
					protocolTerminalGraceTimer = undefined;
					protocolTerminalGraceSource = null;
					publishTerminalLifecycle("completed");
				}, CHILD_PROTOCOL_TERMINAL_GRACE_MS);
			};

			const cancelProtocolTerminalGraceForEvent = (eventType: string) => {
				if (!protocolTerminalGraceTimer) return;
				if (
					eventType === "message_start" ||
					eventType === "message_update" ||
					eventType === "message_end" ||
					eventType === "turn_start" ||
					eventType === "tool_execution_start" ||
					eventType === "tool_execution_update" ||
					eventType === "tool_execution_end" ||
					eventType === "tool_result_end"
				) {
					clearProtocolTerminalGrace();
				}
			};

			const writeRpcCommand = (command: Record<string, unknown>) => {
				if (!proc.stdin || stdinClosed || !steeringActive || settled) {
					throw new Error(`Gremlin ${gremlinId} is no longer active.`);
				}
				proc.stdin.write(`${JSON.stringify(command)}\n`);
			};

			const finalize = (code: number) => {
				if (settled) return;
				settled = true;
				clearProtocolTerminalGrace();
				deactivateSteering();
				if (exitFallbackTimer) clearTimeout(exitFallbackTimer);
				if (buffer.trim()) processLine(buffer);
				buffer = "";
				removeAbortListener?.();
				resolve(code);
			};

			const appendSteerEvent = (message: string, isError: boolean) => {
				appendSteerViewerEntry(currentResult, viewerState, message, isError);
				bumpResultDerivedRevision(currentResult);
				emitUpdate();
			};

			const updateChildActivityState = (event: Record<string, unknown>) => {
				if (event.type === "turn_start") {
					turnActive = true;
					return;
				}
				if (event.type === "turn_end") {
					turnActive = false;
					return;
				}
				if (event.type === "tool_execution_start") {
					if (typeof event.toolCallId === "string") {
						activeToolExecutionIds.add(event.toolCallId);
					}
					return;
				}
				if (event.type === "tool_execution_end") {
					if (typeof event.toolCallId === "string") {
						activeToolExecutionIds.delete(event.toolCallId);
					}
					return;
				}
				if (event.type === "tool_result_end") {
					const messageValue = event.message;
					if (
						messageValue &&
						typeof messageValue === "object" &&
						typeof (messageValue as ToolResultMessage).toolCallId === "string"
					) {
						activeToolExecutionIds.delete(
							(messageValue as ToolResultMessage).toolCallId,
						);
					}
				}
			};

			const canArmGraceFromAssistantMessageEnd = (message: Message) => {
				if (message.role !== "assistant") return false;
				if (protocolTerminalGraceSource === "agent_end") return false;
				if (message.stopReason === "aborted" || Boolean(message.errorMessage)) {
					return false;
				}
				return !turnActive && activeToolExecutionIds.size === 0;
			};

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: Record<string, unknown>;
				try {
					event = JSON.parse(line) as Record<string, unknown>;
				} catch {
					malformedStdoutCount += 1;
					lastMalformedStdoutPreview = sanitizeChildProtocolPreview(line);
					appendStderrLine(
						currentResult,
						`${CHILD_PROTOCOL_ERROR_PREFIX} dropped malformed child stdout line ${malformedStdoutCount}: ${lastMalformedStdoutPreview}`,
					);
					return;
				}

				const eventType = typeof event.type === "string" ? event.type : null;
				if (!eventType) return;
				cancelProtocolTerminalGraceForEvent(eventType);
				updateChildActivityState(event);

				if (eventType === "response") return;
				if (eventType === "agent_start") return;
				if (eventType === "agent_end") {
					closeStdin();
					armProtocolTerminalGrace("agent_end");
					return;
				}
				if (eventType === "extension_ui_request") {
					const method =
						typeof event.method === "string" ? event.method : "unknown";
					appendStderrLine(
						currentResult,
						`${CHILD_PROTOCOL_ERROR_PREFIX} child requested unsupported UI method: ${method}`,
					);
					return;
				}
				if (eventType === "extension_error") {
					const errorText =
						typeof event.error === "string"
							? event.error
							: "child extension error";
					appendStderrLine(
						currentResult,
						`${CHILD_PROTOCOL_ERROR_PREFIX} ${errorText}`,
					);
					return;
				}
				if (terminalPublished) return;

				const contentBearingChildMutation = applyChildEventToSingleResult(
					currentResult,
					viewerState,
					event,
				);

				if (
					contentBearingChildMutation &&
					(eventType === "message_start" ||
						eventType === "message_update" ||
						eventType === "turn_end" ||
						eventType === "tool_execution_start" ||
						eventType === "tool_execution_update" ||
						eventType === "tool_execution_end")
				) {
					bumpResultDerivedRevision(currentResult);
					emitUpdate();
					return;
				}

				if (eventType === "message_end" && event.message) {
					const message = event.message as Message;
					if (message.role === "assistant") {
						const usage = message.usage;
						currentResult.usage.turns += 1;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!currentResult.model && message.model) {
							currentResult.model = message.model;
						}
						if (message.stopReason) {
							currentResult.stopReason = message.stopReason;
						}
						if (message.errorMessage) {
							currentResult.errorMessage = message.errorMessage;
						}
					}
					if (currentResult.viewerEntries.length === 0) {
						currentResult.messages.push(message);
					}
					bumpResultDerivedRevision(currentResult);
					emitUpdate();
					if (canArmGraceFromAssistantMessageEnd(message)) {
						armProtocolTerminalGrace("assistant_message_end");
					}
					return;
				}

				if (eventType === "tool_result_end" && event.message) {
					if (currentResult.viewerEntries.length === 0) {
						currentResult.messages.push(event.message as Message);
					}
					bumpResultDerivedRevision(currentResult);
					emitUpdate();
				}
			};

			steerableSessionCallbacks?.register(gremlinId, {
				steer: async (message: string) => {
					const trimmedMessage = message.trim();
					if (!trimmedMessage) {
						throw new Error("Steering message cannot be empty.");
					}
					if (
						!steeringActive ||
						settled ||
						currentResult.lifecycle !== "pending"
					) {
						throw new Error(`Gremlin ${gremlinId} is no longer active.`);
					}
					try {
						writeRpcCommand({ type: "steer", message: trimmedMessage });
						appendSteerEvent(trimmedMessage, false);
					} catch (error) {
						const errorMessage =
							error instanceof Error ? error.message : String(error);
						appendSteerEvent(`${trimmedMessage} → ${errorMessage}`, true);
						throw error;
					}
				},
			});

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				appendStderrLine(currentResult, data.toString().trimEnd());
			});

			proc.on("exit", (code) => {
				if (settled) return;
				observedExitCode = code ?? observedExitCode ?? 0;
				if ((observedExitCode ?? 0) !== 0) {
					if (currentResult.lifecycle === "completed") {
						lateTerminalExitDiagnostic = formatLateChildExitDiagnostic(
							observedExitCode ?? 0,
						);
					} else if (wasAborted || currentResult.stopReason === "aborted") {
						cancelBeforeTerminal();
					} else {
						failBeforeTerminal();
					}
				}
				if (exitFallbackTimer) clearTimeout(exitFallbackTimer);
				exitFallbackTimer = setTimeout(() => {
					finalize(observedExitCode ?? 0);
				}, CHILD_PROCESS_EXIT_GRACE_MS);
			});

			proc.on("close", (code) => {
				finalize(code ?? observedExitCode ?? 0);
			});

			proc.on("error", (error) => {
				childProcessErrorMessage = formatChildProcessError(error);
				appendStderrLine(currentResult, childProcessErrorMessage);
				if (currentResult.lifecycle !== "completed") {
					failBeforeTerminal(childProcessErrorMessage);
				}
				finalize(1);
			});

			if (signal) {
				const killProc = () => {
					if (wasAborted) return;
					wasAborted = true;
					closeStdin();
					cancelBeforeTerminal(true);
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, CHILD_PROCESS_KILL_GRACE_MS);
				};
				if (signal.aborted) {
					killProc();
				} else {
					signal.addEventListener("abort", killProc, { once: true });
					removeAbortListener = () => {
						signal.removeEventListener("abort", killProc);
					};
				}
			}

			try {
				writeRpcCommand({ type: "prompt", message: `Task: ${task}` });
			} catch (error) {
				childProcessErrorMessage = formatChildProcessError(error);
				appendStderrLine(currentResult, childProcessErrorMessage);
				failBeforeTerminal(childProcessErrorMessage);
				finalize(1);
			}
		});

		let visibleChanged = false;
		if (currentResult.exitCode !== exitCode) {
			currentResult.exitCode = exitCode;
			visibleChanged = true;
		} else {
			currentResult.exitCode = exitCode;
		}
		if (
			lateTerminalExitDiagnostic &&
			!currentResult.stderr.includes(lateTerminalExitDiagnostic)
		) {
			appendStderrLine(currentResult, lateTerminalExitDiagnostic);
			visibleChanged = true;
		}
		if (currentResult.lifecycle === "pending") {
			if (wasAborted || currentResult.stopReason === "aborted") {
				visibleChanged =
					setResultLifecycle(currentResult, "canceled") || visibleChanged;
				visibleChanged =
					writeChildCanceledDetails(currentResult) || visibleChanged;
			} else if (childProcessErrorMessage) {
				visibleChanged =
					setResultLifecycle(currentResult, "failed") || visibleChanged;
				visibleChanged =
					writeChildFailureDetails(currentResult, childProcessErrorMessage) ||
					visibleChanged;
			} else if (
				malformedStdoutCount > 0 &&
				!hasCapturedChildContent(currentResult)
			) {
				const protocolErrorMessage = formatChildProtocolError(
					malformedStdoutCount,
					lastMalformedStdoutPreview,
				);
				visibleChanged =
					setResultLifecycle(currentResult, "failed") || visibleChanged;
				visibleChanged =
					writeChildFailureDetails(currentResult, protocolErrorMessage) ||
					visibleChanged;
			} else if (currentResult.stopReason === "error") {
				visibleChanged =
					setResultLifecycle(currentResult, "failed") || visibleChanged;
			} else if (exitCode !== 0) {
				visibleChanged =
					setResultLifecycle(currentResult, "failed") || visibleChanged;
			} else {
				visibleChanged =
					setResultLifecycle(currentResult, "completed") || visibleChanged;
			}
		} else if (currentResult.lifecycle === "canceled") {
			visibleChanged =
				writeChildCanceledDetails(currentResult) || visibleChanged;
		} else if (
			currentResult.lifecycle !== "completed" &&
			childProcessErrorMessage
		) {
			visibleChanged =
				writeChildFailureDetails(currentResult, childProcessErrorMessage) ||
				visibleChanged;
		}
		if (finishAssistantViewerEntry(currentResult, viewerState)) {
			bumpResultDerivedRevision(currentResult);
		} else if (visibleChanged) {
			bumpResultVisibleRevision(currentResult);
		}
		return currentResult;
	} finally {
		unregisterSteerableSession(steerableSessionCallbacks, gremlinId);
		if (tmpPromptDir) {
			try {
				fs.rmSync(tmpPromptDir, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		} else if (tmpPromptPath) {
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		}
	}
};
