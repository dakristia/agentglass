import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { applyTheme, initialTheme } from "./lib/themes.ts";
import "./index.css";

applyTheme(initialTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
