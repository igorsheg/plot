import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defineExtension,
	defineTool,
	type ExtensionTool,
	type ExtensionWork,
	type WorkSubject,
} from "plot-ai/sdk";
import {
	WeatherDigest,
	cityBySlug,
	readingFor,
	readingText,
	reportBody,
} from "./weather.ts";

interface WeatherConfig {
	readonly cycleMs: number;
	readonly reportDir?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const positiveInteger = (value: unknown, fallback: number) =>
	typeof value === "number" && Number.isInteger(value) && value >= 1
		? value
		: fallback;

const parseConfig = (input: unknown): WeatherConfig => {
	const record = isRecord(input) ? input : {};
	const config: WeatherConfig = {
		cycleMs: positiveInteger(record["cycleMs"], 600_000),
	};
	const reportDir = record["reportDir"];
	if (typeof reportDir === "string" && reportDir.length > 0)
		return { ...config, reportDir };
	return config;
};

const workSlug = (work: Pick<ExtensionWork, "id">) =>
	work.id.replace(/^weather:city:/, "");

export default defineExtension<WeatherConfig>({
	id: "plot-weather-watch",
	parseConfig,
	create({ config }) {
		const bootMs = Date.now();
		const reportDir = config.reportDir ?? join(tmpdir(), "plot-weather-watch");
		const digest = new WeatherDigest(config.cycleMs, bootMs);
		const currentCycle = () =>
			Math.floor((Date.now() - bootMs) / config.cycleMs);

		const tools: ExtensionTool<WeatherConfig>[] = [
			({ work }) =>
				defineTool({
					name: "weather_check",
					label: "Check weather",
					description:
						"Read today's synthetic station data for this Work Item's city.",
					parameters: { type: "object" },
					execute: () => {
						const city = cityBySlug(workSlug(work));
						const reading = readingFor(city.slug, currentCycle());
						return {
							content: [{ type: "text", text: readingText(city, reading) }],
							details: { city: city.slug, ...reading },
						};
					},
				}),
			({ work }) =>
				defineTool({
					name: "weather_write_report",
					label: "Write report",
					description:
						"Write this city's markdown weather report into the digest report directory.",
					parameters: {
						type: "object",
						properties: { summary: { type: "string" } },
						required: ["summary"],
					},
					execute: async (params) => {
						const city = cityBySlug(workSlug(work));
						const summary =
							typeof params.summary === "string"
								? params.summary
								: "no summary";
						await mkdir(reportDir, { recursive: true });
						const target = join(reportDir, `${city.slug}.md`);
						await writeFile(
							target,
							reportBody({ city, cycle: currentCycle(), summary }),
							"utf8",
						);
						return {
							content: [{ type: "text", text: `wrote ${target}` }],
							details: { path: target },
						};
					},
				}),
			() =>
				defineTool({
					name: "weather_finish",
					label: "Finish report",
					description:
						"Finish this city's report after its markdown file is written.",
					parameters: {
						type: "object",
						properties: { status: { type: "string" } },
						required: ["status"],
					},
					execute: (params) => ({
						content: [
							{
								type: "text",
								text:
									typeof params.status === "string"
										? params.status
										: "report done",
							},
						],
						terminate: true,
					}),
				}),
		];

		return {
			tools,
			discover() {
				const snapshot = digest.snapshot(Date.now());
				const subject: WorkSubject = {
					id: "weather:daily-digest",
					display: {
						kind: "digest",
						primary: "WX",
						title: "Daily weather digest",
						subtitle: `${snapshot.total} cities`,
						version: snapshot.version,
						labels: ["demo", "weather"],
					},
					progress: {
						completed: snapshot.completed,
						total: snapshot.total,
						phase: snapshot.phase,
					},
				};
				return snapshot.items.map((item): ExtensionWork => {
					const base = {
						id: item.id,
						version: item.version,
						title: item.city.name,
						display: { kind: "city", title: item.city.name },
						subject,
						context: {
							cityName: item.city.name,
							cycle: item.version,
							reportDir,
						},
					};
					if (item.city.station) return base;
					return {
						...base,
						status: "blocked",
						blockedReason: "no weather station in range",
						operatorActions: [{ id: "skip-city", label: "Skip city" }],
					};
				});
			},
			finished(event) {
				if (event.completion.status === "succeeded")
					digest.markReported(
						workSlug(event.work),
						event.work.version ?? "unversioned",
					);
			},
			operatorAction(event) {
				if (event.actionId === "skip-city") digest.skip(workSlug(event.work));
			},
		};
	},
});
