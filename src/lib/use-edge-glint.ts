"use client";

import { useEffect, useRef } from "react";

/**
 * Tracks the pointer across `hostRef` and writes the position into two CSS
 * custom properties on `glintRef`.
 *
 * Deliberately does NOT use state: a pointermove-driven setState would
 * re-render the whole workspace tree dozens of times a second. This touches one
 * decorative element's inline style, coalesced to one write per animation
 * frame. The host rect is cached on enter rather than measured per move.
 *
 * Disabled entirely on devices without a fine hover pointer and for users who
 * prefer reduced motion; CSS supplies a static highlight in those cases.
 */
export function useEdgeGlint<T extends HTMLElement>(enabled: boolean) {
  const hostRef = useRef<T>(null);
  const glintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;

    const host = hostRef.current;
    const glint = glintRef.current;
    if (!host || !glint) return;

    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!canHover.matches || reduceMotion.matches) return;

    let rect: DOMRect | null = null;
    let frame = 0;
    let x = 50;
    let y = 0;

    const write = () => {
      frame = 0;
      glint.style.setProperty("--glint-x", `${x}%`);
      glint.style.setProperty("--glint-y", `${y}%`);
    };

    const onEnter = () => {
      rect = host.getBoundingClientRect();
      glint.style.opacity = "1";
    };

    const onMove = (event: PointerEvent) => {
      if (!rect) rect = host.getBoundingClientRect();
      x = ((event.clientX - rect.left) / rect.width) * 100;
      y = ((event.clientY - rect.top) / rect.height) * 100;
      if (!frame) frame = requestAnimationFrame(write);
    };

    const onLeave = () => {
      rect = null;
      glint.style.opacity = "0";
    };

    const onResize = () => {
      rect = null;
    };

    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onResize);
      glint.style.opacity = "";
    };
  }, [enabled]);

  return { hostRef, glintRef };
}
