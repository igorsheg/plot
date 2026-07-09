/**
 * Generic work-detail context. The drawer consumes only `useWorkDetail()` and
 * never imports app stores; test fixtures and the store adapter both flow through
 * this one interface. Mirrors `context.ts`'s shape and `use()` pattern.
 */

import type { OperatorObservationInput } from "@plot/session/runtime";
import { createContext, createElement, type ReactNode, use } from "react";
import type { DetailRef, DetailView } from "./detail-view-model.js";

export interface WorkDetailState {
	readonly view: DetailView | undefined;
	readonly open: boolean;
	readonly nowMs: number;
}

export interface WorkDetailActions {
	readonly open: (ref: DetailRef) => void;
	readonly close: () => void;
	readonly step: (direction: 1 | -1) => void;
	readonly act: (input: Omit<OperatorObservationInput, "actor">) => void;
	readonly acting: boolean;
}

export interface WorkDetailContextValue {
	readonly state: WorkDetailState;
	readonly actions: WorkDetailActions;
}

const WorkDetailContext = createContext<WorkDetailContextValue | null>(null);

interface WorkDetailProviderProps {
	readonly value: WorkDetailContextValue;
	readonly children: ReactNode;
}

export function WorkDetailProvider({
	value,
	children,
}: WorkDetailProviderProps) {
	return createElement(WorkDetailContext, { value }, children);
}

export function useWorkDetail(): WorkDetailContextValue {
	const context = use(WorkDetailContext);
	if (context === null) {
		throw new Error(
			"Work-detail components must be rendered inside <WorkDetailProvider>.",
		);
	}
	return context;
}
