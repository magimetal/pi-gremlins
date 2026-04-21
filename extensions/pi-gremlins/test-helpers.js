import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function parseFrontmatter(content) {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return { frontmatter: {}, body: content };

	const frontmatter = {};
	for (const line of match[1].split("\n")) {
		const separatorIndex = line.indexOf(":");
		if (separatorIndex === -1) continue;
		const key = line.slice(0, separatorIndex).trim();
		const value = line.slice(separatorIndex + 1).trim();
		frontmatter[key] = value;
	}

	return {
		frontmatter,
		body: match[2],
	};
}

function toEvent(chunk, index) {
	if (typeof chunk === "string") return { data: chunk, delay: index };
	return {
		data: chunk.data,
		delay: chunk.delay ?? index,
	};
}

export function createMockProcess({
	stdoutChunks = [],
	stderrChunks = [],
	closeCode = 0,
	exitCode = closeCode,
	closeDelay,
	exitDelay,
	omitClose = false,
	errorAt,
} = {}) {
	const proc = new EventEmitter();
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.killed = false;
	proc.kill = () => {
		proc.killed = true;
	};

	queueMicrotask(() => {
		const stdoutEvents = stdoutChunks.map(toEvent);
		const stderrEvents = stderrChunks.map(toEvent);
		const allDelays = [
			...stdoutEvents.map((event) => event.delay),
			...stderrEvents.map((event) => event.delay),
		];
		const finalCloseDelay =
			closeDelay ?? (allDelays.length > 0 ? Math.max(...allDelays) + 1 : 0);
		const finalExitDelay = exitDelay ?? finalCloseDelay;

		for (const event of stdoutEvents) {
			setTimeout(() => {
				proc.stdout.emit("data", Buffer.from(event.data));
			}, event.delay);
		}
		for (const event of stderrEvents) {
			setTimeout(() => {
				proc.stderr.emit("data", Buffer.from(event.data));
			}, event.delay);
		}
		if (errorAt !== undefined) {
			setTimeout(() => {
				proc.emit("error", new Error("spawn error"));
			}, errorAt);
		}
		setTimeout(() => {
			proc.emit("exit", exitCode);
		}, finalExitDelay);
		if (!omitClose) {
			setTimeout(() => {
				proc.emit("close", closeCode);
			}, finalCloseDelay);
		}
	});

	return proc;
}

export function jsonLine(value) {
	return `${JSON.stringify(value)}\n`;
}

export function writeAgentFile(
	dir,
	fileName,
	name,
	description = `${name} description`,
) {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, fileName),
		`---\nname: ${name}\ndescription: ${description}\n---\nsystem prompt`,
		"utf-8",
	);
}

export function createWorkspace() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gremlins-case-"));
	const userRoot = path.join(root, "user-home");
	const repoRoot = path.join(root, "repo");
	const userAgentsDir = path.join(userRoot, "agents");
	const projectAgentsDir = path.join(repoRoot, ".pi", "agents");
	fs.mkdirSync(repoRoot, { recursive: true });
	return { root, userRoot, repoRoot, userAgentsDir, projectAgentsDir };
}

export class MockContainer {
	constructor() {
		this.children = [];
	}

	addChild(child) {
		this.children.push(child);
	}
}

export class MockText {
	constructor(text) {
		this.text = text;
	}

	setText(text) {
		this.text = text;
	}
}

export class MockSpacer {
	constructor(lines = 1) {
		this.lines = lines;
	}
}

export class MockMarkdown {
	constructor(text) {
		this.text = text;
	}
}

export function flattenRenderedNode(node) {
	if (!node) return "";
	if (typeof node === "string") return node;
	if (typeof node.text === "string") return node.text;
	if (typeof node.lines === "number") return "\n".repeat(node.lines);
	if (Array.isArray(node.children)) {
		return node.children.map((child) => flattenRenderedNode(child)).join("\n");
	}
	return String(node);
}

export function createTheme() {
	return {
		fg: (_color, text) => text,
		bold: (text) => text,
	};
}
