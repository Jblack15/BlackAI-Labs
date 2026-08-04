// Inline theme script - prevents FOUC, runs before paint.
// This is injected as a blocking <script> in <head>.
// The full toggle logic lives in ThemeToggle.astro.

const STORAGE_KEY = "fleetclaim-theme";

function getInitialTheme(): "light" | "dark" {
  // 1. Check localStorage for explicit preference
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // localStorage unavailable
  }

  // 2. Respect OS preference
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

// Apply immediately to prevent flash
const theme = getInitialTheme();
applyTheme(theme);

// Expose for components
window.__fleetclaimTheme = theme;
