#!/usr/bin/env bun

import { $ } from "bun";
import {
	cpSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
	chmodSync,
	readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = join(scriptDir, "../../..");
const releaseDir = join(repoDir, "dist/release");
const publicPackageDir = join(repoDir, "packages/plot-ai");
const publicPackage = JSON.parse(
	readFileSync(join(publicPackageDir, "package.json"), "utf8"),
);
const tuiPackage = JSON.parse(
	readFileSync(join(repoDir, "packages/tui/package.json"), "utf8"),
);
const version = process.env["PLOT_VERSION"] ?? publicPackage.version;

const targets = [
	{
		packageName: "@plot/cli-darwin-arm64",
		dirName: "plot-cli-darwin-arm64",
		bunTarget: "bun-darwin-arm64",
		os: ["darwin"],
		cpu: ["arm64"],
		binName: "plot-ai",
	},
	{
		packageName: "@plot/cli-darwin-x64",
		dirName: "plot-cli-darwin-x64",
		bunTarget: "bun-darwin-x64",
		os: ["darwin"],
		cpu: ["x64"],
		binName: "plot-ai",
	},
	{
		packageName: "@plot/cli-linux-arm64-gnu",
		dirName: "plot-cli-linux-arm64-gnu",
		bunTarget: "bun-linux-arm64",
		os: ["linux"],
		cpu: ["arm64"],
		binName: "plot-ai",
	},
	{
		packageName: "@plot/cli-linux-x64-gnu",
		dirName: "plot-cli-linux-x64-gnu",
		bunTarget: "bun-linux-x64",
		os: ["linux"],
		cpu: ["x64"],
		binName: "plot-ai",
	},
	{
		packageName: "@plot/cli-linux-x64-musl",
		dirName: "plot-cli-linux-x64-musl",
		bunTarget: "bun-linux-x64-musl",
		os: ["linux"],
		cpu: ["x64"],
		binName: "plot-ai",
	},
	{
		packageName: "@plot/cli-win32-x64-msvc",
		dirName: "plot-cli-win32-x64-msvc",
		bunTarget: "bun-windows-x64",
		os: ["win32"],
		cpu: ["x64"],
		binName: "plot-ai.exe",
	},
] as const;

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

await $`bun run --filter @plot/web build`.cwd(repoDir);
await $`bun install --os="*" --cpu="*" @opentui/core@${tuiPackage.dependencies["@opentui/core"]}`
	.env({ ...process.env, PLOT_SKIP_POSTINSTALL_CHECK: "1" })
	.cwd(repoDir);

const webDistDir = join(repoDir, "packages/web/dist");
if (!existsSync(webDistDir)) {
	throw new Error(`missing web build output at ${webDistDir}`);
}

const optionalDependencies = Object.fromEntries(
	targets.map((target) => [target.packageName, version]),
);

await Promise.all(
	targets.map(async (target) => {
		const packageDir = join(releaseDir, target.dirName);
		const binDir = join(packageDir, "bin");
		mkdirSync(binDir, { recursive: true });

		const result = await Bun.build({
			entrypoints: [join(repoDir, "packages/cli/src/index.ts")],
			sourcemap: "external",
			target: "bun",
			compile: {
				target: target.bunTarget as never,
				outfile: join(binDir, target.binName),
				windows: {},
			},
			tsconfig: join(repoDir, "packages/cli/tsconfig.json"),
		});

		if (!result.success) {
			throw new Error(`failed to build ${target.packageName}`);
		}

		if (process.platform !== "win32") {
			chmodSync(join(binDir, target.binName), 0o755);
		}

		cpSync(webDistDir, join(packageDir, "web-dist"), { recursive: true });

		const manifest = {
			name: target.packageName,
			version,
			type: "module",
			license: publicPackage.license,
			description: publicPackage.description,
			repository: publicPackage.repository,
			homepage: publicPackage.homepage,
			bugs: publicPackage.bugs,
			os: target.os,
			cpu: target.cpu,
			files: ["bin", "web-dist", "package.json"],
		};

		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify(manifest, null, 2) + "\n",
		);
		writeFileSync(
			join(binDir, "package.json"),
			JSON.stringify(
				{
					name: target.packageName,
					version,
					piConfig: {
						name: "plot",
						configDir: ".plot",
					},
				},
				null,
				2,
			) + "\n",
		);
		writeFileSync(
			join(binDir, "README.md"),
			await Bun.file(join(repoDir, "packages/plot-ai/README.md")).text(),
		);
		writeFileSync(
			join(binDir, "CHANGELOG.md"),
			`# changelog\n\n## ${version}\n\n- packaged plot-ai release\n`,
		);

		await $`npm pack`.cwd(packageDir);
	}),
);

const umbrellaDir = join(releaseDir, "plot-ai");
cpSync(publicPackageDir, umbrellaDir, { recursive: true });

writeFileSync(
	join(umbrellaDir, "package.json"),
	JSON.stringify(
		{
			...publicPackage,
			version,
			optionalDependencies,
		},
		null,
		2,
	) + "\n",
);

await $`npm pack`.cwd(umbrellaDir);
