import { chmodSync } from "node:fs";
import { resolveInstalledBinary } from "./lib/platform.js";

try {
	const resolved = resolveInstalledBinary();
	if (!resolved) {
		console.warn(
			`plot: unsupported platform ${process.platform}/${process.arch}`,
		);
		process.exit(0);
	}
	chmodSync(resolved.binaryPath, 0o755);
} catch (error) {
	console.error("plot install failed");
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
