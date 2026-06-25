import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const apiPort = process.env.PLOT_WEB_API_PORT ?? "4317";
const apiUrl = `http://127.0.0.1:${apiPort}`;

const children = [
	spawn(
		"bun",
		["packages/cli/src/main.ts", "web", "--no-open", "--port", apiPort],
		{
			cwd: root,
			stdio: "inherit",
		},
	),
	spawn("bun", ["vite", "--host", "127.0.0.1"], {
		cwd: resolve(root, "packages/web"),
		env: { ...process.env, PLOT_WEB_API_URL: apiUrl },
		stdio: "inherit",
	}),
];

let stopping = false;
const stop = () => {
	if (stopping) return;
	stopping = true;
	for (const child of children) child.kill("SIGTERM");
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const [code] = (await Promise.race(
	children.map((child) => once(child, "exit")),
)) as [number | null];
stop();
process.exitCode = code ?? 0;
