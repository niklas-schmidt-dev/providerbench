"use client";

import { X } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
} from "react";
import { Button } from "@/components/motion/button";
import { MorphicTooltip } from "@/components/premium/morphic-tooltip/morphic-tooltip";
import { cn } from "@/lib/utils";

/** Lets the parts close the modal they sit in. */
export const AnimatedModalContext = createContext<{ close: () => void } | null>(
  null,
);

export type AnimatedModalCloseProps = {
  /** Accessible name and tooltip for the close button. */
  label?: string;
  className?: string;
};

/** An icon button that closes the surrounding modal. */
export function AnimatedModalClose({
  label = "Close",
  className,
}: AnimatedModalCloseProps) {
  const modal = useContext(AnimatedModalContext);
  return (
    <MorphicTooltip content={label} side="bottom">
      <Button
        size="icon"
        variant="ghost"
        aria-label={label}
        onClick={() => modal?.close()}
        className={cn("size-8 shrink-0", className)}
      >
        <X aria-hidden="true" className="size-4" />
      </Button>
    </MorphicTooltip>
  );
}

export type AnimatedModalHeaderProps = {
  children: ReactNode;
  /** Leave out the close button, for dialogs that must be answered. */
  hideClose?: boolean;
  closeLabel?: string;
  className?: string;
};

/** Title and description on the left, a close button on the right. */
export function AnimatedModalHeader({
  children,
  hideClose = false,
  closeLabel,
  className,
}: AnimatedModalHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-start gap-4 border-border border-b px-5 py-4",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {hideClose ? null : <AnimatedModalClose label={closeLabel} />}
    </header>
  );
}

export function AnimatedModalBody({
  className,
  ...props
}: ComponentProps<"div">) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function AnimatedModalFooter({
  className,
  ...props
}: ComponentProps<"footer">) {
  return (
    <footer
      className={cn(
        "flex flex-wrap justify-end gap-2 border-border border-t px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}
