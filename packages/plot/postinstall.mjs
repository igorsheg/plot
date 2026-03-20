import { chmodSync } from "node:fs";
import { resolveInstalledBinary, resolvePlatformPackageName } from "./lib/platform.js";

try {
	const resolved = resolveInstalledBinary();
	if (!resolved) {
		const packageName = resolvePlatformPackageName();
		if (!packageName) {
			console.warn(`plot-ai: unsupported platform ${process.platform}/${process.arch}`);
			process.exit(0);
		}
		throw new Error(`missing optional dependency ${packageName}`);
	}

	if (process.platform !== "win32") {
		chmodSync(resolved.binaryPath, 0o755);
	}
} catch (error) {
	console.error("plot-ai install failed");
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
