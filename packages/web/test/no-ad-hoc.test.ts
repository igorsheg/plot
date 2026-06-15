import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Anti-ad-hoc ratchet. The Fluid Functionalism overhaul forbids ad-hoc Tailwind
// in the app + component layers: every visual decision must flow through a
// defined primitive or token. Two unambiguous smells are gated here:
//
//   - `text-[12px]` & friends  → use the type scale (text-2xs|xs|sm|base)
//   - window.confirm / .prompt  → use the Dialog / InputMessage primitives
//
// Existing violations are captured in ad-hoc-baseline.json and may only shrink.
// New code cannot add any. After a phase removes violations, regenerate with:
//
//   UPDATE_BASELINE=1 bun test test/no-ad-hoc.test.ts
//
// The goal is an empty baseline.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "src");
const scanDirs = ["app", "components", "hooks"];
const baselinePath = join(here, "ad-hoc-baseline.json");

const PATTERNS = {
	adHocTextSize: /text-\[[0-9]/g,
	nativeDialog: /window\.(confirm|prompt)\(/g,
} as const;

type Counts = Partial<Record<keyof typeof PATTERNS, number>>;

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...walk(full));
		} else if (/\.tsx?$/.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

function scan(): Record<string, Counts> {
	const result: Record<string, Counts> = {};
	for (const sub of scanDirs) {
		const base = join(root, sub);
		let files: string[];
		try {
			files = walk(base);
		} catch {
			continue;
		}
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			const counts: Counts = {};
			for (const [name, pattern] of Object.entries(PATTERNS)) {
				const n = source.match(pattern)?.length ?? 0;
				if (n > 0) counts[name as keyof typeof PATTERNS] = n;
			}
			if (Object.keys(counts).length > 0) {
				result[relative(root, file)] = counts;
			}
		}
	}
	return result;
}

describe("anti-ad-hoc ratchet", () => {
	const current = scan();

	if (process.env["UPDATE_BASELINE"] === "1") {
		test("baseline regenerated", () => {
			writeFileSync(baselinePath, `${JSON.stringify(current, null, "\t")}\n`);
			expect(true).toBe(true);
		});
		return;
	}

	const baseline: Record<string, Counts> = JSON.parse(
		readFileSync(baselinePath, "utf8"),
	);

	test("no file introduces or increases ad-hoc violations", () => {
		const regressions: string[] = [];
		for (const [file, counts] of Object.entries(current)) {
			for (const [name, n] of Object.entries(counts)) {
				const allowed = baseline[file]?.[name as keyof typeof PATTERNS] ?? 0;
				if (n > allowed) {
					regressions.push(`${file}: ${name} ${n} > baseline ${allowed}`);
				}
			}
		}
		expect(regressions).toEqual([]);
	});
});
