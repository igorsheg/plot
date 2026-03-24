import { defineTracker } from "@plot/sdk";

export default defineTracker({
	name: "fake-jira",
	async fetchCandidateIssues() {
		return [];
	},
});
