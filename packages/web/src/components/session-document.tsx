import { useStore } from "@nanostores/react";
import { motion } from "motion/react";
import { $selectedSession } from "../app/sessions-store.js";
import {
	sessionBoardMainClass,
	sessionDetailClass,
	sessionDetailInnerClass,
	sessionDocumentClass,
	sessionMainClass,
	sessionSplitClass,
} from "./session-document.styles.js";
import {
	SessionHeader,
	StoreSessionHeaderProvider,
} from "./session-header/session-header.js";
import { useWorkDetail } from "./session-work/detail-context.js";
import { SessionBoard } from "./session-work/session-board.js";
import {
	SessionWork,
	StoreSessionWorkProvider,
} from "./session-work/session-work.js";
import { WorkDetail } from "./session-work/work-detail.js";
import { ScrollArea } from "./ui/scroll-area.js";
import { VStack } from "./ui/stack.js";
import { Text } from "./ui/text.js";

const DETAIL_WIDTH = 420;
const DETAIL_EASE = [0.32, 0.72, 0, 1] as const;

function EmptySelection() {
	return (
		<VStack as="main" className={sessionMainClass()}>
			<ScrollArea scrollFade scrollbarGutter>
				<div className="min-h-full px-[var(--plot-space-8)] pt-[var(--plot-page-top)] pb-[var(--plot-page-bottom)]">
					<VStack
						as="article"
						className={sessionDocumentClass({ state: "empty" })}
						gap={12}
						justify="center"
					>
						<Text as="h1" variant="heading1">
							No active sessions.
						</Text>
						<Text variant="secondary">
							The dock only shows live sessions. Start one and it will appear
							here.
						</Text>
					</VStack>
				</div>
			</ScrollArea>
		</VStack>
	);
}

/**
 * Shared flowed detail sibling. Opening it animates the column width so either
 * work surface is pushed left rather than covered by a floating sheet.
 */
function DetailColumn() {
	const { state } = useWorkDetail();
	return (
		<motion.div
			animate={{ width: state.open ? DETAIL_WIDTH : 0 }}
			className={sessionDetailClass()}
			initial={false}
			transition={{ duration: 0.5, ease: DETAIL_EASE }}
		>
			<div
				className={sessionDetailInnerClass()}
				style={{ width: DETAIL_WIDTH }}
			>
				<WorkDetail />
			</div>
		</motion.div>
	);
}

/** Production river: the existing document header and work stream. */
function SessionSplit() {
	return (
		<div className={sessionSplitClass()}>
			<VStack as="main" className={sessionMainClass()}>
				<ScrollArea scrollFade scrollbarGutter>
					<div className="min-h-full px-[var(--plot-space-8)] pt-[var(--plot-page-top)] pb-[var(--plot-page-bottom)]">
						<VStack as="article" className={sessionDocumentClass()} gap={48}>
							<StoreSessionHeaderProvider>
								<SessionHeader />
							</StoreSessionHeaderProvider>
							<SessionWork />
						</VStack>
					</div>
				</ScrollArea>
			</VStack>
			<DetailColumn />
		</div>
	);
}

/** Board body only; the app shell composes SessionNav above it. */
function SessionBoardSplit() {
	return (
		<div className={sessionSplitClass()}>
			<VStack as="main" className={sessionBoardMainClass()}>
				<ScrollArea scrollFade scrollbarGutter>
					<div className="min-h-full px-[var(--plot-space-6)] pt-[var(--plot-space-6)] pb-[var(--plot-page-bottom)]">
						<SessionBoard />
					</div>
				</ScrollArea>
			</VStack>
			<DetailColumn />
		</div>
	);
}

function SessionDocument() {
	return (
		<StoreSessionWorkProvider>
			<SessionSplit />
		</StoreSessionWorkProvider>
	);
}

export function SessionBoardMain() {
	return (
		<StoreSessionWorkProvider>
			<SessionBoardSplit />
		</StoreSessionWorkProvider>
	);
}

export function SessionMain() {
	const selectedSession = useStore($selectedSession);
	return selectedSession === undefined ? (
		<EmptySelection />
	) : (
		<SessionDocument />
	);
}
