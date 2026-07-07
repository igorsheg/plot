import { atom, onMount } from "nanostores";

export const $nowMs = atom<number>(Date.now());

onMount($nowMs, () => {
	const id = setInterval(() => $nowMs.set(Date.now()), 1000);
	return () => clearInterval(id);
});
