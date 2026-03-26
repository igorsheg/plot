import {
	createContext,
	use,
	useState,
	useEffect,
	useCallback,
	type ReactNode,
} from "react";
import { electroview } from "../index";

const rpc = () => electroview.rpc!;

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

	return (
		<ChromeContext value={{ focused, close, minimize, zoom }}>
			<div className={`overflow-hidden rounded-[10px] border border-white/[0.08] ${className ?? ""}`}>
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
			className={`electrobun-webkit-app-region-drag flex shrink-0 items-center ${className ?? ""}`}
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
			className={`electrobun-webkit-app-region-no-drag text-label font-medium text-foreground/80 ${className ?? ""}`}
		>
			{children}
		</span>
	);
}

function Controls({ className }: { className?: string }) {
	const { focused, close, minimize, zoom } = useChrome();
	const [hovered, setHovered] = useState(false);
	const [pressed, setPressed] = useState<"close" | "minimize" | "zoom" | null>(null);

	const isActive = focused || hovered;

	return (
		<div
			className={`electrobun-webkit-app-region-no-drag flex items-center gap-2 ${className ?? ""}`}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => { setHovered(false); setPressed(null); }}
		>
			<button
				type="button"
				className="size-3 outline-none"
				onClick={close}
				onMouseDown={() => setPressed("close")}
				onMouseUp={() => setPressed(null)}
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
				onMouseDown={() => setPressed("minimize")}
				onMouseUp={() => setPressed(null)}
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
			<button
				type="button"
				className="size-3 outline-none"
				onClick={zoom}
				onMouseDown={() => setPressed("zoom")}
				onMouseUp={() => setPressed(null)}
				aria-label="Zoom"
			>
				{!isActive ? (
					<svg viewBox="0 0 85.4 85.4" xmlns="http://www.w3.org/2000/svg"><g clipRule="evenodd" fillRule="evenodd"><circle cx="42.7" cy="42.7" r="42.7" fill="#d1d0d2"/><circle cx="42.7" cy="42.7" r="39.1" fill="#c7c7c7"/></g></svg>
				) : !hovered ? (
					<svg viewBox="0 0 85.4 85.4" xmlns="http://www.w3.org/2000/svg"><g clipRule="evenodd" fillRule="evenodd"><circle cx="42.7" cy="42.7" r="42.7" fill="#2dac2f"/><circle cx="42.7" cy="42.7" r="39.1" fill="#61c555"/></g></svg>
				) : pressed === "zoom" ? (
					<svg viewBox="0 0 85.4 85.4" xmlns="http://www.w3.org/2000/svg"><g clipRule="evenodd" fillRule="evenodd"><circle cx="42.7" cy="42.7" r="42.7" fill="#428234"/><circle cx="42.7" cy="42.7" r="39.1" fill="#4a9741"/><path d="m31.2 20.8h26.7c3.6 0 6.5 2.9 6.5 6.5v26.7zm23.2 43.7h-26.8c-3.6 0-6.5-2.9-6.5-6.5v-26.8z" fill="#113107"/></g></svg>
				) : (
					<svg viewBox="0 0 85.4 85.4" xmlns="http://www.w3.org/2000/svg"><g clipRule="evenodd" fillRule="evenodd"><circle cx="42.7" cy="42.7" r="42.7" fill="#2dac2f"/><circle cx="42.7" cy="42.7" r="39.1" fill="#61c555"/><path d="m31.2 20.8h26.7c3.6 0 6.5 2.9 6.5 6.5v26.7zm23.2 43.7h-26.8c-3.6 0-6.5-2.9-6.5-6.5v-26.8z" fill="#2a6218"/></g></svg>
				)}
			</button>
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
		<div className={`flex-1 overflow-auto ${className ?? ""}`}>{children}</div>
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
