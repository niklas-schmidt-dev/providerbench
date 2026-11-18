"use client";

import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, type RefObject, useCallback } from "react";
import { cn } from "@/lib/utils";
import { type FilmCustom, filmVariants } from "./morphic-tooltip-motion";

const FRAME_CLASS =
  "absolute top-1/2 left-1/2 w-max max-w-[min(18rem,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 px-2 py-2 text-center text-xs";

export type MorphicTooltipFilmProps = {
  /** Changes when the surface moves to another trigger. */
  frameKey: string;
  content: ReactNode;
  custom: FilmCustom;
  /** Points at the current label, so the surface can take its size. */
  measureRef: RefObject<HTMLDivElement | null>;
};

/**
 * Each label is its own frame, centered in the surface on its own, so the
 * outgoing one keeps its place while the surface resizes around both.
 */
export function MorphicTooltipFilm({
  frameKey,
  content,
  custom,
  measureRef,
}: MorphicTooltipFilmProps) {
  // An outgoing frame unmounts after the new one has taken the ref, so only
  // ever set it, never clear it.
  const setFrame = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) measureRef.current = node;
    },
    [measureRef],
  );

  return (
    <AnimatePresence initial custom={custom}>
      <motion.div
        key={frameKey}
        ref={setFrame}
        custom={custom}
        variants={filmVariants}
        initial={custom.instant ? false : "enter"}
        animate="center"
        exit="exit"
        className={cn(FRAME_CLASS)}
      >
        {content}
      </motion.div>
    </AnimatePresence>
  );
}
