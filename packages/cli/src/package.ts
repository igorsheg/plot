import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const compiled =
	import.meta.url.includes("$bunfs") ||
	import.meta.url.includes("~BUN") ||
	import.meta.url.includes("%7EBUN");

const packageDir = (() => {
	const configured = process.env["PLOT_PACKAGE_DIR"];
	if (configured !== undefined) return resolve(configured);
	return compiled
		? dirname(dirname(process.execPath))
		: resolve(moduleDir, "..");
})();

const readVersion = (): string => {
	const configured = process.env["PLOT_VERSION"];
	if (configured !== undefined && configured.length > 0)
		return configured.replace(/^v/, "");
	try {
		const pkg = JSON.parse(
			readFileSync(join(packageDir, "package.json"), "utf8"),
		) as { readonly version?: string };
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
};

export const VERSION = readVersion();

const contentDirs = (name: "docs" | "examples"): readonly string[] => [
	join(packageDir, name),
	resolve(packageDir, "../../", name),
];

export const getDocsDirs = (): readonly string[] => contentDirs("docs");
export const getExamplesDirs = (): readonly string[] => contentDirs("examples");

interface SdkReferenceCandidate {
	readonly sdk: string;
	readonly workContract: string;
}

const sdkReferenceCandidate = (
	dir: string,
	ext: ".ts" | ".d.ts",
): SdkReferenceCandidate => ({
	sdk: join(dir, `sdk${ext}`),
	workContract: join(dir, `work-contract${ext}`),
});

export const getSdkReferenceCandidates =
	(): readonly SdkReferenceCandidate[] => [
		sdkReferenceCandidate(join(packageDir, "lib"), ".d.ts"),
		sdkReferenceCandidate(resolve(packageDir, "../sdk/src"), ".ts"),
	];
