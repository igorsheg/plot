import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export function resolvePlatformPackageName() {
	const { platform, arch } = process;

	if (platform === "darwin" && arch === "arm64") return "@plot-ai/darwin-arm64";
	if (platform === "darwin" && arch === "x64") return "@plot-ai/darwin-x64";
	if (platform === "linux" && arch === "arm64")
		return "@plot-ai/linux-arm64-gnu";
	if (platform === "linux" && arch === "x64") return "@plot-ai/linux-x64-gnu";

	return null;
}

export function resolveInstalledBinary() {
	const packageName = resolvePlatformPackageName();
	if (!packageName) return null;

	const packageJsonPath = require.resolve(`${packageName}/package.json`);
	const packageDir = dirname(packageJsonPath);
	const binaryPath = join(packageDir, "bin", "plot");

	if (!existsSync(binaryPath)) {
		throw new Error(`installed package ${packageName} is missing plot binary`);
	}

	return {
		packageName,
		binaryPath,
	};
}

export function readPackageVersion() {
	const packageJson = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	);
	return packageJson.version;
}
