"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect } from "react";

const STORAGE_KEY = "theme";

/** Runs before first paint (inlined in <head>) so the page never flashes the wrong theme. */
export const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("${STORAGE_KEY}");var d=s?s==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

function apply(dark: boolean) {
  // Freeze transitions for one frame so every surface swaps at once instead
  // of each component fading on its own timing.
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(style);
  document.documentElement.classList.toggle("dark", dark);
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
}

export function ThemeToggle() {
  // Follow the system until the visitor picks a theme explicitly.
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return;
      } catch {}
      apply(media.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return (
    <button
      type="button"
      aria-label="Toggle dark mode"
      onClick={() => {
        const dark = !document.documentElement.classList.contains("dark");
        apply(dark);
        try {
          localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
        } catch {}
      }}
      className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    >
      <Sun aria-hidden className="hidden size-4 dark:block" />
      <Moon aria-hidden className="block size-4 dark:hidden" />
    </button>
  );
}
