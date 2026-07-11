import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export const isBunBinary =
	import.meta.url.includes("$bunfs") ||
	import.meta.url.includes("~BUN") ||
	import.meta.url.includes("%7EBUN");

export const getPackageDir = (): string => {
	const env = process.env["PLOT_PACKAGE_DIR"];
	if (env) return resolve(env);
	if (isBunBinary) {
		const binaryDir = dirname(process.execPath);
		const packageDir = dirname(binaryDir);
		if (existsSync(join(packageDir, "package.json"))) return packageDir;
		return binaryDir;
	}
	let dir = moduleDir;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) return dir;
		dir = dirname(dir);
	}
	return moduleDir;
};

const readVersion = (): string => {
	const env = process.env["PLOT_VERSION"];
	if (env !== undefined && env.length > 0) return env.replace(/^v/, "");
	try {
		const pkg = JSON.parse(
			readFileSync(join(getPackageDir(), "package.json"), "utf8"),
		) as { readonly version?: string };
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
};

export const VERSION = readVersion();

export const getDocsDirs = (): readonly string[] => {
	const packageDir = getPackageDir();
	return [
		join(packageDir, "docs"),
		resolve(packageDir, "../../plot-ai/docs"),
		resolve(packageDir, "../../docs"),
	];
};

export const getExamplesDirs = (): readonly string[] => {
	const packageDir = getPackageDir();
	return [
		join(packageDir, "examples"),
		resolve(packageDir, "../../plot-ai/examples"),
		resolve(packageDir, "../../examples"),
	];
};

export interface SdkReferenceCandidate {
	readonly sdk: string;
	readonly workContract: string;
}

const sdkReferenceCandidate = (
	dir: string,
	ext: string,
): SdkReferenceCandidate => ({
	sdk: join(dir, `sdk${ext}`),
	workContract: join(dir, `work-contract${ext}`),
});

/**
 * Candidate locations for the shipped SDK declarations, in resolution order:
 * this package's lib, the sibling umbrella package's lib, then the repo
 * workspace (source, then built output) for development checkouts.
 */
export const getSdkReferenceCandidates =
	(): readonly SdkReferenceCandidate[] => {
		const packageDir = getPackageDir();
		return [
			sdkReferenceCandidate(join(packageDir, "lib"), ".d.ts"),
			sdkReferenceCandidate(resolve(packageDir, "../../plot-ai/lib"), ".d.ts"),
			sdkReferenceCandidate(resolve(packageDir, "../sdk/src"), ".ts"),
			sdkReferenceCandidate(resolve(packageDir, "../sdk/dist"), ".d.ts"),
		];
	};
