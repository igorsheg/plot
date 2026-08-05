import { createHash } from "node:crypto";

export interface City {
	readonly slug: string;
	readonly name: string;
	/** Cities without a station are discovered blocked, for the Attention path. */
	readonly station: boolean;
}

export const CITIES: readonly City[] = [
	{ slug: "sfo", name: "San Francisco", station: true },
	{ slug: "nyc", name: "New York", station: true },
	{ slug: "chi", name: "Chicago", station: true },
	{ slug: "sea", name: "Seattle", station: true },
	{ slug: "aus", name: "Austin", station: true },
	{ slug: "den", name: "Denver", station: true },
	{ slug: "mia", name: "Miami", station: true },
	{ slug: "bos", name: "Boston", station: true },
	{ slug: "pdx", name: "Portland", station: true },
	{ slug: "phx", name: "Phoenix", station: true },
	{ slug: "msp", name: "Minneapolis", station: true },
	{ slug: "atlantis", name: "Atlantis", station: false },
];

export const cityBySlug = (slug: string): City => {
	const city = CITIES.find((candidate) => candidate.slug === slug);
	if (city === undefined) throw new Error(`unknown city ${slug}`);
	return city;
};

export interface Reading {
	readonly condition: string;
	readonly temperatureF: number;
	readonly windMph: number;
	readonly humidity: number;
}

const CONDITIONS = [
	"fog",
	"sun",
	"rain",
	"low clouds",
	"wind",
	"snow flurries",
] as const;

/** Deterministic synthetic reading so report files are stable per cycle. */
export const readingFor = (slug: string, cycle: number): Reading => {
	const hash = createHash("sha256").update(`${slug}@${cycle}`).digest();
	return {
		condition: CONDITIONS[(hash[0] ?? 0) % CONDITIONS.length] ?? "fog",
		temperatureF: 20 + ((hash[1] ?? 0) % 86),
		windMph: (hash[2] ?? 0) % 31,
		humidity: 15 + ((hash[3] ?? 0) % 81),
	};
};

export const readingText = (city: City, reading: Reading): string =>
	`${city.name}: ${reading.temperatureF}°F, ${reading.condition}, wind ${reading.windMph}mph, humidity ${reading.humidity}%`;

export const reportBody = (input: {
	readonly city: City;
	readonly cycle: number;
	readonly summary: string;
}): string => {
	const reading = readingFor(input.city.slug, input.cycle);
	return [
		`# ${input.city.name} — weather report`,
		"",
		`- digest cycle: cycle-${input.cycle}`,
		`- station reading: ${readingText(input.city, reading)}`,
		"",
		input.summary,
		"",
	].join("\n");
};

export interface DigestItem {
	readonly id: string;
	readonly version: string;
	readonly city: City;
}

export interface DigestSnapshot {
	readonly version: string;
	readonly completed: number;
	readonly total: number;
	readonly phase: "starting" | "collecting" | "digest complete";
	readonly items: readonly DigestItem[];
}

/**
 * Demo domain state: which cities still owe a report this cycle. Plot owns
 * scheduling; this only answers "what is currently relevant" for discover.
 */
export class WeatherDigest {
	private readonly reported = new Set<string>();
	private reportedCycle = -1;
	private readonly skipped = new Set<string>();

	constructor(
		private readonly cycleMs: number,
		private readonly bootMs: number,
	) {}

	snapshot(nowMs: number): DigestSnapshot {
		const cycle = Math.floor((nowMs - this.bootMs) / this.cycleMs);
		const version = `cycle-${cycle}`;
		if (cycle !== this.reportedCycle) {
			// Prune rather than clear: marks may arrive before this cycle's
			// first snapshot (finished hooks race the tick).
			for (const key of this.reported)
				if (!key.endsWith(`@${version}`)) this.reported.delete(key);
			this.reportedCycle = cycle;
		}
		const live = CITIES.filter((city) => !this.skipped.has(city.slug));
		const isDone = (city: City) => this.reported.has(`${city.slug}@${version}`);
		const completed = live.filter(isDone).length;
		return {
			version,
			completed,
			total: live.length,
			phase:
				completed === 0
					? "starting"
					: completed < live.length
						? "collecting"
						: "digest complete",
			items: live
				.filter((city) => !isDone(city))
				.map((city) => ({
					id: `weather:city:${city.slug}`,
					version,
					city,
				})),
		};
	}

	markReported(slug: string, version: string): void {
		this.reported.add(`${slug}@${version}`);
	}

	skip(slug: string): void {
		this.skipped.add(slug);
	}
}
