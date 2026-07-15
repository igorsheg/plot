import { motion, useReducedMotion } from "motion/react";
import { Text } from "../ui/text.js";
import {
	sparklineBucketClass,
	sparklineClass,
	sparklineRootClass,
} from "./styles.js";
import { SPARK_CHARS } from "./throughput.js";

const transition = {
	duration: 0.34,
	ease: [0.22, 1, 0.36, 1],
} as const;

const minBucketHeight = 4;
const maxBucketHeight = 22;

const heightForGlyph = (glyph: string): number => {
	const level = Math.max(0, SPARK_CHARS.indexOf(glyph));
	const ratio = level / Math.max(1, SPARK_CHARS.length - 1);
	return minBucketHeight + ratio * (maxBucketHeight - minBucketHeight);
};

export function ThroughputSparkline({
	graph,
	height = "default",
}: {
	readonly graph: string;
	readonly height?: "default" | "control-sm";
}) {
	const reducedMotion = useReducedMotion();
	return (
		<span
			className={sparklineRootClass()}
			title="token throughput over the last 60 seconds"
		>
			<span aria-hidden="true" className={sparklineClass({ height })}>
				{Array.from(graph).map((glyph, index) => (
					<motion.span
						key={index}
						className={sparklineBucketClass()}
						initial={false}
						animate={{ height: heightForGlyph(glyph), opacity: 1 }}
						transition={reducedMotion ? { duration: 0 } : transition}
					/>
				))}
			</span>
			<Text as="span" size="sm" variant="secondary">
				<span className="sr-only">
					token throughput over the last 60 seconds: {graph}
				</span>
			</Text>
		</span>
	);
}
