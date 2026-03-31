import path from "node:path";
import os from "node:os";

export const CONFIG_DIR = path.join(os.homedir(), ".plot", "desktop");
export const PROJECTS_FILE = path.join(CONFIG_DIR, "projects.json");
export const DEV_VIEW_PORT = 5174;
