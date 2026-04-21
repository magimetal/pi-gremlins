import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import {
	aggregateUsage,
	type DisplayItem,
	formatUsageStats,
	getDerivedRenderData,
	isSingleResultError,
	type PiGremlinsDetails,
	type SingleResult,
} from "./execution-shared.js";

const COLLAPSED_ITEM_COUNT = 10;
const VIEWER_HINT_TEXT = "Hint: /pi-gremlins:view opens latest gremlin lair.";

interface RenderTheme {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
}

interface RenderContext {
	toolCallId?: string;
}

interface RenderResultLike {
	content: Array<{ type?: string; text?: string }>;
	details?: unknown;
}

interface RenderDependencies {
	hasViewerSnapshot: (toolCallId: string | undefined) => boolean;
	formatToolCall: (
		toolName: string,
		args: Record<string, unknown>,
		themeFg: (color: string, text: string) => string,
	) => string;
}

function createViewerHint(
	theme: RenderTheme,
	context: RenderContext,
	hasViewerSnapshot: (toolCallId: string | undefined) => boolean,
): string | null {
	return hasViewerSnapshot(context.toolCallId)
		? theme.fg("muted", VIEWER_HINT_TEXT)
		: null;
}

function isPiGremlinsDetails(value: unknown): value is PiGremlinsDetails {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<PiGremlinsDetails>;
	return (
		(candidate.mode === "single" ||
			candidate.mode === "parallel" ||
			candidate.mode === "chain") &&
		Array.isArray(candidate.results) &&
		("agentScope" in candidate || candidate.agentScope === undefined) &&
		"projectAgentsDir" in candidate
	);
}

function appendHintText(text: string, viewerHint: string | null): string {
	return viewerHint ? `${text}\n${viewerHint}` : text;
}

function appendHintContainer(
	container: Container,
	viewerHint: string | null,
): Container {
	if (viewerHint) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(viewerHint, 0, 0));
	}
	return container;
}

function renderDisplayItems(
	items: DisplayItem[],
	expanded: boolean,
	theme: RenderTheme,
	formatToolCall: RenderDependencies["formatToolCall"],
	limit?: number,
): string {
	const toShow = limit ? items.slice(-limit) : items;
	const skipped = limit && items.length > limit ? items.length - limit : 0;
	let text = "";
	if (skipped > 0) {
		text += theme.fg("muted", `... ${skipped} earlier items\n`);
	}
	for (const item of toShow) {
		if (item.type === "text") {
			const preview = expanded
				? item.text
				: item.text.split("\n").slice(0, 3).join("\n");
			text += `${theme.fg("toolOutput", preview)}\n`;
			continue;
		}
		text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
	}
	return text.trimEnd();
}

function buildSingleExpandedView(
	result: SingleResult,
	theme: RenderTheme,
	viewerHint: string | null,
	formatToolCall: RenderDependencies["formatToolCall"],
): Container {
	const container = new Container();
	const isError = isSingleResultError(result);
	const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
	const { displayItems, finalOutput } = getDerivedRenderData(result);
	let header = `${icon} ${theme.fg("toolTitle", theme.bold(result.agent))}${theme.fg("muted", ` (${result.agentSource})`)}`;
	if (isError && result.stopReason) {
		header += ` ${theme.fg("error", `[${result.stopReason}]`)}`;
	}
	container.addChild(new Text(header, 0, 0));
	if (isError && result.errorMessage) {
		container.addChild(
			new Text(theme.fg("error", `Error: ${result.errorMessage}`), 0, 0),
		);
	}
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
	container.addChild(new Text(theme.fg("dim", result.task), 0, 0));
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
	if (displayItems.length === 0 && !finalOutput) {
		container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
	} else {
		for (const item of displayItems) {
			if (item.type !== "toolCall") continue;
			container.addChild(
				new Text(
					theme.fg("muted", "→ ") +
						formatToolCall(item.name, item.args, theme.fg.bind(theme)),
					0,
					0,
				),
			);
		}
		if (finalOutput) {
			container.addChild(new Spacer(1));
			container.addChild(
				new Markdown(finalOutput.trim(), 0, 0, getMarkdownTheme()),
			);
		}
	}
	const usageStr = formatUsageStats(result.usage, result.model);
	if (usageStr) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
	}
	return appendHintContainer(container, viewerHint);
}

function buildSingleCollapsedView(
	result: SingleResult,
	theme: RenderTheme,
	viewerHint: string | null,
	formatToolCall: RenderDependencies["formatToolCall"],
): Text {
	const isError = isSingleResultError(result);
	const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
	const { displayItems } = getDerivedRenderData(result);
	let text = `${icon} ${theme.fg("toolTitle", theme.bold(result.agent))}${theme.fg("muted", ` (${result.agentSource})`)}`;
	if (isError && result.stopReason) {
		text += ` ${theme.fg("error", `[${result.stopReason}]`)}`;
	}
	if (isError && result.errorMessage) {
		text += `\n${theme.fg("error", `Error: ${result.errorMessage}`)}`;
	} else if (displayItems.length === 0) {
		text += `\n${theme.fg("muted", "(no output)")}`;
	} else {
		text += `\n${renderDisplayItems(displayItems, false, theme, formatToolCall, COLLAPSED_ITEM_COUNT)}`;
		if (displayItems.length > COLLAPSED_ITEM_COUNT) {
			text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
		}
	}
	const usageStr = formatUsageStats(result.usage, result.model);
	if (usageStr) {
		text += `\n${theme.fg("dim", usageStr)}`;
	}
	return new Text(appendHintText(text, viewerHint), 0, 0);
}

function buildChainExpandedView(
	results: SingleResult[],
	theme: RenderTheme,
	viewerHint: string | null,
	formatToolCall: RenderDependencies["formatToolCall"],
): Container {
	const successCount = results.filter((result) => result.exitCode === 0).length;
	const icon =
		successCount === results.length
			? theme.fg("success", "✓")
			: theme.fg("error", "✗");
	const container = new Container();
	container.addChild(
		new Text(
			icon +
				" " +
				theme.fg("toolTitle", theme.bold("chain ")) +
				theme.fg("accent", `${successCount}/${results.length} steps`),
			0,
			0,
		),
	);

	for (const result of results) {
		const resultIcon =
			result.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
		const { displayItems, finalOutput } = getDerivedRenderData(result);
		container.addChild(new Spacer(1));
		container.addChild(
			new Text(
				`${theme.fg("muted", `─── Step ${result.step}: `) + theme.fg("accent", result.agent)} ${resultIcon}`,
				0,
				0,
			),
		);
		container.addChild(
			new Text(
				theme.fg("muted", "Task: ") + theme.fg("dim", result.task),
				0,
				0,
			),
		);
		for (const item of displayItems) {
			if (item.type !== "toolCall") continue;
			container.addChild(
				new Text(
					theme.fg("muted", "→ ") +
						formatToolCall(item.name, item.args, theme.fg.bind(theme)),
					0,
					0,
				),
			);
		}
		if (finalOutput) {
			container.addChild(new Spacer(1));
			container.addChild(
				new Markdown(finalOutput.trim(), 0, 0, getMarkdownTheme()),
			);
		}
		const stepUsage = formatUsageStats(result.usage, result.model);
		if (stepUsage) {
			container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
		}
	}

	const usageStr = formatUsageStats(aggregateUsage(results));
	if (usageStr) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
	}
	return appendHintContainer(container, viewerHint);
}

function buildChainCollapsedView(
	results: SingleResult[],
	theme: RenderTheme,
	viewerHint: string | null,
	formatToolCall: RenderDependencies["formatToolCall"],
): Text {
	const successCount = results.filter((result) => result.exitCode === 0).length;
	const icon =
		successCount === results.length
			? theme.fg("success", "✓")
			: theme.fg("error", "✗");
	let text =
		icon +
		" " +
		theme.fg("toolTitle", theme.bold("chain ")) +
		theme.fg("accent", `${successCount}/${results.length} steps`);
	for (const result of results) {
		const resultIcon =
			result.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
		const { displayItems } = getDerivedRenderData(result);
		text += `\n\n${theme.fg("muted", `─── Step ${result.step}: `)}${theme.fg("accent", result.agent)} ${resultIcon}`;
		if (displayItems.length === 0) {
			text += `\n${theme.fg("muted", "(no output)")}`;
		} else {
			text += `\n${renderDisplayItems(displayItems, false, theme, formatToolCall, 5)}`;
		}
	}
	const usageStr = formatUsageStats(aggregateUsage(results));
	if (usageStr) {
		text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
	}
	text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	return new Text(appendHintText(text, viewerHint), 0, 0);
}

function buildParallelExpandedView(
	results: SingleResult[],
	status: string,
	icon: string,
	theme: RenderTheme,
	viewerHint: string | null,
	formatToolCall: RenderDependencies["formatToolCall"],
): Container {
	const container = new Container();
	container.addChild(
		new Text(
			`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
			0,
			0,
		),
	);

	for (const result of results) {
		const resultIcon =
			result.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
		const { displayItems, finalOutput } = getDerivedRenderData(result);
		container.addChild(new Spacer(1));
		container.addChild(
			new Text(
				`${theme.fg("muted", "─── ") + theme.fg("accent", result.agent)} ${resultIcon}`,
				0,
				0,
			),
		);
		container.addChild(
			new Text(
				theme.fg("muted", "Task: ") + theme.fg("dim", result.task),
				0,
				0,
			),
		);
		for (const item of displayItems) {
			if (item.type !== "toolCall") continue;
			container.addChild(
				new Text(
					theme.fg("muted", "→ ") +
						formatToolCall(item.name, item.args, theme.fg.bind(theme)),
					0,
					0,
				),
			);
		}
		if (finalOutput) {
			container.addChild(new Spacer(1));
			container.addChild(
				new Markdown(finalOutput.trim(), 0, 0, getMarkdownTheme()),
			);
		}
		const taskUsage = formatUsageStats(result.usage, result.model);
		if (taskUsage) {
			container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
		}
	}

	const usageStr = formatUsageStats(aggregateUsage(results));
	if (usageStr) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
	}
	return appendHintContainer(container, viewerHint);
}

function buildParallelCollapsedView(
	results: SingleResult[],
	expanded: boolean,
	status: string,
	isRunning: boolean,
	icon: string,
	theme: RenderTheme,
	viewerHint: string | null,
	formatToolCall: RenderDependencies["formatToolCall"],
): Text {
	let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
	for (const result of results) {
		const resultIcon =
			result.exitCode === -1
				? theme.fg("warning", "⏳")
				: result.exitCode === 0
					? theme.fg("success", "✓")
					: theme.fg("error", "✗");
		const { displayItems } = getDerivedRenderData(result);
		text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", result.agent)} ${resultIcon}`;
		if (displayItems.length === 0) {
			text += `\n${theme.fg("muted", result.exitCode === -1 ? "(running...)" : "(no output)")}`;
		} else {
			text += `\n${renderDisplayItems(displayItems, expanded, theme, formatToolCall, 5)}`;
		}
	}
	if (!isRunning) {
		const usageStr = formatUsageStats(aggregateUsage(results));
		if (usageStr) {
			text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
		}
	}
	if (!expanded) {
		text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	}
	return new Text(appendHintText(text, viewerHint), 0, 0);
}

export function renderPiGremlinsResult(
	result: RenderResultLike,
	{ expanded }: { expanded: boolean },
	theme: RenderTheme,
	context: RenderContext,
	{ hasViewerSnapshot, formatToolCall }: RenderDependencies,
) {
	const details = isPiGremlinsDetails(result.details)
		? result.details
		: undefined;
	if (!details || details.results.length === 0) {
		const text = result.content[0];
		return new Text(
			text?.type === "text" ? (text.text ?? "(no output)") : "(no output)",
			0,
			0,
		);
	}

	const viewerHint = createViewerHint(theme, context, hasViewerSnapshot);

	if (details.mode === "single" && details.results.length === 1) {
		return expanded
			? buildSingleExpandedView(
					details.results[0],
					theme,
					viewerHint,
					formatToolCall,
				)
			: buildSingleCollapsedView(
					details.results[0],
					theme,
					viewerHint,
					formatToolCall,
				);
	}

	if (details.mode === "chain") {
		return expanded
			? buildChainExpandedView(
					details.results,
					theme,
					viewerHint,
					formatToolCall,
				)
			: buildChainCollapsedView(
					details.results,
					theme,
					viewerHint,
					formatToolCall,
				);
	}

	if (details.mode === "parallel") {
		const running = details.results.filter(
			(result) => result.exitCode === -1,
		).length;
		const successCount = details.results.filter(
			(result) => result.exitCode === 0,
		).length;
		const failCount = details.results.filter(
			(result) => result.exitCode > 0,
		).length;
		const isRunning = running > 0;
		const icon = isRunning
			? theme.fg("warning", "⏳")
			: failCount > 0
				? theme.fg("warning", "◐")
				: theme.fg("success", "✓");
		const status = isRunning
			? `${successCount + failCount}/${details.results.length} done, ${running} running`
			: `${successCount}/${details.results.length} tasks`;

		if (expanded && !isRunning) {
			return buildParallelExpandedView(
				details.results,
				status,
				icon,
				theme,
				viewerHint,
				formatToolCall,
			);
		}

		return buildParallelCollapsedView(
			details.results,
			expanded,
			status,
			isRunning,
			icon,
			theme,
			viewerHint,
			formatToolCall,
		);
	}

	const text = result.content[0];
	return new Text(
		text?.type === "text" ? (text.text ?? "(no output)") : "(no output)",
		0,
		0,
	);
}
