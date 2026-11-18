"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  createContext,
  type FocusEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { MorphicTooltipFilm } from "./morphic-tooltip-film";
import {
  layerTransition,
  shellInitial,
  shellTransition,
} from "./morphic-tooltip-motion";
import {
  arrowClass,
  getArrowStyle,
  getTooltipPosition,
  getTooltipSize,
  layerOffset,
  type MorphicTooltipPlacement,
  type TooltipPosition,
  type TooltipSize,
  transformOrigin,
  travelDirection,
} from "./morphic-tooltip-position";

export type { MorphicTooltipPlacement };

export type MorphicTooltipProviderProps = {
  children: ReactNode;
  delay?: number;
  closeDelay?: number;
  className?: string;
};

export type MorphicTooltipProps = MorphicTooltipPlacement & {
  content: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  showArrow?: boolean;
  className?: string;
  contentClassName?: string;
};

type ActiveTooltip = Required<MorphicTooltipPlacement> & {
  id: string;
  content: ReactNode;
  trigger: HTMLElement;
  showArrow: boolean;
  morphing: boolean;
  /** Which way the surface travelled to reach this trigger. */
  direction: 1 | -1;
  interaction: "focus" | "pointer";
  contentClassName?: string;
};

type MorphicTooltipContextValue = {
  open: (
    tooltip: Omit<
      ActiveTooltip,
      "trigger" | "morphing" | "direction" | "interaction"
    >,
    trigger: HTMLElement,
    interaction: ActiveTooltip["interaction"],
  ) => void;
  close: (id: string) => void;
  updateContent: (id: string, content: ReactNode) => void;
};

const MorphicTooltipContext = createContext<MorphicTooltipContextValue | null>(
  null,
);

const TOOLTIP_WARM_WINDOW = 240;

const SURFACE_CLASS =
  "relative overflow-hidden rounded-xl border border-background/15 bg-foreground text-background";

export function MorphicTooltipProvider({
  children,
  delay = 90,
  closeDelay = 80,
  className,
}: MorphicTooltipProviderProps) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const [surfaceSize, setSurfaceSize] = useState<TooltipSize | null>(null);
  const activeRef = useRef<ActiveTooltip | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef<TooltipSize | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const pendingOpenRef = useRef<{ id: string; content: ReactNode } | null>(
    null,
  );
  const closeTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastCloseAtRef = useRef(0);

  const clearOpenTimer = useCallback(() => {
    pendingOpenRef.current = null;
    if (openTimerRef.current === null) return;
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const clearFrame = useCallback(() => {
    if (frameRef.current === null) return;
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const updatePosition = useCallback((tooltip: ActiveTooltip) => {
    setPosition(
      getTooltipPosition(
        tooltip.trigger.getBoundingClientRect(),
        tooltip,
        sizeRef.current ?? getTooltipSize(surfaceRef.current),
      ),
    );
  }, []);

  const measureContent = useCallback(() => {
    const nextSize = getTooltipSize(contentRef.current);
    const previousSize = sizeRef.current;

    if (
      previousSize &&
      previousSize.width === nextSize.width &&
      previousSize.height === nextSize.height
    ) {
      return;
    }

    sizeRef.current = nextSize;
    setSurfaceSize(nextSize);

    if (activeRef.current) {
      setPosition(
        getTooltipPosition(
          activeRef.current.trigger.getBoundingClientRect(),
          activeRef.current,
          nextSize,
        ),
      );
    }
  }, []);

  const open = useCallback<MorphicTooltipContextValue["open"]>(
    (tooltip, trigger, interaction) => {
      clearOpenTimer();
      clearCloseTimer();

      const show = () => {
        const previous = activeRef.current;
        const nextTooltip: ActiveTooltip = {
          ...tooltip,
          content:
            pendingOpenRef.current?.id === tooltip.id
              ? pendingOpenRef.current.content
              : tooltip.content,
          trigger,
          morphing: Boolean(previous),
          direction: previous
            ? travelDirection(previous.trigger, trigger, tooltip.side)
            : 1,
          interaction,
        };
        openTimerRef.current = null;
        pendingOpenRef.current = null;
        const nextSize = sizeRef.current ?? getTooltipSize(null);

        sizeRef.current = nextSize;
        setSurfaceSize(nextSize);
        activeRef.current = nextTooltip;
        updatePosition(nextTooltip);
        setActive(nextTooltip);
      };

      if (activeRef.current) {
        // Hovering the same trigger again keeps the label where it is.
        if (activeRef.current.id !== tooltip.id) show();
        return;
      }

      const isWarmOpen =
        interaction === "pointer" &&
        performance.now() - lastCloseAtRef.current < TOOLTIP_WARM_WINDOW;

      if (interaction === "focus" || isWarmOpen) {
        show();
        return;
      }

      pendingOpenRef.current = { id: tooltip.id, content: tooltip.content };
      openTimerRef.current = window.setTimeout(show, delay);
    },
    [clearCloseTimer, clearOpenTimer, delay, updatePosition],
  );

  const close = useCallback<MorphicTooltipContextValue["close"]>(
    (id) => {
      if (pendingOpenRef.current?.id === id) clearOpenTimer();
      if (activeRef.current?.id !== id) return;
      clearCloseTimer();

      closeTimerRef.current = window.setTimeout(() => {
        if (activeRef.current?.id !== id) return;

        activeRef.current = null;
        lastCloseAtRef.current = performance.now();
        setActive(null);
        setPosition(null);
        setSurfaceSize(null);
        sizeRef.current = null;
      }, closeDelay);
    },
    [clearCloseTimer, clearOpenTimer, closeDelay],
  );

  const updateContent = useCallback((id: string, content: ReactNode) => {
    if (pendingOpenRef.current?.id === id)
      pendingOpenRef.current = { id, content };
    const current = activeRef.current;
    if (!current || current.id !== id || current.content === content) return;
    const next = { ...current, content };
    activeRef.current = next;
    setActive(next);
  }, []);

  const contextValue = useMemo(
    () => ({ open, close, updateContent }),
    [open, close, updateContent],
  );

  useEffect(() => {
    setMounted(true);

    return () => {
      clearOpenTimer();
      clearCloseTimer();
      clearFrame();
      sizeRef.current = null;
    };
  }, [clearCloseTimer, clearFrame, clearOpenTimer]);

  useLayoutEffect(() => {
    if (!active) return;
    measureContent();
  }, [active, measureContent]);

  useEffect(() => {
    if (!active) return;

    function update() {
      clearFrame();
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        if (activeRef.current) updatePosition(activeRef.current);
      });
    }

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    const content = contentRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined" || !content
        ? null
        : new ResizeObserver(measureContent);

    if (content) resizeObserver?.observe(content);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      resizeObserver?.disconnect();
      clearFrame();
    };
  }, [active, clearFrame, measureContent, updatePosition]);

  const instant = Boolean(reduce) || active?.interaction === "focus";
  const morphing = Boolean(active?.morphing);

  return (
    <MorphicTooltipContext.Provider value={contextValue}>
      {children}
      {mounted
        ? createPortal(
            <AnimatePresence>
              {active && position ? (
                <motion.div
                  key="morphic-tooltip-layer"
                  aria-hidden="true"
                  initial={
                    instant
                      ? false
                      : { opacity: 0, x: position.x, y: position.y }
                  }
                  animate={{ opacity: 1, x: position.x, y: position.y }}
                  exit={reduce ? undefined : { opacity: 0 }}
                  transition={layerTransition(instant, morphing)}
                  className="pointer-events-none fixed top-0 left-0 z-[2147483647]"
                >
                  <div
                    style={{
                      transform: layerOffset(position.side),
                      willChange: "transform",
                    }}
                  >
                    <motion.div
                      ref={surfaceRef}
                      initial={
                        instant || morphing
                          ? false
                          : shellInitial(position.side)
                      }
                      animate={{
                        width: surfaceSize?.width ?? "auto",
                        height: surfaceSize?.height ?? "auto",
                        scaleX: 1,
                        scaleY: 1,
                      }}
                      transition={shellTransition(instant, morphing)}
                      style={{
                        transformOrigin: transformOrigin(position.side),
                        willChange: "width, height, transform",
                      }}
                      className={cn(
                        SURFACE_CLASS,
                        active.contentClassName,
                        className,
                      )}
                    >
                      <MorphicTooltipFilm
                        frameKey={active.id}
                        content={active.content}
                        measureRef={contentRef}
                        custom={{
                          direction: active.direction,
                          side: position.side,
                          morphing,
                          instant,
                        }}
                      />
                      {active.showArrow ? (
                        <span
                          className={cn(
                            "absolute size-2 rotate-45 border-background/15 bg-foreground",
                            arrowClass(position.side),
                          )}
                          style={getArrowStyle(position)}
                        />
                      ) : null}
                    </motion.div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </MorphicTooltipContext.Provider>
  );
}

export function MorphicTooltip({
  content,
  children,
  disabled,
  side = "top",
  align = "center",
  offset = 10,
  showArrow = false,
  className,
  contentClassName,
}: MorphicTooltipProps) {
  const generatedId = useId();
  const context = useContext(MorphicTooltipContext);
  const triggerRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (disabled) context?.close(generatedId);
    else context?.updateContent(generatedId, content);
  }, [context, content, disabled, generatedId]);

  useEffect(() => {
    const trigger = triggerRef.current;
    return () => {
      // Strict Mode replays effects while the trigger remains mounted.
      queueMicrotask(() => {
        if (!trigger?.isConnected) context?.close(generatedId);
      });
    };
  }, [context, generatedId]);

  if (!context) {
    return (
      <MorphicTooltipProvider>
        <MorphicTooltip
          content={content}
          disabled={disabled}
          side={side}
          align={align}
          offset={offset}
          showArrow={showArrow}
          className={className}
          contentClassName={contentClassName}
        >
          {children}
        </MorphicTooltip>
      </MorphicTooltipProvider>
    );
  }

  const tooltipContext = context;
  const tooltip = {
    id: generatedId,
    content,
    side,
    align,
    offset,
    showArrow,
    contentClassName,
  };

  function openTooltip(interaction: ActiveTooltip["interaction"]) {
    const trigger = triggerRef.current;
    if (!trigger || disabled) return;
    tooltipContext.open(tooltip, trigger, interaction);
  }

  function closeTooltip() {
    tooltipContext.close(generatedId);
  }

  function onBlur(event: FocusEvent<HTMLSpanElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) closeTooltip();
  }

  return (
    <span
      ref={triggerRef}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") openTooltip("pointer");
      }}
      onPointerDown={closeTooltip}
      onPointerLeave={closeTooltip}
      onFocusCapture={(event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.matches(":focus-visible")
        ) {
          openTooltip("focus");
        }
      }}
      onBlurCapture={onBlur}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") closeTooltip();
      }}
      className={cn("inline-flex", className)}
    >
      {children}
    </span>
  );
}
