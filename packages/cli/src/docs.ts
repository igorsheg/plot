import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	getDocsDirs,
	getExamplesDirs,
	getSdkReferenceCandidates,
} from "./package.js";

const docNames = [
	"index",
	"quickstart",
	"guide",
	"workflows",
	"extensions",
	"tui",
	"web",
	"cli",
] as const;
export type DocName = (typeof docNames)[number];

export const isDocName = (value: string): value is DocName =>
	(docNames as readonly string[]).includes(value);

export const readPlotDoc = async (name: DocName): Promise<string> => {
	const file = `${name}.md`;
	for (const dir of getDocsDirs()) {
		try {
			// eslint-disable-next-line no-await-in-loop -- docs lookup checks fallback directories in order.
			return await readFile(join(dir, file), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	throw new Error(`Plot docs file not found: ${file}`);
};

/**
 * The shipped SDK type declarations are the authoritative extension API
 * reference; `plot docs sdk` prints them verbatim.
 */
export const readSdkReference = async (): Promise<string> => {
	for (const candidate of getSdkReferenceCandidates()) {
		try {
			// eslint-disable-next-line no-await-in-loop -- reference lookup checks fallback locations in order.
			const [sdk, workContract] = await Promise.all([
				readFile(candidate.sdk, "utf8"),
				readFile(candidate.workContract, "utf8"),
			]);
			return `// plot-ai/sdk — the authoritative Plot extension contract.\n// Prose semantics: plot docs extensions\n\n${sdk}\n// ${candidate.workContract.split("/").pop()}\n\n${workContract}`;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	throw new Error("Plot SDK declarations not found");
};

const firstExisting = (paths: readonly string[]): string | undefined =>
	paths.find((path) => existsSync(path));

const entry = (label: string, value: string | undefined, note: string) =>
	`${label.padEnd(10)}${value ?? "(not found)"}${value === undefined ? "" : `\n${" ".repeat(10)}${note}`}`;

/**
 * On-disk locations of the shipped docs, examples, and SDK declarations, so
 * file-reading agents can open them directly instead of consuming stdout.
 */
export const renderDocsPaths = (): string => {
	const docsDir = firstExisting(getDocsDirs());
	const examplesDir = firstExisting(getExamplesDirs());
	const sdkCandidate = getSdkReferenceCandidates().find((candidate) =>
		existsSync(candidate.sdk),
	);
	return [
		"Plot ships its documentation with the package. Read the files directly:",
		"",
		entry(
			"docs:",
			docsDir,
			"guide.md, extensions.md, workflows.md, cli.md, ...",
		),
		entry(
			"examples:",
			examplesDir,
			"pr-review/ (production-shaped), debug/ (lifecycle tour)",
		),
		entry(
			"sdk:",
			sdkCandidate?.sdk,
			`typed extension contract; work-contract sibling: ${sdkCandidate?.workContract ?? ""}`,
		),
		"",
	].join("\n");
};
