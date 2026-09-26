"use client";

import { useSyncExternalStore } from "react";

/**
 * Responsive UI refinement: tracks whether a CSS media query currently
 * matches, updating live on resize/orientation change. Needed wherever a
 * layout decision cannot be expressed as pure CSS -- in this project,
 * whether to portal an overlay (SettingsPanel's mobile bottom sheet,
 * ConversationSidebar's mobile drawer) versus render it in place, since a
 * portal's DOM location is decided at render time, not stylable after the
 * fact the way a CSS breakpoint is.
 *
 * `useSyncExternalStore` (not `useEffect` + `setState`) because `matchMedia`
 * is exactly the kind of external, mutable source it exists for: it commits
 * the subscribed value synchronously with the render it belongs to, with no
 * separate "commit, then correct in an effect" render this project's other
 * effects are rightly discouraged from doing. The server snapshot is always
 * `false` (the desktop/wide assumption), since `window` does not exist
 * during server rendering.
 *
 * That server-`false` assumption is invisible for a consumer that only
 * gates a closed-by-default overlay (nothing renders differently until a
 * user opens it, well after hydration) -- but `ChatHeader`'s sidebar-toggle
 * button reads this hook to label itself ("Open"/"Close conversation
 * list") on a control that is visible from the very first paint. There,
 * the mismatch is real for a brief window: React hydrates with the
 * server's `false` (desktop-shaped) label, then self-corrects to the true
 * client value as soon as it detects the difference -- confirmed directly
 * (real browser, narrow viewport) to land within roughly half a second,
 * never later, and the sidebar/drawer's own actual open/closed STATE is
 * unaffected throughout (that part is pure CSS, gated on the viewport
 * width directly, not on this hook). A screen reader or a script
 * interacting with the toggle in that sub-second window would briefly see
 * the wrong label; nothing sighted or layout-affecting is ever wrong. Real
 * browser tests against this control should allow for that window rather
 * than asserting immediately after navigation.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
