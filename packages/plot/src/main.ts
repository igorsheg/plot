import { runServerMain } from "./index.js";

await runServerMain(process.env as Record<string, string | undefined>);
