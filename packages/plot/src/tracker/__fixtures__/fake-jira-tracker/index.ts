import type { TrackerPluginDefinition } from "@plot/sdk";
const plugin: TrackerPluginDefinition = {
	name: "fake-jira",
	async factory() {
		return {
			async fetchCandidateIssues() {
				return [];
			},
		};
	},
};

export default plugin;
