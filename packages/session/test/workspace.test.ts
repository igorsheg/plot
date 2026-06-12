import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	makeWorkspaceManager,
	PlotWorkspaceError,
	sanitizeWorkspaceKey,
} from "../src/workspace.js";

const tempRoot = async () => mkdtemp(join(tmpdir(), "plot-workspace-test-"));

describe("workspace manager", () => {
	test("sanitizes keys to the Symphony charset", () => {
		expect(sanitizeWorkspaceKey("github:acme/web:pr:42")).toBe(
			"github_acme_web_pr_42",
		);
		expect(sanitizeWorkspaceKey("simple-key_1.0")).toBe("simple-key_1.0");
		expect(() => sanitizeWorkspaceKey("..")).toThrow(PlotWorkspaceError);
		expect(() => sanitizeWorkspaceKey("///")).not.toThrow();
	});

	test("keys cannot traverse outside the root", async () => {
		const base = await tempRoot();
		try {
			const workspaces = makeWorkspaceManager({
				root: base,
				baseDir: base,
				namespace: "review",
			});
			const path = workspaces.pathFor("../../../etc/passwd");
			// Slashes are sanitized to underscores, so the resolved path is a
			// direct child of the root (the literal dots are filename chars).
			expect(path.startsWith(`${workspaces.root}/`)).toBe(true);
			expect(dirname(path)).toBe(workspaces.root);
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});

	test("ensure creates once and reuses across calls", async () => {
		const base = await tempRoot();
		try {
			const workspaces = makeWorkspaceManager({
				root: base,
				baseDir: base,
				namespace: "review",
			});
			const first = await workspaces.ensure("github:acme/web:pr:7");
			const second = await workspaces.ensure("github:acme/web:pr:7");
			expect(first.createdNow).toBe(true);
			expect(second.createdNow).toBe(false);
			expect(second.path).toBe(first.path);
			expect((await stat(first.path)).isDirectory()).toBe(true);
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});

	test("ensure rejects a non-directory workspace path", async () => {
		const base = await tempRoot();
		try {
			const workspaces = makeWorkspaceManager({
				root: base,
				baseDir: base,
				namespace: "review",
			});
			await workspaces.ensure("anything");
			await writeFile(workspaces.pathFor("collision"), "not a directory");
			await expect(workspaces.ensure("collision")).rejects.toThrow(
				PlotWorkspaceError,
			);
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});

	test("remove deletes the workspace and stays inside the root", async () => {
		const base = await tempRoot();
		try {
			const workspaces = makeWorkspaceManager({
				root: base,
				baseDir: base,
				namespace: "review",
				cleanup: "on_released",
			});
			const { path } = await workspaces.ensure("github:acme/web:pr:9");
			await workspaces.remove("github:acme/web:pr:9");
			expect(await stat(path).catch(() => undefined)).toBeUndefined();
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});

	test("relative roots resolve against the workflow directory and ~ expands", async () => {
		const base = await tempRoot();
		try {
			const workspaces = makeWorkspaceManager({
				root: "./nested/workspaces",
				baseDir: base,
				namespace: "review",
			});
			expect(workspaces.root).toBe(
				join(base, "nested", "workspaces", "review"),
			);
			const home = makeWorkspaceManager({
				root: "~/plot-test-workspaces",
				baseDir: base,
				namespace: "review",
			});
			expect(home.root.startsWith("/")).toBe(true);
			expect(home.root.includes("~")).toBe(false);
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});
});
