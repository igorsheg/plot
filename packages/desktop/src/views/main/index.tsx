import { createRoot } from "react-dom/client";

function App() {
	return (
		<div style={{ padding: 24 }}>
			<h1>Plot Desktop</h1>
			<p>Select a project to get started.</p>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(<App />);
