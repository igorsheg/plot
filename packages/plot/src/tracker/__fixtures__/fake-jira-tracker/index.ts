import { defineTrackerPlugin } from "@plot/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "skills");

const plugin = defineTrackerPlugin({
	name: "fake-jira",
	skillPaths: [join(skillsDir, "jira-triage"), join(skillsDir, "jira-sync")],
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
