import { useStore } from "@nanostores/react";
import { motion } from "motion/react";
import { $selectedRun } from "../app/runs-store.js";
import {
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
 * The session body: the document (header + river) beside the work detail. The
 * detail is a flowed sibling — opening it animates the column's width so the
 * whole document is pushed left, rather than floating over it. Consumes only the
 * detail open state; the document and the panel own their own contexts.
 */
function SessionSplit() {
	const { state } = useWorkDetail();
	const open = state.open;
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
			<motion.div
				animate={{ width: open ? DETAIL_WIDTH : 0 }}
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

export function SessionMain() {
	const selectedRun = useStore($selectedRun);
	return selectedRun === undefined ? <EmptySelection /> : <SessionDocument />;
}
