"use client";

import { animate, type Transition } from "motion/react";
import { type RefObject, useLayoutEffect } from "react";

/**
 * Expand: the panel grows out of the source element's exact box (a video
 * thumbnail, an image, a card) instead of popping in from 94%. Corners are
 * counter-scaled so they read as the panel's own radius the whole way.
 */
export const EXPAND_SPRING: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 34,
  mass: 0.9,
};

type Box = { x: number; y: number; scaleX: number; scaleY: number };

function panelRadius(panel: HTMLElement) {
  // The class radius, not an inline value left by a running tween.
  const inline = panel.style.borderRadius;
  panel.style.borderRadius = "";
  const radius = Number.parseFloat(getComputedStyle(panel).borderTopLeftRadius);
  panel.style.borderRadius = inline;
  return Number.isFinite(radius) ? radius : 0;
}

/**
 * Tweens the corner radius alongside the scale. A plain number written on
 * each frame, because motion leaves `borderRadius` alone on an element it is
 * also driving as a component.
 */
function tweenRadius(panel: HTMLElement, from: number, to: number) {
  return animate(from, to, {
    ...EXPAND_SPRING,
    onUpdate: (value) => {
      panel.style.borderRadius = `${value}px`;
    },
    onComplete: () => {
      panel.style.borderRadius = "";
    },
  });
}

/** The transform that lays the panel over the source element. */
function measure(panel: HTMLElement, source: HTMLElement): Box | null {
  const from = source.getBoundingClientRect();
  // Layout size, without the panel's own transform.
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  if (!width || !height || !from.width || !from.height) return null;
  const rect = panel.getBoundingClientRect();
  return {
    x: from.left + from.width / 2 - (rect.left + rect.width / 2),
    y: from.top + from.height / 2 - (rect.top + rect.height / 2),
    scaleX: from.width / width,
    scaleY: from.height / height,
  };
}

/**
 * The closing target, resolved when closing starts so it finds the source
 * wherever it is now. Starts the matching corner tween as a side effect.
 */
export function collapseToSource(
  panel: HTMLElement | null,
  source: HTMLElement | null | undefined,
): Box | null {
  if (!panel || !source) return null;
  const box = measure(panel, source);
  if (!box) return null;
  const radius = panelRadius(panel);
  tweenRadius(panel, radius, radius / Math.min(box.scaleX, box.scaleY));
  return box;
}

/**
 * Before the first paint, lays the panel over the source and springs it out
 * to its own place and size.
 */
export function useExpandFrom(
  panelRef: RefObject<HTMLElement | null>,
  sourceRef: RefObject<HTMLElement | null> | undefined,
  enabled: boolean,
) {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const source = sourceRef?.current;
    if (!enabled || !panel || !source) return;
    const start = measure(panel, source);
    if (!start) return;
    const radius = panelRadius(panel);
    const startRadius = radius / Math.min(start.scaleX, start.scaleY);
    panel.style.transform = `translateX(${start.x}px) translateY(${start.y}px) scaleX(${start.scaleX}) scaleY(${start.scaleY})`;
    panel.style.borderRadius = `${startRadius}px`;
    const move = animate(
      panel,
      {
        x: [start.x, 0],
        y: [start.y, 0],
        scaleX: [start.scaleX, 1],
        scaleY: [start.scaleY, 1],
      },
      EXPAND_SPRING,
    );
    const corners = tweenRadius(panel, startRadius, radius);
    return () => {
      move.stop();
      corners.stop();
    };
  }, [enabled, panelRef, sourceRef]);
}
