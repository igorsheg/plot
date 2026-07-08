"use client";

/**
 * Streamed LLM markdown — the ONE sanctioned exception to AGENTS.md's "visible
 * text renders through Text" rule. Only LLM-authored streaming text is markdown
 * (thinking/message streams, transcript text/thinking entries, completed
 * messages, blocked reasons); everything else — tool calls, timelines,
 * diagnostics, facts, times — stays plain `Text`, because a markdown renderer
 * mangles `file_names_with_underscores` and turns tool JSON into soup.
 *
 * Two explicit primitives, no boolean mode props:
 *   - `StreamedProse` — block markdown for drawer sections and the transcript.
 *   - `StreamedLine`  — single-line inline markdown for river/drawer one-liners;
 *     flattens every block to inline and truncates, so a mid-parse heading or
 *     code fence never grows the row. It inherits the caller's font and size;
 *     `tone` sets only the color.
 *
 * Both wrap vercel/streamdown, which memoizes at block level internally; we add
 * `React.memo` on the primitives so an unchanged `text` between polls is a
 * no-op. Code highlighting (Shiki) is intentionally bypassed via `code`/`pre`
 * overrides — a stream snippet is not a document, and we want synchronous,
 * token-styled output. Images are stripped.
 */

import { memo } from "react";
import { Streamdown, type Components } from "streamdown";
import { cn } from "../../lib/utils.js";
import { textVariants } from "./text.js";
/** Fenced/indented block code vs inline code: a language class or a newline. */
const isBlockCode = (className: string | undefined, text: string): boolean =>
	/language-/.test(className ?? "") || text.includes("\n");

const proseCodeBlockClass = cn(
	"my-0 overflow-x-auto rounded-md bg-muted p-3",
	textVariants({ size: "sm" }),
);
const inlineCodeClass = "rounded bg-muted px-1 py-0.5";

/** Block-level components: our tokens, tight rhythm, no document chrome. */
const proseComponents: Components = {
	p: ({ children }) => <p className="my-0">{children}</p>,
	// A stream snippet is not a document: headings collapse to strong body text.
	h1: ({ children }) => <p className="my-0 font-semibold">{children}</p>,
	h2: ({ children }) => <p className="my-0 font-semibold">{children}</p>,
	h3: ({ children }) => <p className="my-0 font-semibold">{children}</p>,
	h4: ({ children }) => <p className="my-0 font-semibold">{children}</p>,
	h5: ({ children }) => <p className="my-0 font-semibold">{children}</p>,
	h6: ({ children }) => <p className="my-0 font-semibold">{children}</p>,
	ul: ({ children }) => (
		<ul className="my-0 list-disc space-y-1 pl-5">{children}</ul>
	),
	ol: ({ children }) => (
		<ol className="my-0 list-decimal space-y-1 pl-5">{children}</ol>
	),
	li: ({ children }) => <li className="my-0">{children}</li>,
	strong: ({ children }) => (
		<strong className="font-semibold">{children}</strong>
	),
	em: ({ children }) => <em className="italic">{children}</em>,
	a: ({ children, href }) => (
		<a
			className="text-info-foreground underline underline-offset-2"
			href={href}
			rel="noreferrer"
			target="_blank"
		>
			{children}
		</a>
	),
	blockquote: ({ children }) => (
		<blockquote className="my-0 border-border border-l-2 pl-3 text-muted-foreground">
			{children}
		</blockquote>
	),
	hr: () => <hr className="my-1 border-border" />,
	pre: ({ children }) => <>{children}</>,
	code: ({ className, children }) => {
		const text = String(children ?? "");
		return isBlockCode(className, text) ? (
			<pre className={proseCodeBlockClass}>
				<code>{children}</code>
			</pre>
		) : (
			<code className={inlineCodeClass}>{children}</code>
		);
	},
};

/** Line-level components: everything inline; block code becomes inline code. */
const lineComponents: Components = {
	p: ({ children }) => <span>{children}</span>,
	h1: ({ children }) => <span className="font-semibold">{children}</span>,
	h2: ({ children }) => <span className="font-semibold">{children}</span>,
	h3: ({ children }) => <span className="font-semibold">{children}</span>,
	h4: ({ children }) => <span className="font-semibold">{children}</span>,
	h5: ({ children }) => <span className="font-semibold">{children}</span>,
	h6: ({ children }) => <span className="font-semibold">{children}</span>,
	ul: ({ children }) => <span>{children}</span>,
	ol: ({ children }) => <span>{children}</span>,
	li: ({ children }) => <span>{children} </span>,
	blockquote: ({ children }) => <span>{children}</span>,
	strong: ({ children }) => (
		<strong className="font-semibold">{children}</strong>
	),
	em: ({ children }) => <em className="italic">{children}</em>,
	a: ({ children }) => (
		<span className="underline underline-offset-2">{children}</span>
	),
	hr: () => <span> </span>,
	pre: ({ children }) => <>{children}</>,
	code: ({ children }) => <code className={inlineCodeClass}>{children}</code>,
};

/** No images in either pipeline — a stream is text, not a gallery. */
const disallow = ["img"] as const;

const proseTone = {
	default: "text-foreground",
	danger: "text-destructive-foreground",
} as const;

const lineTone = {
	default: "text-foreground",
	secondary: "text-muted-foreground",
	danger: "text-destructive-foreground",
} as const;

export interface StreamedProseProps {
	readonly text: string;
	readonly tone?: "default" | "danger";
}

/** Block markdown for streamed LLM prose (drawer sections, transcript). */
function StreamedProseRoot({ text, tone = "default" }: StreamedProseProps) {
	return (
		<Streamdown
			className={cn(
				textVariants({ size: "sm" }),
				// The root's own `space-y-4` is the inter-block rhythm; tighten it.
				"[&>*+*]:!mt-[10px]",
				proseTone[tone],
			)}
			components={proseComponents}
			disallowedElements={disallow}
			parseIncompleteMarkdown
		>
			{text}
		</Streamdown>
	);
}

export const StreamedProse = memo(StreamedProseRoot);

export interface StreamedLineProps {
	readonly text: string;
	readonly tone?: "default" | "secondary" | "danger";
}

/** Single-line inline markdown for river/drawer one-liners; truncates. */
function StreamedLineRoot({ text, tone = "default" }: StreamedLineProps) {
	return (
		<Streamdown
			className={cn(
				// Inline + truncate: block children are flattened above, and every
				// descendant is forced inline with no margin so a heading or code
				// fence mid-parse can never break onto a second line or grow the row.
				"inline-block min-w-0 max-w-full truncate align-bottom [&_*]:!m-0 [&_*]:!inline",
				lineTone[tone],
			)}
			components={lineComponents}
			disallowedElements={disallow}
			parseIncompleteMarkdown
		>
			{text}
		</Streamdown>
	);
}

export const StreamedLine = memo(StreamedLineRoot);
