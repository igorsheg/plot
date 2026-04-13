import "./app.css";
import { createRoot } from "react-dom/client";
import { initRpc } from "./context/rpc";
import { App } from "./app";

initRpc();

createRoot(document.getElementById("root")!).render(<App />);
