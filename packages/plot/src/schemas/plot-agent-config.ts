function getEnv(name: string) {
	if (typeof process === "undefined") {
		return undefined;
	}
	return process.env[name];
}

function joinPath(...parts: string[]) {
	return parts
		.map((part) => part.replace(/\\/g, "/"))
		.filter((part) => part.length > 0)
		.join("/")
		.replace(/\/+/g, "/");
}

function getDefaultPlotAgentDir() {
	const homeDir = getEnv("HOME") ?? getEnv("USERPROFILE");
	return homeDir ? joinPath(homeDir, ".plot", "agent") : ".plot/agent";
}

export function getPlotAgentDir() {
	return getEnv("PLOT_CODING_AGENT_DIR") ?? getDefaultPlotAgentDir();
}

export function getPlotAuthPath() {
	return joinPath(getPlotAgentDir(), "auth.json");
}

export function getPlotModelsPath() {
	return joinPath(getPlotAgentDir(), "models.json");
}
