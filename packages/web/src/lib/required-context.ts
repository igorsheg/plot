import { createContext, createElement, type ReactNode, use } from "react";

export interface RequiredContextProviderProps<T> {
	readonly value: T;
	readonly children: ReactNode;
}

export const createRequiredContext = <T>(message: string) => {
	const Context = createContext<T | null>(null);
	const Provider = ({ value, children }: RequiredContextProviderProps<T>) =>
		createElement(Context, { value }, children);
	const useRequiredContext = (): T => {
		const context = use(Context);
		if (context === null) throw new Error(message);
		return context;
	};
	return [Provider, useRequiredContext] as const;
};
