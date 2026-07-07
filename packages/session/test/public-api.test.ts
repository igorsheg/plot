import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const expectedExports = [
	"./pi-session",
	"./auth",
	"./history",
	"./runtime",
	"./serve",
	"./host",
	"./paths",
	"./pi-runner",
	"./protocol",
	"./transcript",
	"./workflow",
] as const;

const deniedExports = [
	`./session-host`,
	`./${"super"}visor`,
	`./${"super"}visor-ipc`,
	`./${"super"}visor-model`,
	`./protocol-jsonl`,
	`./protocol-stdio`,
	`./testing`,
	`./plot-paths`,
] as const;

describe("@plot/session public API", () => {
	test("exports only intentional owner modules", async () => {
		const text = await readFile(
			join(import.meta.dir, "..", "package.json"),
			"utf8",
		);
		const pkg = JSON.parse(text) as {
			readonly exports?: Record<
				string,
				{ readonly import?: string; readonly types?: string }
			>;
			readonly sideEffects?: boolean;
		};
		const exports = Object.keys(pkg.exports ?? {}).toSorted();

		expect(exports).toEqual([...expectedExports].toSorted());
		expect(pkg.sideEffects).toBe(false);
		for (const [name, target] of Object.entries(pkg.exports ?? {})) {
			expect(target.import).toBe(`./src/${name.slice(2)}.ts`);
			expect(target.types).toBe(`./src/${name.slice(2)}.ts`);
		}
		for (const name of deniedExports) expect(exports).not.toContain(name);
		expect(exports.some((name) => name.startsWith("./pi/"))).toBe(false);
	});
});
