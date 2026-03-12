import type { TrackerPluginDefinition } from "@plot/sdk";

const plugin: TrackerPluginDefinition = {
	name: "fake-minimal",
	async factory() {
		return {
			async fetchCandidateIssues() {
				return [];
			},
		};
	},
};

export default plugin;
