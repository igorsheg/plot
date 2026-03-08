import { AnimatePresence, motion } from "motion/react";

const spring = { type: "spring" as const, bounce: 0.15, duration: 0.4 };
const enter = { y: 6, opacity: 0, filter: "blur(3px)" };
const visible = { y: 0, opacity: 1, filter: "blur(0px)" };
const leave = { y: -6, opacity: 0, filter: "blur(3px)" };

export function PhaseLabel({ label }: { label: string }) {
	return (
		<span className="relative inline-flex overflow-hidden">
			<AnimatePresence mode="popLayout" initial={false}>
				<motion.span
					key={label}
					initial={enter}
					animate={visible}
					exit={leave}
					transition={spring}
					className="inline-block"
				>
					{label}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}
