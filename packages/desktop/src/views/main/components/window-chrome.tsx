import {
	createContext,
	use,
	useState,
	useEffect,
	useCallback,
	useMemo,
	type ReactNode,
} from "react";
import { clsx } from "clsx";
import { rpc } from "../context/rpc";

type WindowChromeContext = {
	focused: boolean;
	close: () => void;
	minimize: () => void;
	zoom: () => void;
};

const ChromeContext = createContext<WindowChromeContext | null>(null);

function useChrome() {
	const ctx = use(ChromeContext);
	if (!ctx)
		throw new Error("WindowChrome.* must be used inside WindowChrome.Root");
	return ctx;
}

function Root({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const [focused, setFocused] = useState(true);

	useEffect(() => {
		const onFocus = () => setFocused(true);
		const onBlur = () => setFocused(false);
		window.addEventListener("focus", onFocus);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("blur", onBlur);
		};
	}, []);

	const close = useCallback(() => {
		rpc().request.windowClose({});
	}, []);

	const minimize = useCallback(() => {
		rpc().request.windowMinimize({});
	}, []);

	const zoom = useCallback(() => {
		rpc().request.windowZoom({});
	}, []);

	const chromeValue = useMemo(() => ({ focused, close, minimize, zoom }), [focused, close, minimize, zoom]);
	const shadowStyle = useMemo(
		() => ({
			boxShadow: focused
				? "0 0 0 0.5px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.16), 0 18px 48px rgba(0,0,0,0.1)"
				: "0 0 0 0.5px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.06)",
		}),
		[focused],
	);

	return (
		<ChromeContext value={chromeValue}>
			<div
				className={clsx(
					"flex h-screen flex-col overflow-hidden rounded-[10px] border border-white/[0.08] bg-background transition-shadow duration-200",
					className,
				)}
				style={shadowStyle}
			>
				{children}
			</div>
		</ChromeContext>
	);
}

function Titlebar({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={clsx(
				"electrobun-webkit-app-region-drag grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-3",
				className,
			)}
		>
			{children}
		</div>
	);
}

function Title({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={clsx(
				"electrobun-webkit-app-region-no-drag text-sm font-medium text-foreground/80",
				className,
			)}
		>
			{children}
		</span>
	);
}

function Controls({ className }: { className?: string }) {
	const { focused, close, minimize } = useChrome();
	const [hovered, setHovered] = useState(false);
	const [pressed, setPressed] = useState<"close" | "minimize" | "zoom" | null>(null);

	const handleMouseEnter = useCallback(() => setHovered(true), []);
	const handleMouseLeave = useCallback(() => { setHovered(false); setPressed(null); }, []);
	const handleCloseMouseDown = useCallback(() => setPressed("close"), []);
	const handleMinimizeMouseDown = useCallback(() => setPressed("minimize"), []);
	const handleMouseUp = useCallback(() => setPressed(null), []);
	const isActive = focused || hovered;

	return (
		<div
			className={clsx(
				"electrobun-webkit-app-region-no-drag flex items-center gap-2",
				className,
			)}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			<button
				type="button"
				className="size-3 outline-none"
				onClick={close}
				onMouseDown={handleCloseMouseDown}
				onMouseUp={handleMouseUp}
				aria-label="Close"
			>
				{!isActive ? (
					<svg viewBox="0 0 85.4 85.4" xmlns="http://www.w3.org/2000/svg"><g clipRule="evenodd" fillRule="evenodd"><circle cx="42.7" cy="42.7" r="42.7" fill="#d1d0d2"/><circle cx="42.7" cy="42.7" r="39.1" fill="#c7c7c7"/></g></svg>
				) : !hovered ? (
					<svg viewBox="0 0 85.4 85.4" xmlns="http://www.w3.org/2000/svg"><g clipRule="evenodd" fillRule="evenodd"><circle cx="42.7" cy="42.7" r="42.7" fill="#e24b41"/><circle cx="42.7" cy="42.7" r="39.1" fill="#ed6a5f"/></g></svg>
				) : pressed === "close" ? (
					<svg viewBox="0 0 85.4 85.4" xmlns="http://www.w3.org/2000/svg"><g clipRule="evenodd" fillRule="evenodd"><circle cx="42.7" cy="42.7" r="42.7" fill="#a14239"/><circle cx="42.7" cy="42.7" r="39.1" fill="#b15048"/><g fill="#170101"><path d="m22.5 57.8 35.3-35.3c1.4-1.4 3.6-1.4 5 0l.1.1c1.4 1.4 1.4 3.6 0 5l-35.3 35.3c-1.4 1.4-3.6 1.4-5 0l-.1-.1c-1.4-1.4-1.4-3.7 0-5z"/><path d="m27.5 22.5 35.3 35.3c1.4 1.4 1.4 3.6 0 5l-.1.1c-1.4 1.4-3.6 1.4-5 0l-35.3-35.3c-1.4-1.4-1.4-3.6 0-5l.1-.1c1.4-1.4 3.7-1.4 5 0z"/></g></g></svg>
				) : (
					<svg viewBox="0 0 85.4 85.4" xmlns="http://www.w3.org/2000/svg"><g clipRule="evenodd" fillRule="evenodd"><circle cx="42.7" cy="42.7" r="42.7" fill="#e24b41"/><circle cx="42.7" cy="42.7" r="39.1" fill="#ed6a5f"/><g fill="#460804"><path d="m22.5 57.8 35.3-35.3c1.4-1.4 3.6-1.4 5 0l.1.1c1.4 1.4 1.4 3.6 0 5l-35.3 35.3c-1.4 1.4-3.6 1.4-5 0l-.1-.1c-1.3-1.4-1.3-3.6 0-5z"/><path d="m27.6 22.5 35.3 35.3c1.4 1.4 1.4 3.6 0 5l-.1.1c-1.4 1.4-3.6 1.4-5 0l-35.3-35.3c-1.4-1.4-1.4-3.6 0-5l.1-.1c1.4-1.3 3.6-1.3 5 0z"/></g></g></svg>
				)}
			</button>
			<button
				type="button"
				className="size-3 outline-none"
				onClick={minimize}
				onMouseDown={handleMinimizeMouseDown}
				onMouseUp={handleMouseUp}
				aria-label="Minimize"
			>
				{!isActive ? (
					<svg viewBox="0 0 85.4 85.4" xmlns="http://www.w3.org/2000/svg"><g clipRule="evenodd" fillRule="evenodd"><circle cx="42.7" cy="42.7" r="42.7" fill="#d1d0d2"/><circle cx="42.7" cy="42.7" r="39.1" fill="#c7c7c7"/></g></svg>
				) : !hovered ? (
					<svg viewBox="0 0 85.4 85.4" xmlns="http://www.w3.org/2000/svg"><g clipRule="evenodd" fillRule="evenodd"><circle cx="42.7" cy="42.7" r="42.7" fill="#e1a73e"/><circle cx="42.7" cy="42.7" r="39.1" fill="#f6be50"/></g></svg>
				) : pressed === "minimize" ? (
					<svg viewBox="0 0 85.4 85.4" xmlns="http://www.w3.org/2000/svg"><g clipRule="evenodd" fillRule="evenodd"><circle cx="42.7" cy="42.7" r="42.7" fill="#a67f36"/><circle cx="42.7" cy="42.7" r="39.1" fill="#b8923b"/><path d="m17.7 39.1h49.9c1.9 0 3.5 1.6 3.5 3.5v.1c0 1.9-1.6 3.5-3.5 3.5h-49.9c-1.9 0-3.5-1.6-3.5-3.5v-.1c0-1.9 1.6-3.5 3.5-3.5z" fill="#532a0a"/></g></svg>
				) : (
					<svg viewBox="0 0 85.4 85.4" xmlns="http://www.w3.org/2000/svg"><g clipRule="evenodd" fillRule="evenodd"><circle cx="42.7" cy="42.7" r="42.7" fill="#e1a73e"/><circle cx="42.7" cy="42.7" r="39.1" fill="#f6be50"/><path d="m17.8 39.1h49.9c1.9 0 3.5 1.6 3.5 3.5v.1c0 1.9-1.6 3.5-3.5 3.5h-49.9c-1.9 0-3.5-1.6-3.5-3.5v-.1c0-1.9 1.5-3.5 3.5-3.5z" fill="#90591d"/></g></svg>
				)}
			</button>
			<div className="size-3" aria-label="Zoom" aria-disabled="true">
				<svg viewBox="0 0 85.4 85.4" xmlns="http://www.w3.org/2000/svg"><g clipRule="evenodd" fillRule="evenodd"><circle cx="42.7" cy="42.7" r="42.7" fill="#d1d0d2"/><circle cx="42.7" cy="42.7" r="39.1" fill="#c7c7c7"/></g></svg>
			</div>
		</div>
	);
}

function Content({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={clsx("flex-1 flex flex-col min-h-0", className)}>{children}</div>
	);
}

const WindowChrome = {
	Root,
	Titlebar,
	Controls,
	Title,
	Content,
};

export { WindowChrome };
