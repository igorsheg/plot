import { expect, test } from "bun:test";
import { parseDiffContext } from "./diff-context.ts";

test("parseDiffContext reports exact added and deleted line ranges", () => {
	const diff = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -10,6 +10,7 @@ export const demo = () => {
 context
-old one
-old two
+new one
+new two
+new three
 tail
@@ -30,2 +31,0 @@ export const gone = () => {
-delete old thirty
-delete old thirty one
`;

	expect(parseDiffContext(diff)).toEqual([
		{
			path: "src/example.ts",
			changedLines: [
				{ start: 11, end: 12, deletion: true },
				{ start: 11, end: 13 },
				{ start: 30, end: 31, deletion: true },
			],
		},
	]);
});

test("parseDiffContext handles addition-first hunks", () => {
	const diff = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+first
+second
`;

	expect(parseDiffContext(diff)).toEqual([
		{
			path: "src/new.ts",
			changedLines: [{ start: 1, end: 2 }],
		},
	]);
});
