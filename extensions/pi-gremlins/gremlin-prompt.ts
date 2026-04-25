export interface BuildGremlinPromptOptions {
	parentSystemPrompt: string;
	rawMarkdown: string;
	intent: string;
	context: string;
}

export function buildGremlinPrompt({
	parentSystemPrompt,
	rawMarkdown,
	intent,
	context,
}: BuildGremlinPromptOptions): string {
	return [
		"Parent system prompt snapshot:",
		parentSystemPrompt,
		"",
		"Gremlin definition markdown:",
		rawMarkdown,
		"",
		"Caller intent:",
		intent,
		"",
		"Caller context:",
		context,
	].join("\n");
}
