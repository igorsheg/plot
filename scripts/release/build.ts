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
	getOptionalDependencies,
	piSkillsDir,
	plotAiTemplate,
	plotAiTemplateDir,
	releaseDir,
	releaseTargets,
	repoDir,
	tuiPackage,
	version,
	webDistDir,
} from "./shared.js";

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

await $`bun run --filter @plot/web build`.cwd(repoDir);
await $`bun install --os="*" --cpu="*" @opentui/core@${tuiPackage.dependencies["@opentui/core"]}`.cwd(
	repoDir,
);

if (!existsSync(webDistDir)) {
	throw new Error(`missing web build output at ${webDistDir}`);
}

if (!existsSync(piSkillsDir)) {
	throw new Error(`missing pi skills at ${piSkillsDir}`);
}

await Promise.all(releaseTargets.map((target) => buildPlatformPackage(target)));
await buildUmbrellaPackage();

async function buildPlatformPackage(target: (typeof releaseTargets)[number]) {
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
	cpSync(piSkillsDir, join(packageDir, "pi-resources", "skills"), {
		recursive: true,
	});

	writeJson(join(packageDir, "package.json"), {
		name: target.packageName,
		version,
		type: "module",
		license: plotAiTemplate.license,
		description: plotAiTemplate.description,
		repository: plotAiTemplate.repository,
		homepage: plotAiTemplate.homepage,
		bugs: plotAiTemplate.bugs,
		os: target.os,
		cpu: target.cpu,
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

	writeFileSync(
		join(binDir, "README.md"),
		await Bun.file(join(plotAiTemplateDir, "README.md")).text(),
	);
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

	cpSync(join(plotAiTemplateDir, "README.md"), join(packageDir, "README.md"));
	cpSync(
		join(plotAiTemplateDir, "bin", "plot-ai"),
		join(packageDir, "bin", "plot-ai"),
	);
	cpSync(
		join(plotAiTemplateDir, "lib", "platform.js"),
		join(packageDir, "lib", "platform.js"),
	);
	cpSync(
		join(plotAiTemplateDir, "postinstall.mjs"),
		join(packageDir, "postinstall.mjs"),
	);

	writeJson(join(packageDir, "package.json"), {
		name: "plot-ai",
		version,
		type: "module",
		license: plotAiTemplate.license,
		description: plotAiTemplate.description,
		repository: plotAiTemplate.repository,
		homepage: plotAiTemplate.homepage,
		bugs: plotAiTemplate.bugs,
		engines: plotAiTemplate.engines,
		keywords: plotAiTemplate.keywords,
		publishConfig: plotAiTemplate.publishConfig,
		bin: {
			"plot-ai": "bin/plot-ai",
		},
		files: ["bin", "lib", "postinstall.mjs", "README.md"],
		scripts: {
			postinstall: "node ./postinstall.mjs",
		},
		optionalDependencies: getOptionalDependencies(),
	});

	await $`npm pack`.cwd(packageDir);
}

function writeJson(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
