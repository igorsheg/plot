import type { ExtensionInteraction } from "@plot/sdk";
import { createLoopbackOAuthCallback } from "@plot/session/interaction";
import { openBrowser, type PlotCliIo } from "./io.js";

export interface CliExtensionInteraction extends ExtensionInteraction {
	readonly dispose: () => void;
}

export const createCliExtensionInteraction = (input: {
	readonly io: PlotCliIo;
	readonly noBrowser?: boolean;
}): CliExtensionInteraction => {
	const callbacks = new Set<{ readonly cancel: () => void }>();
	return {
		openUrl: async (url, options) => {
			await input.io.writeStdout(
				`${options?.fallbackText ?? "Open this URL to continue:"}\n${url}\n`,
			);
			if (input.noBrowser !== true) openBrowser(url);
		},
		createOAuthCallback: async (options) => {
			const callback = await createLoopbackOAuthCallback(options?.timeoutMs);
			callbacks.add(callback);
			return callback;
		},
		reportProgress: (message) => input.io.writeStdout(`${message}\n`),
		dispose: () => {
			for (const callback of callbacks) callback.cancel();
			callbacks.clear();
		},
	};
};
