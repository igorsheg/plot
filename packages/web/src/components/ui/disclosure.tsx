import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
	createContext,
	type ComponentPropsWithoutRef,
	type ReactNode,
	use,
	useId,
	useMemo,
	useState,
} from "react";

import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

// Disclosure as a provider + parts. State lives in the provider (the only owner)
// and is exposed through a generic { state, actions } interface; Trigger and
// Panel — and any sibling — read it via context, never via drilled props
// (composition-patterns: state-lift-state, state-context-interface).
interface DisclosureContextValue {
	state: { open: boolean; panelId: string };
	actions: { toggle: () => void };
}

const DisclosureContext = createContext<DisclosureContextValue | null>(null);

function useDisclosure() {
	const ctx = use(DisclosureContext);
	if (!ctx) {
		throw new Error("Disclosure parts must be used within <Disclosure>");
	}
	return ctx;
}

function DisclosureRoot({
	children,
	defaultOpen = false,
}: {
	children: ReactNode;
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const panelId = useId();
	const value = useMemo<DisclosureContextValue>(
		() => ({
			state: { open, panelId },
			actions: { toggle: () => setOpen((prev) => !prev) },
		}),
		[open, panelId],
	);
	return <DisclosureContext value={value}>{children}</DisclosureContext>;
}

function DisclosureTrigger({
	children,
	className,
	...props
}: ComponentPropsWithoutRef<"button">) {
	const { state, actions } = useDisclosure();
	return (
		<button
			type="button"
			aria-expanded={state.open}
			aria-controls={state.panelId}
			onClick={actions.toggle}
			className={cn(
				"flex w-full items-center justify-between gap-2 rounded-lg py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#6B97FF]",
				className,
			)}
			{...props}
		>
			{children}
			<motion.span
				className="inline-flex shrink-0 items-center"
				animate={{ rotate: state.open ? 90 : 0 }}
				transition={spring.fast}
			>
				<ChevronRight size={16} strokeWidth={1.5} />
			</motion.span>
		</button>
	);
}

function DisclosurePanel({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const { state } = useDisclosure();
	return (
		<AnimatePresence initial={false}>
			{state.open ? (
				<motion.div
					id={state.panelId}
					className={cn("overflow-hidden", className)}
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: "auto", opacity: 1 }}
					exit={{ height: 0, opacity: 0 }}
					transition={{ ...spring.moderate, bounce: 0 }}
				>
					{children}
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}

export const Disclosure = Object.assign(DisclosureRoot, {
	Trigger: DisclosureTrigger,
	Panel: DisclosurePanel,
});
