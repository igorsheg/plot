import { useStore } from "@nanostores/react";
import { useEffect } from "react";
import { toastManager } from "../components/ui/toast.js";
import { $applicationError } from "./error-store.js";

export function RuntimeErrorToaster() {
	const error = useStore($applicationError);

	useEffect(() => {
		if (error === undefined) return;
		toastManager.add({
			description: error,
			id: "runtime-error",
			title: "Error",
			type: "error",
		});
	}, [error]);

	return null;
}
