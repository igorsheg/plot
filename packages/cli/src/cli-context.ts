import { processCliIo, type PlotCliIo } from "./io.js";

let currentIo: PlotCliIo = processCliIo();

export const setCliIo = (io: PlotCliIo) => {
	currentIo = io;
};

export const getCliIo = () => currentIo;
