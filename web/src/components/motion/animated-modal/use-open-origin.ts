"use client";

import { type RefObject, useLayoutEffect } from "react";

/** A press this recent is what opened the modal. */
const PRESS_WINDOW_MS = 800;

let lastPress: { x: number; y: number; at: number } | null = null;

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (event) => {
      lastPress = { x: event.clientX, y: event.clientY, at: performance.now() };
    },
    { capture: true, passive: true },
  );
}

/** Where the modal was opened from: the press, else the focused trigger. */
function openPoint(): { x: number; y: number } | null {
  if (lastPress && performance.now() - lastPress.at < PRESS_WINDOW_MS) {
    return lastPress;
  }
  const trigger = document.activeElement;
  if (!(trigger instanceof HTMLElement) || trigger === document.body) {
    return null;
  }
  const rect = trigger.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Points the panel's transform origin at whatever opened it, before the first
 * frame, so it grows out of the trigger and shrinks back into it on close.
 * The panel is still at its starting scale here, so its layout box is
 * recovered from the rect around its centre.
 */
export function useOpenOrigin(
  panelRef: RefObject<HTMLElement | null>,
  { enabled, startScale }: { enabled: boolean; startScale: number },
) {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!enabled || !panel) return;
    const point = openPoint();
    if (!point) return;
    const rect = panel.getBoundingClientRect();
    const width = rect.width / startScale;
    const height = rect.height / startScale;
    const left = rect.left + rect.width / 2 - width / 2;
    const top = rect.top + rect.height / 2 - height / 2;
    panel.style.transformOrigin = `${point.x - left}px ${point.y - top}px`;
  }, [enabled, panelRef, startScale]);
}
