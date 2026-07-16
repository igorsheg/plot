import { createPlot } from "plot-ai";
import { defineExtension, defineWorkflow } from "plot-ai/sdk";

let done = false;

const extension = defineExtension({
	id: "in-memory-review",
	create: () => ({
		discover: () =>
			done
				? []
				: [
						{
							id: "change-1",
							title: "Example change",
							context: {
								description: "Rename the public greeting from hello to hi",
							},
						},
					],
		finished: ({ completion }) => {
			if (completion.status === "succeeded") done = true;
		},
	}),
});

const workflow = defineWorkflow({
	name: "programmatic-example",
	agent: {
		provider: "anthropic",
		model: "claude-sonnet-4-6",
		noTools: true,
		maxTurns: 1,
	},
	resources: {
		systemPrompt: "Review the supplied change description concisely.",
	},
	extension: { use: extension },
	plot: { tickIntervalMs: 60_000 },
	prompt: "Review this proposed change: {{ description }}",
});

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

const plot = await createPlot({
	cwd: process.cwd(),
	credentials: {
		anthropic: { type: "api-key", apiKey },
	},
});
const session = await plot.start(workflow);
const observation = session.observe();

try {
	if (observation.getSnapshot().completedWork.length === 0)
		await new Promise((resolve) => {
			const unsubscribe = observation.subscribe(() => {
				const snapshot = observation.getSnapshot();
				console.log(snapshot.status, snapshot.workItems, snapshot.agentRuns);
				if (snapshot.completedWork.length === 0) return;
				unsubscribe();
				resolve();
			});
		});
} finally {
	observation.close();
	await plot.dispose();
}
