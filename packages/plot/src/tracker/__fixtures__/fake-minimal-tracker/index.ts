import { defineTrackerPlugin } from "@plot/sdk";

const plugin = defineTrackerPlugin({
	name: "fake-minimal",
	async factory() {
		return {
			tracker: {
				async fetchCandidateIssues() {
					return [];
				},
			},
		};
	},
});

export default plugin;
