import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BackgroundThemeProvider } from "./theme/BackgroundThemeContext";
import { applyBackgroundTheme, readStoredBackgroundTheme } from "./theme/backgroundTheme";
import "./theme/theme.css";
import "./reset.css";

applyBackgroundTheme(readStoredBackgroundTheme());

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <BackgroundThemeProvider>
      <App />
    </BackgroundThemeProvider>
  </StrictMode>
);
