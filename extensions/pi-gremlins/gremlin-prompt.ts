export interface BuildGremlinPromptOptions {
	parentSystemPrompt: string;
	rawMarkdown: string;
	context: string;
}

export function buildGremlinPrompt({
	parentSystemPrompt,
	rawMarkdown,
	context,
}: BuildGremlinPromptOptions): string {
	return [
		"Parent system prompt snapshot:",
		parentSystemPrompt,
		"",
		"Gremlin definition markdown:",
		rawMarkdown,
		"",
		"Caller context:",
		context,
	].join("\n");
}
