import type { Transition, Variants } from "motion/react";
import { EASE_IN, EASE_OUT } from "@/lib/ease";
import { isVerticalSide, type TooltipSide } from "./morphic-tooltip-position";

/*
 * Storyboard
 * - First open: the layer fades in (150ms) while the label rises 5px toward
 *   its trigger and the shell settles from 96% (200ms ease-out).
 * - Moving to a neighbour: the surface glides to the new trigger and takes the
 *   new label's width in one 340ms ease-out, and the labels run through it like
 *   film: the old one slides out the far side as the new one slides in from
 *   the side the pointer came from. The surface clips both.
 * - Close: the layer fades out (150ms).
 * - Keyboard focus and reduced motion: every change is instant.
 */

const INSTANT: Transition = { duration: 0 };

/** Glide, resize, and film share one curve so they land together. */
export const GLIDE: Transition = { duration: 0.34, ease: EASE_OUT };

const REVEAL: Transition = { duration: 0.2, ease: EASE_OUT };

export const layerTransition = (instant: boolean, morphing: boolean) =>
  instant
    ? INSTANT
    : {
        opacity: { duration: 0.15, ease: EASE_OUT },
        x: morphing ? GLIDE : INSTANT,
        y: morphing ? GLIDE : INSTANT,
      };

export const shellTransition = (instant: boolean, morphing: boolean) =>
  instant ? INSTANT : morphing ? GLIDE : REVEAL;

export function shellInitial(side: TooltipSide) {
  return isVerticalSide(side)
    ? { scaleX: 0.96, scaleY: 0.92 }
    : { scaleX: 0.92, scaleY: 0.96 };
}

function revealOffset(side: TooltipSide, distance: number) {
  switch (side) {
    case "bottom":
      return { x: 0, y: -distance };
    case "left":
      return { x: distance, y: 0 };
    case "right":
      return { x: -distance, y: 0 };
    default:
      return { x: 0, y: distance };
  }
}

export type FilmCustom = {
  /** +1 when the surface moves right (or down), -1 when it moves back. */
  direction: 1 | -1;
  side: TooltipSide;
  morphing: boolean;
  instant: boolean;
};

/** Where a label sits off the strip, along the axis the surface travels. */
function offStrip({ direction, side }: FilmCustom, sign: 1 | -1) {
  const travel = `${direction * sign * 100}%`;
  return isVerticalSide(side) ? { x: travel, y: 0 } : { x: 0, y: travel };
}

export const filmVariants: Variants = {
  enter: (c: FilmCustom) =>
    c.morphing
      ? { opacity: 0, filter: "blur(2px)", ...offStrip(c, 1) }
      : { opacity: 0, filter: "blur(0px)", ...revealOffset(c.side, 5) },
  center: (c: FilmCustom) => ({
    opacity: 1,
    x: 0,
    y: 0,
    filter: "blur(0px)",
    transition: c.instant
      ? INSTANT
      : c.morphing
        ? { ...GLIDE, opacity: { duration: 0.2, ease: EASE_OUT } }
        : REVEAL,
    transitionEnd: { filter: "none" },
  }),
  exit: (c: FilmCustom) =>
    c.instant
      ? { opacity: 0, transition: INSTANT }
      : {
          opacity: 0,
          filter: "blur(2px)",
          ...offStrip(c, -1),
          transition: { ...GLIDE, opacity: { duration: 0.2, ease: EASE_IN } },
        },
};
