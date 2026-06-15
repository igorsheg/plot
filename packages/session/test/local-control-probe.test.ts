import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { localPlotServerRunning } from "../src/local-control-client.js";

describe("localPlotServerRunning", () => {
	test("returns false when no server is running (connect-only, no autostart)", async () => {
		// A fresh server dir with no metadata: the probe must report "not running"
		// rather than spawning a server — this is what lets the TUI fall back to an
		// in-process session instead of starting a competing server.
		const serverDir = await mkdtemp(join(tmpdir(), "plot-probe-"));
		expect(await localPlotServerRunning({ serverDir })).toBe(false);
	});
});
