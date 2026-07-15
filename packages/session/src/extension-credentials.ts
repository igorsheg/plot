import { createHash, randomUUID } from "node:crypto";
import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "@plot/common/primitives";
import type { ExtensionCredentials } from "@plot/sdk";
import type { SessionPaths } from "./paths.js";
import type { WorkflowDefinition } from "./workflow.js";

const credentialKey = (key: string): string => {
	if (key.length === 0) throw new Error("credential key must be non-empty");
	return key;
};

const credentialPath = (input: {
	readonly extensionId: string;
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
}): string => {
	const workflow = input.workflow.path ?? input.paths.cwd;
	const namespace = createHash("sha256")
		.update(input.extensionId)
		.update("\0")
		.update(workflow)
		.digest("hex")
		.slice(0, 24);
	return join(
		input.paths.agentDir,
		"extension-credentials",
		`${namespace}.json`,
	);
};

const readCredentials = async (
	path: string,
): Promise<Record<string, unknown>> => {
	try {
		const value: unknown = JSON.parse(await readFile(path, "utf8"));
		if (!isRecord(value))
			throw new Error("credential file must contain an object");
		return { ...value };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
};

export const createExtensionCredentials = (input: {
	readonly extensionId: string;
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
}): ExtensionCredentials => {
	const path = credentialPath(input);
	const dir = join(input.paths.agentDir, "extension-credentials");
	let writes = Promise.resolve();
	const mutate = (change: (values: Record<string, unknown>) => void) => {
		const previous = writes;
		const next = (async () => {
			await previous;
			const values = await readCredentials(path);
			change(values);
			await mkdir(dir, { recursive: true, mode: 0o700 });
			await chmod(dir, 0o700);
			const temporary = `${path}.${randomUUID()}.tmp`;
			try {
				await writeFile(temporary, `${JSON.stringify(values)}\n`, {
					mode: 0o600,
				});
				await rename(temporary, path);
				await chmod(path, 0o600);
			} finally {
				await rm(temporary, { force: true });
			}
		})();
		writes = next.catch(() => undefined);
		return next;
	};
	return {
		get: async (key: string) => {
			await writes;
			return (await readCredentials(path))[credentialKey(key)];
		},
		set: (key, value) => {
			if (value === undefined)
				return Promise.reject(
					new Error(
						"credential value must not be undefined; use delete instead",
					),
				);
			return mutate((values) => {
				values[credentialKey(key)] = value;
			});
		},
		delete: (key) =>
			mutate((values) => {
				delete values[credentialKey(key)];
			}),
	};
};
