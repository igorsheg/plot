import { useEffect, useState } from "react";

export const useHeartbeat = () => {
	const [, setBeat] = useState(0);
	useEffect(() => {
		const interval = setInterval(() => setBeat((beat) => beat + 1), 5000);
		return () => clearInterval(interval);
	}, []);
};
