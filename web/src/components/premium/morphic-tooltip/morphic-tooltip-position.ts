export type MorphicTooltipPlacement = {
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  offset?: number;
};

export type TooltipSide = NonNullable<MorphicTooltipPlacement["side"]>;
type TooltipAlign = NonNullable<MorphicTooltipPlacement["align"]>;

export type TooltipPosition = {
  x: number;
  y: number;
  side: TooltipSide;
  arrowX: number;
  arrowY: number;
};

export type TooltipSize = {
  width: number;
  height: number;
};

const VIEWPORT_PADDING = 12;
const MAX_TOOLTIP_WIDTH = 288;

export function isVerticalSide(side: TooltipSide) {
  return side === "top" || side === "bottom";
}

/** Which way the surface travels between two triggers, along the strip. */
export function travelDirection(
  from: HTMLElement,
  to: HTMLElement,
  side: TooltipSide,
): 1 | -1 {
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const delta = isVerticalSide(side)
    ? b.left + b.width / 2 - (a.left + a.width / 2)
    : b.top + b.height / 2 - (a.top + a.height / 2);
  return delta < 0 ? -1 : 1;
}

export function getTooltipPosition(
  rect: DOMRect,
  placement: Required<MorphicTooltipPlacement>,
  size: TooltipSize,
): TooltipPosition {
  const padding = VIEWPORT_PADDING;
  const side = resolveTooltipSide(rect, placement, size, padding);
  const x =
    side === "left"
      ? rect.left - placement.offset - size.width
      : side === "right"
        ? rect.right + placement.offset
        : inlineAnchor(rect, placement.align) -
          alignOffset(size.width, placement.align);

  const y =
    side === "top"
      ? rect.top - placement.offset - size.height
      : side === "bottom"
        ? rect.bottom + placement.offset
        : blockAnchor(rect, placement.align) -
          alignOffset(size.height, placement.align);
  const clampedX = clamp(x, padding, window.innerWidth - padding - size.width);
  const clampedY = clamp(
    y,
    padding,
    window.innerHeight - padding - size.height,
  );
  const isVertical = isVerticalSide(side);

  return {
    x: isVertical ? clampedX + size.width / 2 : clampedX,
    y: isVertical ? clampedY : clampedY + size.height / 2,
    side,
    arrowX: clamp(rect.left + rect.width / 2 - clampedX, 12, size.width - 12),
    arrowY: clamp(rect.top + rect.height / 2 - clampedY, 12, size.height - 12),
  };
}

export function getTooltipSize(element: HTMLElement | null): TooltipSize {
  if (!element) {
    return {
      width: Math.min(MAX_TOOLTIP_WIDTH, window.innerWidth - 24),
      height: 44,
    };
  }

  const rect = element.getBoundingClientRect();

  return {
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
  };
}

function resolveTooltipSide(
  rect: DOMRect,
  placement: Required<MorphicTooltipPlacement>,
  size: TooltipSize,
  padding: number,
): TooltipSide {
  const requiredWidth = size.width + placement.offset;
  const requiredHeight = size.height + placement.offset;
  const space = {
    top: rect.top - padding,
    right: window.innerWidth - rect.right - padding,
    bottom: window.innerHeight - rect.bottom - padding,
    left: rect.left - padding,
  };
  const preferred = placement.side;
  const opposite = oppositeSide(preferred);

  if (fitsSide(preferred, space, requiredWidth, requiredHeight)) {
    return preferred;
  }

  if (fitsSide(opposite, space, requiredWidth, requiredHeight)) {
    return opposite;
  }

  if (isVerticalSide(preferred)) {
    return space.bottom >= space.top ? "bottom" : "top";
  }

  return space.right >= space.left ? "right" : "left";
}

function fitsSide(
  side: TooltipSide,
  space: Record<TooltipSide, number>,
  requiredWidth: number,
  requiredHeight: number,
) {
  return isVerticalSide(side)
    ? space[side] >= requiredHeight
    : space[side] >= requiredWidth;
}

function oppositeSide(side: TooltipSide): TooltipSide {
  switch (side) {
    case "bottom":
      return "top";
    case "left":
      return "right";
    case "right":
      return "left";
    default:
      return "bottom";
  }
}

function inlineAnchor(rect: DOMRect, align: TooltipAlign) {
  if (align === "start") return rect.left;
  if (align === "end") return rect.right;
  return rect.left + rect.width / 2;
}

function blockAnchor(rect: DOMRect, align: TooltipAlign) {
  if (align === "start") return rect.top;
  if (align === "end") return rect.bottom;
  return rect.top + rect.height / 2;
}

function alignOffset(size: number, align: TooltipAlign) {
  if (align === "start") return 0;
  if (align === "end") return size;
  return size / 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(min, max), Math.max(min, value));
}

export function arrowClass(side: TooltipSide) {
  switch (side) {
    case "bottom":
      return "-top-1 -translate-x-1/2 border-t border-l";
    case "left":
      return "-right-1 -translate-y-1/2 border-t border-r";
    case "right":
      return "-left-1 -translate-y-1/2 border-b border-l";
    default:
      return "-bottom-1 -translate-x-1/2 border-r border-b";
  }
}

export function getArrowStyle(position: TooltipPosition) {
  return isVerticalSide(position.side)
    ? { left: position.arrowX }
    : { top: position.arrowY };
}

export function layerOffset(side: TooltipSide) {
  return isVerticalSide(side) ? "translateX(-50%)" : "translateY(-50%)";
}

export function transformOrigin(side: TooltipSide) {
  switch (side) {
    case "bottom":
      return "center top";
    case "left":
      return "right center";
    case "right":
      return "left center";
    default:
      return "center bottom";
  }
}
