import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AnalyzerClient } from "./api/worker-client";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App client={new AnalyzerClient()} />
  </React.StrictMode>
);
