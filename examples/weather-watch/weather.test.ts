import { describe, expect, test } from "bun:test";
import {
	CITIES,
	WeatherDigest,
	readingFor,
	readingText,
	reportBody,
} from "./weather.ts";

const bootMs = 1_000_000;
const cycleMs = 600_000;

describe("weather watch demo", () => {
	test("readings are deterministic within a cycle", () => {
		expect(readingFor("sfo", 0)).toEqual(readingFor("sfo", 0));
		expect(readingText(CITIES[0]!, readingFor("sfo", 0))).toContain(
			"San Francisco:",
		);
	});

	test("report body carries the cycle and the station reading", () => {
		const body = reportBody({
			city: CITIES[0]!,
			cycle: 3,
			summary: "Foggy morning.",
		});
		expect(body).toContain("# San Francisco — weather report");
		expect(body).toContain("digest cycle: cycle-3");
		expect(body).toContain("Foggy morning.");
	});

	test("fans out twelve city children, Atlantis blocked by missing station", () => {
		const snapshot = new WeatherDigest(cycleMs, bootMs).snapshot(bootMs + 1000);
		expect(snapshot.items).toHaveLength(12);
		expect(snapshot.completed).toBe(0);
		expect(snapshot.total).toBe(12);
		expect(snapshot.phase).toBe("starting");
		expect(snapshot.version).toBe("cycle-0");
		const atlantis = snapshot.items.find(
			(item) => item.id === "weather:city:atlantis",
		);
		expect(atlantis?.city.station).toBe(false);
	});

	test("reported cities leave discovery and advance progress", () => {
		const digest = new WeatherDigest(cycleMs, bootMs);
		digest.markReported("sfo", "cycle-0");
		const snapshot = digest.snapshot(bootMs + 1000);
		expect(snapshot.items.some((item) => item.id === "weather:city:sfo")).toBe(
			false,
		);
		expect(snapshot.completed).toBe(1);
		expect(snapshot.phase).toBe("collecting");
	});

	test("a skipped city shrinks the digest total", () => {
		const digest = new WeatherDigest(cycleMs, bootMs);
		digest.skip("atlantis");
		const snapshot = digest.snapshot(bootMs + 1000);
		expect(snapshot.total).toBe(11);
		expect(
			snapshot.items.some((item) => item.id === "weather:city:atlantis"),
		).toBe(false);
	});

	test("a new cycle rediscovers reported cities", () => {
		const digest = new WeatherDigest(cycleMs, bootMs);
		digest.markReported("sfo", "cycle-0");
		const next = digest.snapshot(bootMs + cycleMs + 1000);
		expect(next.version).toBe("cycle-1");
		expect(next.completed).toBe(0);
		expect(next.items.some((item) => item.id === "weather:city:sfo")).toBe(
			true,
		);
	});
});
