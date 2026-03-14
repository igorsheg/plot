#!/usr/bin/env bun

import { $ } from "bun";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { channel, dryRun, releaseDir } from "./shared.js";

const provenance = !dryRun && process.env["CI"] === "true";

const entries = readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const platformPackages = entries.filter((entry) => entry !== "plot-ai");

await Promise.all(platformPackages.map((entry) => publishPackage(join(releaseDir, entry))));
await publishPackage(join(releaseDir, "plot-ai"));

async function isAlreadyPublished(packageName: string, version: string): Promise<boolean> {
  if (dryRun) return false;
  try {
    const result = await $`npm view ${packageName} versions --json`.quiet();
    const parsed = JSON.parse(result.stdout.toString());
    const versions: string[] = Array.isArray(parsed) ? parsed : [parsed];
    return versions.includes(version);
  } catch {
    return false;
  }
}

async function publishPackage(packageDir: string) {
  const manifest = await Bun.file(join(packageDir, "package.json")).json();
  const mode = dryRun ? "dry-run" : "publish";

  if (await isAlreadyPublished(manifest.name, manifest.version)) {
    console.log(`skip ${manifest.name}@${manifest.version} — already published`);
    return;
  }

  console.log(`${mode} ${manifest.name}@${manifest.version} (${channel})`);

  const args = ["publish", "--access", "public", "--tag", channel];
  if (dryRun) args.push("--dry-run");
  if (provenance) args.push("--provenance");

  await $`npm ${args}`.cwd(packageDir);
}
