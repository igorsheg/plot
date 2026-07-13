import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createExtensionCredentials } from "../src/extension-credentials.js";
import type { SessionPaths } from "../src/paths.js";
import type { WorkflowDefinition } from "../src/workflow.js";

const pathsFor = (root: string): SessionPaths => ({
	cwd: root,
	plotDir: join(root, ".plot"),
	agentDir: join(root, "agent"),
	sessionDir: join(root, ".plot", "sessions"),
	skillsDir: join(root, ".plot", "skills"),
	extensionsDir: join(root, ".plot", "extensions"),
	promptsDir: join(root, ".plot", "prompts"),
});

const workflow = (path: string): WorkflowDefinition => ({
	path,
	config: {},
	runtime: {
		agent: { provider: "test", model: "fake" },
		extension: { source: "./extension.ts" },
	},
	prompt: "",
});

test("extension credentials are workflow-scoped and permission-restricted", async () => {
	const root = await mkdtemp(join(tmpdir(), "plot-credentials-"));
	const paths = pathsFor(root);
	const first = createExtensionCredentials({
		extensionId: "jira",
		workflow: workflow(join(root, "one", "WORKFLOW.md")),
		paths,
	});
	const second = createExtensionCredentials({
		extensionId: "jira",
		workflow: workflow(join(root, "two", "WORKFLOW.md")),
		paths,
	});

	await first.set("tokens", { accessToken: "secret" });
	expect(await first.get<{ accessToken: string }>("tokens")).toEqual({
		accessToken: "secret",
	});
	expect(await second.get("tokens")).toBeUndefined();
	await first.delete("tokens");
	expect(await first.get("tokens")).toBeUndefined();

	const directory = join(paths.agentDir, "extension-credentials");
	const files = await readdir(directory);
	expect(files).toHaveLength(1);
	const file = files[0];
	if (file === undefined) throw new Error("missing credential file");
	expect((await stat(directory)).mode & 0o777).toBe(0o700);
	expect((await stat(join(directory, file))).mode & 0o777).toBe(0o600);
});
