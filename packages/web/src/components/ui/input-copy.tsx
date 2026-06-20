import { forwardRef, useState, useCallback, useRef, useEffect } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

// A read-only value with a copy-to-clipboard action. The plain variant is a
// mono row with an icon swap (Copy → Check) on copy; the button variant shows
// a labelled action. Intentionally minimal — no tooltip state machine.
interface InputCopyProps {
	value: string;
	label?: string;
	onCopy?: () => void;
	disabled?: boolean;
	align?: "right" | "left";
	className?: string;
}

const InputCopy = forwardRef<HTMLDivElement, InputCopyProps>(
	({ value, label, onCopy, disabled, align = "right", className }, ref) => {
		const [copied, setCopied] = useState(false);
		const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

		const handleCopy = useCallback(async () => {
			if (disabled) return;
			try {
				await navigator.clipboard.writeText(value);
				setCopied(true);
				onCopy?.();
				if (timeoutRef.current) clearTimeout(timeoutRef.current);
				timeoutRef.current = setTimeout(() => setCopied(false), 2000);
			} catch {
				// Clipboard API not available — silently fail.
			}
		}, [value, disabled, onCopy]);

		useEffect(() => {
			return () => {
				if (timeoutRef.current) clearTimeout(timeoutRef.current);
			};
		}, []);

		const Icon = copied ? Check : Copy;

		return (
			<div
				ref={ref}
				className={cn(
					"flex flex-col gap-1",
					disabled && "opacity-50 pointer-events-none",
					className,
				)}
			>
				{label ? (
					<span className="text-sm text-muted-foreground">{label}</span>
				) : null}
				<button
					type="button"
					onClick={handleCopy}
					disabled={disabled}
					aria-label={copied ? "Copied" : "Copy to clipboard"}
					title={copied ? "Copied" : "Copy to clipboard"}
					className={cn(
						"group flex w-full items-center gap-2 rounded-md border border-border bg-card px-2 py-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
					)}
				>
					{align === "left" ? (
						<>
							<Icon size={14} className="shrink-0 text-muted-foreground" />
							<span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
								{value}
							</span>
						</>
					) : (
						<>
							<span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
								{value}
							</span>
							<Icon
								size={14}
								className={cn(
									"shrink-0",
									copied ? "text-foreground" : "text-muted-foreground",
								)}
							/>
						</>
					)}
				</button>
			</div>
		);
	},
);

InputCopy.displayName = "InputCopy";

export { InputCopy };
export type { InputCopyProps };
