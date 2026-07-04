import { describe, expect, test } from "bun:test";
import { Theme } from "@astryxdesign/core";
import { Markdown } from "@astryxdesign/core/Markdown";
import { renderToString } from "react-dom/server";
import { plotTheme } from "../src/plot-theme.js";

describe("Astryx Markdown security", () => {
	test("does not render raw HTML from transcript text", () => {
		const html = renderToString(
			<Theme theme={plotTheme} mode="light">
				<Markdown>{"<img src=x onerror=alert(1)>"}</Markdown>
			</Theme>,
		);
		expect(html).not.toContain("<img");
	});
});
