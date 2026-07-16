#!/usr/bin/env bun

import { $ } from "bun";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, normalize, relative, sep } from "node:path";
import {
	cliEntrypoint,
	cliTsconfig,
	getOptionalDependencies,
	npmPackageDir,
	packageTemplate,
	repoDir,
	runtimePackageDir,
	sdkPackageDir,
	releaseDir,
	releaseTargets,
	version,
} from "./shared.js";

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

await $`bun --filter @plot/web build`.cwd(repoDir);
await $`bun run scripts/web-assets.ts`.cwd(repoDir);
await Promise.all([
	$`bun run build:runtime`.cwd(runtimePackageDir),
	$`bun run build:sdk`.cwd(sdkPackageDir),
]);
assertProgrammaticBundle();
await Promise.all(releaseTargets.map((target) => buildPlatformPackage(target)));
await buildUmbrellaPackage();

function assertProgrammaticBundle() {
	const bundle = readFileSync(
		join(runtimePackageDir, "dist", "index.js"),
		"utf8",
	);
	for (const forbidden of [
		"createJiti",
		"DefaultResourceLoader",
		"createAgentSessionServices",
		"SessionManagerClient",
		"resolveInstalledBinary",
	])
		if (bundle.includes(forbidden))
			throw new Error(`programmatic bundle includes ${forbidden}`);
	for (const declaration of ["index.d.ts", "observation.d.ts"])
		if (
			readFileSync(
				join(runtimePackageDir, "dist", declaration),
				"utf8",
			).includes('"@plot/')
		)
			throw new Error(
				`programmatic declaration leaks workspace types: ${declaration}`,
			);
}

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
	copyDocs(packageDir);
	copyExamples(packageDir);
	copySdkDeclarations(packageDir);

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
		files: ["bin", "docs", "examples", "lib", "package.json"],
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
		join(runtimePackageDir, "dist", "index.js"),
		join(packageDir, "lib", "index.js"),
	);
	cpSync(
		join(runtimePackageDir, "dist", "index.d.ts"),
		join(packageDir, "lib", "index.d.ts"),
	);
	cpSync(
		join(runtimePackageDir, "dist", "observation.d.ts"),
		join(packageDir, "lib", "observation.d.ts"),
	);
	cpSync(
		join(sdkPackageDir, "dist", "sdk.js"),
		join(packageDir, "lib", "sdk.js"),
	);
	cpSync(
		join(sdkPackageDir, "dist", "sdk.d.ts"),
		join(packageDir, "lib", "sdk.d.ts"),
	);
	cpSync(
		join(sdkPackageDir, "dist", "work-contract.d.ts"),
		join(packageDir, "lib", "work-contract.d.ts"),
	);
	cpSync(
		join(sdkPackageDir, "dist", "runtime-contract.d.ts"),
		join(packageDir, "lib", "runtime-contract.d.ts"),
	);
	cpSync(
		join(npmPackageDir, "postinstall.mjs"),
		join(packageDir, "postinstall.mjs"),
	);
	const readmeSrc = join(npmPackageDir, "README.md");
	if (existsSync(readmeSrc)) cpSync(readmeSrc, join(packageDir, "README.md"));
	copyDocs(packageDir);
	copyExamples(packageDir);

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
			"examples",
			"lib",
			"postinstall.mjs",
			...(existsSync(readmeSrc) ? ["README.md"] : []),
		],
		exports: packageTemplate.exports,
		dependencies: packageTemplate.dependencies,
		scripts: {
			postinstall: "node ./postinstall.mjs",
		},
		optionalDependencies: getOptionalDependencies(),
	});

	await $`npm pack`.cwd(packageDir);
}

interface DocsManifest {
	readonly navigation: readonly {
		readonly items: readonly { readonly path: string }[];
	}[];
}

function safeRelativePath(path: string, root: string): string {
	const normalized = normalize(path);
	if (
		normalized === "" ||
		normalized === "." ||
		normalized.startsWith(`..${sep}`) ||
		normalized === ".." ||
		normalized.startsWith(sep)
	)
		throw new Error(`unsafe ${root} release path: ${path}`);
	return normalized;
}

function copyRegularFile(source: string, destination: string): void {
	const stat = lstatSync(source);
	if (stat.isSymbolicLink())
		throw new Error(`release file is a symlink: ${source}`);
	if (!stat.isFile()) throw new Error(`release entry is not a file: ${source}`);
	mkdirSync(dirname(destination), { recursive: true });
	copyFileSync(source, destination);
}

function copyDocs(packageDir: string) {
	const docsDir = join(repoDir, "docs");
	const manifestPath = join(docsDir, "docs.json");
	const manifest = JSON.parse(
		readFileSync(manifestPath, "utf8"),
	) as DocsManifest;
	const files = new Set(["docs.json"]);
	for (const group of manifest.navigation)
		for (const item of group.items)
			files.add(safeRelativePath(item.path, "docs"));
	for (const file of files)
		copyRegularFile(join(docsDir, file), join(packageDir, "docs", file));
}

function forbiddenExample(path: string): boolean {
	const parts = path.split(/[\\/]/);
	const name = parts.at(-1)?.toLowerCase() ?? "";
	return (
		parts.some((part) =>
			new Set([".plot", "node_modules", ".git", ".hg", ".svn"]).has(part),
		) ||
		name === ".env" ||
		name.startsWith(".env.") ||
		name === ".dev.vars" ||
		name.startsWith(".dev.vars.") ||
		name.endsWith(".pem") ||
		name.endsWith(".key") ||
		name.endsWith(".p12") ||
		name.endsWith(".pfx") ||
		name.endsWith(".crt") ||
		name.endsWith(".cer") ||
		name.endsWith(".swp") ||
		name.endsWith(".swo")
	);
}

function copyExamples(packageDir: string) {
	const output = execFileSync("git", ["ls-files", "-z", "--", "examples"], {
		cwd: repoDir,
		encoding: "utf8",
	});
	const files = output.split("\0").filter((file) => file.length > 0);
	if (files.length === 0) throw new Error("release has no tracked examples");
	for (const tracked of files) {
		const relativePath = safeRelativePath(
			relative("examples", tracked),
			"example",
		);
		if (forbiddenExample(relativePath))
			throw new Error(`forbidden tracked example file: ${tracked}`);
		copyRegularFile(
			join(repoDir, tracked),
			join(packageDir, "examples", relativePath),
		);
	}
}

// The declarations double as the printed `plot docs sdk` reference, so the
// platform packages ship them alongside the docs payload.
function copySdkDeclarations(packageDir: string) {
	const libDir = join(packageDir, "lib");
	mkdirSync(libDir, { recursive: true });
	cpSync(join(sdkPackageDir, "dist", "sdk.d.ts"), join(libDir, "sdk.d.ts"));
	cpSync(
		join(sdkPackageDir, "dist", "work-contract.d.ts"),
		join(libDir, "work-contract.d.ts"),
	);
	cpSync(
		join(sdkPackageDir, "dist", "runtime-contract.d.ts"),
		join(libDir, "runtime-contract.d.ts"),
	);
}

function writeJson(path: string, data: unknown) {
	writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`);
}
