#!/usr/bin/env bun

import { $ } from "bun";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	cliEntrypoint,
	cliTsconfig,
	getOptionalDependencies,
	npmPackageDir,
	packageTemplate,
	repoDir,
	sdkPackageDir,
	releaseDir,
	releaseTargets,
	version,
} from "./shared.js";

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

await $`bun run build`.cwd(sdkPackageDir);
await Promise.all(releaseTargets.map((target) => buildPlatformPackage(target)));
await buildUmbrellaPackage();

async function buildPlatformPackage(target: (typeof releaseTargets)[number]) {
	const packageDir = join(releaseDir, target.dirName);
	const binDir = join(packageDir, "bin");
	mkdirSync(binDir, { recursive: true });

	const result = await Bun.build({
		entrypoints: [cliEntrypoint],
		target: "bun",
		compile: {
			target: target.bunTarget as never,
			outfile: join(binDir, "plot"),
		},
		tsconfig: cliTsconfig,
	});

	if (!result.success) {
		throw new Error(`failed to build ${target.packageName}`);
	}

	chmodSync(join(binDir, "plot"), 0o755);

	writeJson(join(packageDir, "package.json"), {
		name: target.packageName,
		version,
		type: "module",
		license: packageTemplate.license,
		description: packageTemplate.description,
		repository: packageTemplate.repository,
		homepage: packageTemplate.homepage,
		bugs: packageTemplate.bugs,
		os: target.os,
		cpu: target.cpu,
		publishConfig: { access: "public" },
		bin: {
			plot: "bin/plot",
		},
		files: ["bin", "package.json"],
	});

	await $`npm pack`.cwd(packageDir);
}

async function buildUmbrellaPackage() {
	const packageDir = join(releaseDir, "plot-ai");
	mkdirSync(join(packageDir, "bin"), { recursive: true });
	mkdirSync(join(packageDir, "lib"), { recursive: true });

	cpSync(join(npmPackageDir, "bin", "plot"), join(packageDir, "bin", "plot"));
	chmodSync(join(packageDir, "bin", "plot"), 0o755);
	cpSync(join(npmPackageDir, "lib"), join(packageDir, "lib"), {
		recursive: true,
	});
	cpSync(
		join(sdkPackageDir, "dist", "index.js"),
		join(packageDir, "lib", "sdk.js"),
	);
	cpSync(
		join(sdkPackageDir, "dist", "index.d.ts"),
		join(packageDir, "lib", "sdk.d.ts"),
	);
	cpSync(
		join(npmPackageDir, "postinstall.mjs"),
		join(packageDir, "postinstall.mjs"),
	);
	const readmeSrc = join(npmPackageDir, "README.md");
	if (existsSync(readmeSrc)) cpSync(readmeSrc, join(packageDir, "README.md"));
	cpSync(join(repoDir, "docs"), join(packageDir, "docs"), { recursive: true });

	writeJson(join(packageDir, "package.json"), {
		name: "plot-ai",
		version,
		type: "module",
		license: packageTemplate.license,
		description: packageTemplate.description,
		repository: packageTemplate.repository,
		homepage: packageTemplate.homepage,
		bugs: packageTemplate.bugs,
		keywords: packageTemplate.keywords,
		engines: packageTemplate.engines,
		publishConfig: packageTemplate.publishConfig,
		bin: {
			plot: "bin/plot",
		},
		files: [
			"bin",
			"docs",
			"lib",
			"postinstall.mjs",
			...(existsSync(readmeSrc) ? ["README.md"] : []),
		],
		exports: packageTemplate.exports,
		scripts: {
			postinstall: "node ./postinstall.mjs",
		},
		optionalDependencies: getOptionalDependencies(),
	});

	await $`npm pack`.cwd(packageDir);
}

function writeJson(path: string, data: unknown) {
	writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`);
}
