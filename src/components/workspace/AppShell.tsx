"use client";

import type { ReactNode } from "react";
import { useEdgeGlint } from "@/lib/use-edge-glint";

/**
 * Layout-restructure pass: the four layout regions, as one presentational
 * shell.
 *
 * Before this, `WorkspaceLayout` rendered a single `<main>` containing the
 * sidebar and one glass panel, with the only "header" being a title row
 * INSIDE that panel. The regions are now real, separate landmarks --
 * `<header>`, `<aside>`, `<main>` -- and this component owns nothing but
 * how they are arranged.
 *
 * There is deliberately no footer region: a global footer bar was built
 * here and then removed by request. Everything it had carried was either
 * status the app states where it matters (the message cap, in the
 * composer's own notice; degraded storage, in the sidebar) or a second
 * path to Settings, which the header already owns. The height it used is
 * now the conversation's.
 *
 * Slots, not forwarded props: every region's content needs a different
 * slice of the workspace's state, and threading ~30 props through a layout
 * component would be pure indirection. `header`/`sidebar` and `children`
 * (the main content) are passed as already-built elements, so this file
 * stays a layout -- and the regions stay independently reusable/
 * replaceable -- while `WorkspaceLayout` keeps being the single owner of
 * state.
 *
 * Two structural details this shell is responsible for, both load-bearing:
 *
 * 1. `shellRef` hands the shell element back out as the portal container
 *    for every overlay (sidebar drawer, Settings, the provider switch
 *    dialog). It must be an element with NO `backdrop-filter`/`transform`/
 *    `filter` of its own -- any of those would make it the containing
 *    block for `position: fixed` descendants, so a full-viewport backdrop
 *    would be clipped to it instead of covering the viewport. It is also
 *    `relative`, which the switch dialog's measured `absolute` placement
 *    resolves against. Critically it sits ABOVE header/sidebar/main in
 *    the tree, not inside `<main>` as before: a portaled backdrop is
 *    therefore a sibling of all three regions and can actually cover the
 *    header, instead of being trapped in `<main>`'s own stacking context
 *    underneath it.
 *
 * 2. The pointer-tracking edge glint belongs to the main panel's glass, so
 *    the hook lives here with the element it decorates rather than in the
 *    state container.
 */
type AppShellProps = {
  /** Global header bar: brand, sidebar toggle, title, global actions. */
  header: ReactNode;
  /** Side navigation. Renders its own inline/drawer behavior per viewport. */
  sidebar: ReactNode;
  /** Overlays portaled by the regions (already-portaled nodes are fine). */
  overlays?: ReactNode;
  /** The main content region. */
  children: ReactNode;
  shellRef: (element: HTMLDivElement | null) => void;
};

export function AppShell({ header, sidebar, overlays, children, shellRef }: AppShellProps) {
  const { hostRef, glintRef } = useEdgeGlint<HTMLElement>(true);

  return (
    <div
      // Full-width pass: this element used to carry `max-w-[1360px]` and
      // `max-h-[860px]`, and those two caps -- not any padding or margin
      // further in -- were what left the large empty bands down both sides
      // (and above/below) on anything wider than a 1366px laptop: the whole
      // workspace was a fixed-size card centred in the viewport. It now
      // fills whatever space `workspace-root`'s own (responsive, small)
      // padding leaves it, at every size. Nothing else about the regions
      // changed; the glass panels simply get the width they were being
      // denied. The reading column that keeps long lines comfortable is
      // handled where it belongs -- inside the main region, on the
      // transcript and composer themselves -- not by shrinking the whole
      // app.
      className="relative z-10 flex h-full w-full flex-col gap-2 lg:gap-2.5"
      ref={shellRef}
    >
      {header}

      {/* `min-h-0` is what keeps this row inside the shell: without it a
          flex item's base size is its content's intrinsic height, so a long
          transcript would grow the row past the viewport. The panel's own
          scroll areas absorb the overflow instead.

          `gap-2`, tightened from `gap-3 sm:gap-4 lg:gap-5`: enough to read
          the sidebar and the main panel as two separate glass surfaces,
          with no wasted channel between them. */}
      <div className="flex min-h-0 flex-1 items-stretch gap-2 lg:gap-2.5">
        {sidebar}

        <main
          // The chat panel's glass surface IS the main region now -- one
          // element, not a `<main>` wrapper around a `<section>` that
          // carried the same box.
          // Padding scales with the viewport instead of jumping to a flat
          // 28px at `lg` -- at full width that was pure inset, pushing the
          // conversation inward for no reason.
          className="optical-glass relative flex min-w-0 flex-1 flex-col rounded-[24px] px-3 py-2.5 sm:rounded-[28px] sm:px-4 sm:py-3.5 lg:px-5 lg:py-4"
          ref={hostRef}
        >
          <div aria-hidden="true" className="edge-glint" ref={glintRef} />
          {children}
        </main>
      </div>

      {overlays}
    </div>
  );
}
