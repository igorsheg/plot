import { motion, type MotionStyle, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import { Text } from "../ui/text.js";
import { SPARK_CHARS } from "./throughput.js";

const transition = {
	duration: 0.34,
	ease: [0.22, 1, 0.36, 1],
} as const;

const minBucketHeight = 4;
const maxBucketHeight = 22;

const sparklineStyle: CSSProperties = {
	display: "inline-flex",
	alignItems: "flex-end",
	gap: 1,
	height: 40,
	verticalAlign: "middle",
};

const bucketStyle: MotionStyle = {
	background: "currentColor",
	display: "inline-block",
	width: 5,
	willChange: "height, opacity",
};

const heightForGlyph = (glyph: string): number => {
	const level = Math.max(0, SPARK_CHARS.indexOf(glyph));
	const ratio = level / Math.max(1, SPARK_CHARS.length - 1);
	return minBucketHeight + ratio * (maxBucketHeight - minBucketHeight);
};

export function ThroughputSparkline({ graph }: { readonly graph: string }) {
	const reducedMotion = useReducedMotion();
	return (
		<Text
			as="span"
			variant="mono-secondary"
			DANGEROUS_style={{ lineHeight: "40px", whiteSpace: "nowrap" }}
			title="token throughput over the last 60 seconds"
		>
			<span aria-hidden="true" style={sparklineStyle}>
				{Array.from(graph).map((glyph, index) => (
					<motion.span
						key={index}
						initial={false}
						animate={{ height: heightForGlyph(glyph), opacity: 1 }}
						transition={reducedMotion ? { duration: 0 } : transition}
						style={bucketStyle}
					/>
				))}
			</span>
			<span className="sr-only">
				token throughput over the last 60 seconds: {graph}
			</span>
		</Text>
	);
}
