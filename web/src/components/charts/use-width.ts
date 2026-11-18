"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Tracks an element's content width so SVG charts render at real pixel size
 * (text never scales with a viewBox). The fallback renders on the server and
 * on the first client pass, before layout is known.
 */
export function useWidth<T extends HTMLElement>(fallback = 960) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(280, Math.floor(element.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
