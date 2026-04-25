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

export function writeAgentFile(
	dir,
	fileName,
	name,
	description = `${name} description`,
) {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, fileName),
		`---\nname: ${name}\ndescription: ${description}\nagent_type: sub-agent\n---\nsystem prompt`,
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

