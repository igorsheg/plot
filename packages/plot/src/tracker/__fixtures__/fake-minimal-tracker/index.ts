import { defineTracker } from "@plot/sdk";

export default defineTracker({
	name: "fake-minimal",
	async fetchCandidateIssues() {
		return [];
	},
});
