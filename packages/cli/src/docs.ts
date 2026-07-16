import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	getDocsDirs,
	getExamplesDirs,
	getSdkReferenceCandidates,
} from "./package.js";

export const docNames = [
	"index",
	"quickstart",
	"guide",
	"workflows",
	"extensions",
	"programmatic",
	"cli",
	"tui",
	"web",
] as const;
export type DocName = (typeof docNames)[number];

export const isDocName = (value: string): value is DocName =>
	(docNames as readonly string[]).includes(value);

const firstExisting = (paths: readonly string[]): string | undefined =>
	paths.find(existsSync);

export const readDoc = async (name: DocName): Promise<string> => {
	const file = `${name}.md`;
	const path = firstExisting(getDocsDirs().map((dir) => join(dir, file)));
	if (path === undefined) throw new Error(`Plot docs file not found: ${file}`);
	return readFile(path, "utf8");
};

export const readSdkReference = async (): Promise<string> => {
	const candidate = getSdkReferenceCandidates().find(
		(value) => existsSync(value.sdk) && existsSync(value.workContract),
	);
	if (candidate === undefined)
		throw new Error("Plot SDK declarations not found");
	const [sdk, workContract] = await Promise.all([
		readFile(candidate.sdk, "utf8"),
		readFile(candidate.workContract, "utf8"),
	]);
	return `// plot-ai/sdk — the authoritative extension contract.\n// Prose semantics: plot docs extensions\n\n${sdk}\n// ${candidate.workContract.split("/").pop()}\n\n${workContract}`;
};

const entry = (label: string, value: string | undefined, note: string) =>
	`${label.padEnd(10)}${value ?? "(not found)"}${value === undefined ? "" : `\n${" ".repeat(10)}${note}`}`;

export const renderDocsPaths = (): string => {
	const sdk = getSdkReferenceCandidates().find((candidate) =>
		existsSync(candidate.sdk),
	);
	return [
		"Plot ships its documentation with the package. Read the files directly:",
		"",
		entry(
			"docs:",
			firstExisting(getDocsDirs()),
			"guide.md, extensions.md, workflows.md, cli.md, ...",
		),
		entry(
			"examples:",
			firstExisting(getExamplesDirs()),
			"pr-review/ (production-shaped), debug/ (lifecycle tour)",
		),
		entry(
			"sdk:",
			sdk?.sdk,
			`typed extension contract; work-contract sibling: ${sdk?.workContract ?? ""}`,
		),
		"",
	].join("\n");
};
