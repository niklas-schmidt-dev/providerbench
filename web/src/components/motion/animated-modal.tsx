"use client";

import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import {
  AnimatePresence,
  motion,
  useDragControls,
  useReducedMotion,
} from "motion/react";
import { type ReactNode, type RefObject, useMemo, useRef } from "react";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";
import {
  backdropMotion,
  DIALOG_START_SCALE,
  panelMotion,
  SHEET_CLOSE_OFFSET,
  SHEET_CLOSE_VELOCITY,
} from "./animated-modal/motion";
import { AnimatedModalContext } from "./animated-modal/parts";
import {
  collapseToSource,
  EXPAND_SPRING,
  useExpandFrom,
} from "./animated-modal/use-expand-from";
import { useOpenOrigin } from "./animated-modal/use-open-origin";

export {
  AnimatedModalBody,
  AnimatedModalClose,
  type AnimatedModalCloseProps,
  AnimatedModalFooter,
  AnimatedModalHeader,
  type AnimatedModalHeaderProps,
} from "./animated-modal/parts";

const MotionBackdrop = motion.create(DialogBackdrop);
const MotionPanel = motion.create(DialogPanel);

export type AnimatedModalSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<AnimatedModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export type AnimatedModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs after the closing animation completes. */
  onExitComplete?: () => void;
  children: ReactNode;
  /** Panel width. `panelClassName` still wins. Default `md`. */
  size?: AnimatedModalSize;
  /**
   * On phones, rise from the bottom as a sheet that drags down to close.
   * Turn off for drawers and full-screen panels with their own layout.
   */
  mobileSheet?: boolean;
  /**
   * Grow the panel out of this element's exact box and shrink it back into
   * it on close, for media that opens in place (a video, an image). Used
   * instead of the sheet on phones. Give the panel the same shape as the
   * element so the content does not stretch.
   */
  expandFrom?: RefObject<HTMLElement | null>;
  className?: string;
  backdropClassName?: string;
  viewportClassName?: string;
  panelClassName?: string;
};

export function AnimatedModal({
  open,
  onOpenChange,
  onExitComplete,
  className,
  ...rest
}: AnimatedModalProps) {
  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {open ? (
        <Dialog
          key="animated-modal"
          open
          onClose={() => onOpenChange(false)}
          className={cn("relative z-[100]", className)}
        >
          <ModalLayers onClose={() => onOpenChange(false)} {...rest} />
        </Dialog>
      ) : null}
    </AnimatePresence>
  );
}

type ModalLayersProps = Omit<
  AnimatedModalProps,
  "open" | "onOpenChange" | "onExitComplete" | "className"
> & { onClose: () => void };

/** Mounted only while open, so it can measure and set up the panel. */
function ModalLayers({
  onClose,
  children,
  size = "md",
  mobileSheet = true,
  expandFrom,
  backdropClassName,
  viewportClassName,
  panelClassName,
}: ModalLayersProps) {
  const reduce = Boolean(useReducedMotion());
  const phone = useMediaQuery("(max-width: 639.98px)");
  const sheet = mobileSheet && phone && !expandFrom;
  const expand = Boolean(expandFrom) && !reduce;
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useDragControls();
  const context = useMemo(() => ({ close: onClose }), [onClose]);

  useOpenOrigin(panelRef, {
    enabled: !reduce && !sheet && !expand,
    startScale: DIALOG_START_SCALE,
  });
  useExpandFrom(panelRef, expandFrom, expand);

  const motionProps = expand
    ? {
        initial: false as const,
        variants: {
          // Resolved when closing starts, so it finds the element wherever
          // it is now; falls back to a fade if it is gone.
          collapse: () =>
            collapseToSource(panelRef.current, expandFrom?.current) ?? {
              opacity: 0,
            },
        },
        exit: "collapse",
        transition: EXPAND_SPRING,
      }
    : panelMotion(reduce, sheet);

  return (
    <AnimatedModalContext.Provider value={context}>
      <MotionBackdrop
        {...backdropMotion(reduce)}
        className={cn(
          "fixed inset-0 bg-foreground/15 backdrop-blur-sm",
          backdropClassName,
        )}
      />

      <div
        className={cn(
          // Inset from every edge rather than padded: iOS 26 Safari samples a
          // transparent fixed layer that touches the viewport edges to tint
          // its toolbar, which blocks the main thread while the panel
          // animates. Override the margin with inset-*, not p-*.
          "fixed inset-4 z-[101] overflow-x-hidden overflow-y-auto",
          viewportClassName,
        )}
      >
        <div
          className={cn(
            "flex min-h-full justify-center",
            sheet ? "items-end" : "items-center",
          )}
        >
          <MotionPanel
            ref={panelRef}
            {...motionProps}
            drag={sheet ? "y" : false}
            dragListener={false}
            dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 1 }}
            onDragEnd={(_, info) => {
              if (
                info.offset.y > SHEET_CLOSE_OFFSET ||
                info.velocity.y > SHEET_CLOSE_VELOCITY
              ) {
                onClose();
              }
            }}
            className={cn(
              "relative max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-2xl border border-border bg-background text-foreground will-change-transform",
              SIZE_CLASS[size],
              panelClassName,
            )}
          >
            {sheet ? (
              <div
                aria-hidden="true"
                onPointerDown={(event) => drag.start(event)}
                className="absolute top-0 left-1/2 z-10 flex h-6 w-24 -translate-x-1/2 cursor-grab touch-none justify-center pt-2 active:cursor-grabbing"
              >
                <span className="h-1 w-10 rounded-full bg-muted-foreground/30" />
              </div>
            ) : null}
            {children}
          </MotionPanel>
        </div>
      </div>
    </AnimatedModalContext.Provider>
  );
}

export const AnimatedModalTitle = DialogTitle;
export const AnimatedModalDescription = DialogDescription;
