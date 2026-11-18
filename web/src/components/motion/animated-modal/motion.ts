import type { TargetAndTransition, Transition } from "motion/react";
import { EASE_DRAWER, EASE_IN, EASE_OUT, SPRING_PANEL } from "@/lib/ease";

/*
 * Storyboard
 * - Dialog: the backdrop fades in (200ms) while the panel grows from 94% out
 *   of the point that opened it (the press, or the focused trigger) on the
 *   panel spring. Closing shrinks it back into that point in 150ms.
 * - Sheet (phones): the panel rises from below the screen on the drawer curve
 *   (420ms) and drops back down on close (220ms). Dragging its handle down
 *   far or fast enough closes it; otherwise it settles back.
 * - Reduced motion: no scale or travel, just quick fades.
 */

export const DIALOG_START_SCALE = 0.94;

export const backdropMotion = (reduce: boolean) => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: {
    opacity: 0,
    transition: { duration: reduce ? 0.1 : 0.15, ease: EASE_OUT },
  },
  transition: { duration: reduce ? 0.1 : 0.2, ease: EASE_OUT },
});

type PanelMotion = {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
};

export function panelMotion(reduce: boolean, sheet: boolean): PanelMotion {
  if (reduce) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0, transition: { duration: 0.1, ease: EASE_OUT } },
      transition: { duration: 0.1, ease: EASE_OUT },
    };
  }

  if (sheet) {
    return {
      initial: { y: "110%" },
      animate: { y: 0 },
      exit: { y: "110%", transition: { duration: 0.22, ease: EASE_IN } },
      transition: { y: { duration: 0.42, ease: EASE_DRAWER } },
    };
  }

  return {
    initial: { opacity: 0, scale: DIALOG_START_SCALE },
    animate: { opacity: 1, scale: 1 },
    exit: {
      opacity: 0,
      scale: DIALOG_START_SCALE,
      transition: { duration: 0.15, ease: EASE_OUT },
    },
    transition: SPRING_PANEL,
  };
}

/** A drag this far, or this fast, closes the sheet. */
export const SHEET_CLOSE_OFFSET = 96;
export const SHEET_CLOSE_VELOCITY = 500;
