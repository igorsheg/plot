#!/usr/bin/env bun

import { $ } from "bun";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	getOptionalDependencies,
	piSkillsDir,
	plotPackage,
	plotPackageDir,
	readJson,
	releaseDir,
	releaseTargets,
	repoDir,
	version,
	webDistDir,
} from "./shared.js";

const tuiPackage = readJson(join(repoDir, "packages/tui/package.json")) as {
	dependencies: Record<string, string>;
};
const opentuiVersion = tuiPackage.dependencies["@opentui/core"].replace("^", "");
await $`bun install --os="*" --cpu="*" @opentui/core@${opentuiVersion}`.cwd(repoDir);

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

await $`bun run --filter @plot/sdk build`.cwd(repoDir);
await $`bun run --filter @plot/web build`.cwd(repoDir);

if (!existsSync(webDistDir)) {
	throw new Error(`missing web build output at ${webDistDir}`);
}

if (!existsSync(piSkillsDir)) {
	throw new Error(`missing pi skills at ${piSkillsDir}`);
}

await Promise.all(releaseTargets.map((target) => buildPlatformPackage(target)));
await buildUmbrellaPackage();
await buildSdkPackage();

async function buildPlatformPackage(target: (typeof releaseTargets)[number]) {
	const packageDir = join(releaseDir, target.dirName);
	const binDir = join(packageDir, "bin");
	mkdirSync(binDir, { recursive: true });

	const result = await Bun.build({
		entrypoints: [join(repoDir, "packages/plot/src/cli/index.ts")],
		sourcemap: "external",
		target: "bun",
		compile: {
			target: target.bunTarget as never,
			outfile: join(binDir, target.binName),
			windows: {},
		},
		tsconfig: join(repoDir, "packages/plot/tsconfig.json"),
	});

	if (!result.success) {
		throw new Error(`failed to build ${target.packageName}`);
	}

	if (process.platform !== "win32") {
		chmodSync(join(binDir, target.binName), 0o755);
	}

	const workerResult = await Bun.build({
		entrypoints: [join(repoDir, "packages/plot/src/tui-worker.ts")],
		target: "bun",
		outdir: binDir,
		naming: "tui-worker.js",
		tsconfig: join(repoDir, "packages/plot/tsconfig.json"),
	});

	if (!workerResult.success) {
		throw new Error(`failed to bundle tui-worker for ${target.packageName}`);
	}

	cpSync(webDistDir, join(packageDir, "web-dist"), { recursive: true });
	cpSync(piSkillsDir, join(packageDir, "pi-resources", "skills"), {
		recursive: true,
	});

	copyTrackerSkills(binDir);

	writeJson(join(packageDir, "package.json"), {
		name: target.packageName,
		version,
		type: "module",
		license: plotPackage.license,
		description: plotPackage.description,
		repository: plotPackage.repository,
		homepage: plotPackage.homepage,
		bugs: plotPackage.bugs,
		os: target.os,
		cpu: target.cpu,
		publishConfig: { access: "public" },
		files: ["bin", "web-dist", "pi-resources", "package.json"],
	});

	writeJson(join(binDir, "package.json"), {
		name: target.packageName,
		version,
		piConfig: {
			name: "plot",
			configDir: ".plot",
		},
	});

	const readmePath = join(plotPackageDir, "README.md");
	if (existsSync(readmePath)) {
		writeFileSync(join(binDir, "README.md"), await Bun.file(readmePath).text());
	}
	writeFileSync(
		join(binDir, "CHANGELOG.md"),
		`# changelog\n\n## ${version}\n\n- packaged plot-ai release\n`,
	);

	await $`npm pack`.cwd(packageDir);
}

async function buildUmbrellaPackage() {
	const packageDir = join(releaseDir, "plot-ai");
	mkdirSync(join(packageDir, "bin"), { recursive: true });
	mkdirSync(join(packageDir, "lib"), { recursive: true });

	const readmeSrc = join(plotPackageDir, "README.md");
	if (existsSync(readmeSrc)) {
		cpSync(readmeSrc, join(packageDir, "README.md"));
	}
	cpSync(join(plotPackageDir, "bin", "plot-ai"), join(packageDir, "bin", "plot-ai"));
	cpSync(join(plotPackageDir, "lib", "platform.js"), join(packageDir, "lib", "platform.js"));
	cpSync(join(plotPackageDir, "postinstall.mjs"), join(packageDir, "postinstall.mjs"));

	writeJson(join(packageDir, "package.json"), {
		name: "plot-ai",
		version,
		type: "module",
		license: plotPackage.license,
		description: plotPackage.description,
		repository: plotPackage.repository,
		homepage: plotPackage.homepage,
		bugs: plotPackage.bugs,
		engines: plotPackage.engines,
		keywords: plotPackage.keywords,
		publishConfig: plotPackage.publishConfig,
		bin: {
			"plot-ai": "bin/plot-ai",
		},
		files: ["bin", "lib", "postinstall.mjs", ...(existsSync(readmeSrc) ? ["README.md"] : [])],
		scripts: {
			postinstall: "node ./postinstall.mjs",
		},
		optionalDependencies: getOptionalDependencies(),
	});

	await $`npm pack`.cwd(packageDir);
}

async function buildSdkPackage() {
	const sdkDir = join(repoDir, "packages/sdk");
	const packageDir = join(releaseDir, "plot-sdk");
	mkdirSync(packageDir, { recursive: true });

	await $`bun run build`.cwd(sdkDir);
	cpSync(join(sdkDir, "dist"), join(packageDir, "dist"), { recursive: true });

	const sdkPackage = readJson(join(sdkDir, "package.json")) as Record<string, unknown>;
	writeJson(join(packageDir, "package.json"), {
		...sdkPackage,
		version,
		exports: {
			".": {
				types: "./dist/index.d.ts",
				default: "./dist/index.js",
			},
			"./plugin": {
				types: "./dist/plugin/index.d.ts",
				default: "./dist/plugin/index.js",
			},
		},
		files: ["dist"],
	});

	const readmePath = join(sdkDir, "README.md");
	if (existsSync(readmePath)) {
		cpSync(readmePath, join(packageDir, "README.md"));
	}

	await $`npm pack`.cwd(packageDir);
}

function copyTrackerSkills(binDir: string) {
	const trackerSrcDir = join(repoDir, "packages/plot/src/tracker");
	if (!existsSync(trackerSrcDir)) return;

	for (const entry of readdirSync(trackerSrcDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const skillsDir = join(trackerSrcDir, entry.name, "skills");
		if (!existsSync(skillsDir)) continue;
		const dest = join(binDir, "tracker", entry.name, "skills");
		cpSync(skillsDir, dest, { recursive: true });
	}
}

function writeJson(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
