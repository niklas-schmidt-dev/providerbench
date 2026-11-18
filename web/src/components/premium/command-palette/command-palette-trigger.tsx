"use client";

import { Search } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button, type ButtonProps } from "@/components/motion/button";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { usePalette } from "./command-palette-context";
import { CommandKbd } from "./command-palette-kbd";

export type MorphicCommandPaletteTriggerProps = Omit<
  ButtonProps,
  "layout" | "layoutId" | "variant"
>;

/** The button the panel grows out of and shrinks back into. */
export function MorphicCommandPaletteTrigger({
  children,
  className,
  onClick,
  disabled,
  ...props
}: MorphicCommandPaletteTriggerProps) {
  const { id, open, setOpen, shortcut } = usePalette();
  const reduce = useReducedMotion();

  return (
    <Button
      variant="ghost"
      {...props}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={`${id}-dialog`}
      style={{ ...props.style, visibility: open ? "hidden" : "visible" }}
      whileHover={undefined}
      whileTap={undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(true);
      }}
      className={cn(
        "group relative isolate h-10 rounded-full bg-transparent px-4 text-foreground text-sm outline-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {/* Only the surface morphs; the button keeps its real hit area and the
          label isn't stretched by the shared layout's scale correction. */}
      <motion.span
        aria-hidden
        layoutId={reduce ? undefined : `${id}-surface`}
        transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
        // A px radius (full round at this height) so the morph can blend it
        // into the panel's corners instead of snapping.
        style={{ borderRadius: 20 }}
        className="pointer-events-none absolute inset-0 -z-10 border border-border bg-background transition-colors duration-200 group-hover:border-foreground/20"
      />
      <motion.span
        initial={false}
        animate={{ opacity: open ? 0 : 1 }}
        // On close the label waits for the surface to land back in the
        // button, so it never sits on top of the shrinking panel.
        transition={{
          duration: reduce ? 0 : open ? 0.1 : 0.18,
          delay: reduce || open ? 0 : 0.2,
          ease: EASE_OUT,
        }}
        className="flex min-w-0 flex-1 items-center justify-center gap-3"
      >
        {children ?? (
          <>
            <Search aria-hidden className="size-4 text-muted-foreground" />
            <span>Search commands</span>
            {shortcut ? (
              <CommandKbd
                keys={["⌘", shortcut.toUpperCase()]}
                className="ml-4"
              />
            ) : null}
          </>
        )}
      </motion.span>
    </Button>
  );
}
