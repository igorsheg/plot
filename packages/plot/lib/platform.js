import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function isMusl() {
	if (process.platform !== "linux") return false;

	if (typeof process.report?.getReport === "function") {
		const report = process.report.getReport();
		return !report.header?.glibcVersionRuntime;
	}

	return false;
}

export function resolvePlatformPackageName() {
	const { platform, arch } = process;

	if (platform === "darwin" && arch === "arm64") return "@plot-ai/darwin-arm64";
	if (platform === "darwin" && arch === "x64") return "@plot-ai/darwin-x64";
	if (platform === "linux" && arch === "arm64") return "@plot-ai/linux-arm64-gnu";
	if (platform === "linux" && arch === "x64") {
		return isMusl() ? "@plot-ai/linux-x64-musl" : "@plot-ai/linux-x64-gnu";
	}
	if (platform === "win32" && arch === "x64") return "@plot-ai/win32-x64-msvc";

	return null;
}

export function resolveInstalledBinary() {
	const packageName = resolvePlatformPackageName();
	if (!packageName) return null;

	const packageJsonPath = require.resolve(`${packageName}/package.json`);
	const packageDir = dirname(packageJsonPath);
	const binaryName = process.platform === "win32" ? "plot-ai.exe" : "plot-ai";
	const binaryPath = join(packageDir, "bin", binaryName);

	if (!existsSync(binaryPath)) {
		throw new Error(`installed package ${packageName} is missing ${binaryName}`);
	}

	return {
		packageName,
		binaryPath,
	};
}

export function readPackageVersion() {
	const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	return packageJson.version;
}
