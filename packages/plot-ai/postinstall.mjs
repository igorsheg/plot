import {
	resolveInstalledBinary,
	resolvePlatformPackageName,
} from "./lib/platform.js";

if (process.env.PLOT_SKIP_POSTINSTALL_CHECK === "1") {
	process.exit(0);
}

try {
	const resolved = resolveInstalledBinary();
	if (!resolved) {
		const packageName = resolvePlatformPackageName();
		if (!packageName) {
			console.warn(
				`plot-ai: unsupported platform ${process.platform}/${process.arch}`,
			);
			process.exit(0);
		}
		throw new Error(`missing optional dependency ${packageName}`);
	}
} catch (error) {
	console.error("plot-ai install failed");
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
