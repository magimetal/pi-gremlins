export interface BuildGremlinPromptOptions {
	intent: string;
	context: string;
}

export function buildGremlinPrompt({
	intent,
	context,
}: BuildGremlinPromptOptions): string {
	return [
		"Caller intent:",
		intent,
		"",
		"Caller context:",
		context,
	].join("\n");
}
