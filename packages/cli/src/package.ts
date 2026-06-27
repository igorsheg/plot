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
	if (isBunBinary) return dirname(process.execPath);
	let dir = moduleDir;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) return dir;
		dir = dirname(dir);
	}
	return moduleDir;
};

const readVersion = (): string => {
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
	return [join(packageDir, "docs"), resolve(packageDir, "../../docs")];
};
