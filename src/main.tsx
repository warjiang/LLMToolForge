import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initTheme } from "@/store/theme";
import { installAutocapitalizeGuard } from "@/lib/disable-autocapitalize";
import "./index.css";

initTheme();
installAutocapitalizeGuard();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
