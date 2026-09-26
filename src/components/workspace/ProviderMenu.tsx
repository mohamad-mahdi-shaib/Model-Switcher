"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertIcon, CheckIcon, ChevronDownIcon } from "@/components/icons";
import {
  getProviderMeta,
  isProviderUsable,
  PROVIDERS,
  UNAVAILABLE_LABEL,
  type AvailabilityMap,
  type ProviderId,
} from "@/lib/providers";

const FOCUSABLE_SELECTOR = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

type Placement = { vertical: "up" | "down"; left: number };

/**
 * Placement moved into the composer's own bottom toolbar: this trigger now
 * sits at the very bottom of the viewport rather than in the header, so a
 * popover anchored downward (the header's old `top-[46px]`) would routinely
 * run off the bottom edge -- worse once the on-screen keyboard shrinks the
 * visual viewport further. Measured on every open and while the panel stays
 * open (see the effects below), not assumed once: "space above" genuinely
 * changes as the keyboard shows/hides.
 *
 * `left` is a single clamped pixel offset -- local to `container` (the
 * panel's own `position:relative` positioning ancestor), not a left/right
 * CSS-class choice. An earlier version anchored via plain `left-0`/`right-0`
 * classes picked by which side had more room; at narrow widths (360px) the
 * trigger's own position could leave BOTH anchors partially off-screen at
 * once, since neither one clamps -- `right-0` just moves the overflow to
 * the other edge instead of removing it. Clamping the trigger's own left
 * edge into `[margin, innerWidth - panelWidth - margin]` keeps the panel
 * fully on screen regardless of where the trigger sits, the same approach
 * already used for `SwitchDialog` below.
 */
function computePlacement(
  trigger: HTMLElement,
  container: HTMLElement,
  panelWidth: number,
  panelHeightEstimate: number,
  margin = 12,
): Placement {
  const rect = trigger.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const spaceAbove = rect.top;
  const spaceBelow = window.innerHeight - rect.bottom;
  const vertical: Placement["vertical"] =
    spaceAbove >= panelHeightEstimate + margin || spaceAbove >= spaceBelow ? "up" : "down";
  const desiredViewportLeft = Math.min(Math.max(rect.left, margin), window.innerWidth - panelWidth - margin);
  return { vertical, left: desiredViewportLeft - containerRect.left };
}

function SwitchDialog({
  from,
  to,
  onCancel,
  onConfirm,
  portalContainer,
  anchorEl,
}: {
  from: ProviderId;
  to: ProviderId;
  onCancel: () => void;
  onConfirm: () => void;
  portalContainer: HTMLElement | null;
  anchorEl: HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Same measured-position approach the previous header-anchored dialog used
  // (see git history / docs/responsive-ui-refinement.md for the original
  // `backdrop-filter`-containing-block writeup) -- now anchored to the
  // composer's own trigger and, since that trigger sits at the page's
  // bottom edge, opening upward whenever there is room for it rather than
  // always downward.
  const [position, setPosition] = useState<{
    vertical: "up" | "down";
    top: number | undefined;
    bottom: number | undefined;
    left: number;
  } | null>(null);
  const canPortal = Boolean(portalContainer && anchorEl);

  useLayoutEffect(() => {
    if (!portalContainer || !anchorEl) return;
    const DIALOG_HEIGHT_ESTIMATE = 190;
    const DIALOG_WIDTH = 330;
    const MARGIN = 8;
    const recompute = () => {
      const anchorRect = anchorEl.getBoundingClientRect();
      const containerRect = portalContainer.getBoundingClientRect();
      const spaceAbove = anchorRect.top - containerRect.top;
      const spaceBelow = containerRect.bottom - anchorRect.bottom;
      const vertical: "up" | "down" =
        spaceAbove >= DIALOG_HEIGHT_ESTIMATE + MARGIN || spaceAbove >= spaceBelow ? "up" : "down";
      const maxLeft = containerRect.width - DIALOG_WIDTH - 12;
      const left = Math.min(
        Math.max(anchorRect.left - containerRect.left, 12),
        Math.max(maxLeft, 12),
      );
      setPosition({
        vertical,
        top: vertical === "up" ? undefined : anchorRect.bottom - containerRect.top + MARGIN,
        bottom: vertical === "up" ? containerRect.bottom - anchorRect.top + MARGIN : undefined,
        left,
      });
    };
    recompute();
    window.addEventListener("resize", recompute);
    // Reacts to the on-screen keyboard opening/closing and to page scroll,
    // neither of which fires a plain `resize` on `window` itself.
    const vv = window.visualViewport;
    vv?.addEventListener("resize", recompute);
    vv?.addEventListener("scroll", recompute);
    return () => {
      window.removeEventListener("resize", recompute);
      vv?.removeEventListener("resize", recompute);
      vv?.removeEventListener("scroll", recompute);
    };
  }, [portalContainer, anchorEl]);

  useEffect(() => {
    confirmRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const backdrop = (
    <div aria-hidden="true" className="fixed inset-0 z-40" onClick={onCancel} />
  );

  const dialogBody = (
    <div
      aria-labelledby="switch-title"
      aria-modal="true"
      className="glass-modal absolute z-50 w-[330px] max-w-[calc(100vw-24px)] rounded-2xl p-4"
      ref={ref}
      role="dialog"
      style={
        position
          ? {
              ...(position.vertical === "up" ? { bottom: position.bottom } : { top: position.top }),
              left: position.left,
            }
          : { bottom: 52, left: 12 }
      }
    >
      <div className="flex items-start gap-2">
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 glass-text-dark" />
        <div>
          <h2
            className="text-[12.5px] font-semibold tracking-tight glass-text-dark"
            id="switch-title"
          >
            Switch to {getProviderMeta(to).label}?
          </h2>
          <p className="mt-1.5 text-[11px] leading-relaxed glass-text-subtle">
            This conversation has already started with{" "}
            <strong className="font-semibold">{getProviderMeta(from).label}</strong>.
            Every later message will send the{" "}
            <strong className="font-semibold">whole conversation so far</strong>{" "}
            to {getProviderMeta(to).label}, whose answers may differ in style and
            substance. Replies already on screen keep their original model.
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-1.5">
        <button
          className="focus-glass min-h-11 rounded-full px-3 py-1 text-[11px] glass-text-subtle hover:bg-white/12"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="glass-btn focus-glass min-h-11 rounded-full px-3 py-1 text-[11px] font-medium glass-text-dark"
          onClick={onConfirm}
          ref={confirmRef}
          type="button"
        >
          Switch model
        </button>
      </div>
    </div>
  );

  if (canPortal && portalContainer) {
    return createPortal(
      <>
        {backdrop}
        {dialogBody}
      </>,
      portalContainer,
    );
  }

  return (
    <>
      {backdrop}
      {dialogBody}
    </>
  );
}

/**
 * Trigger + listbox + confirmation dialog, as one unit -- moved here from
 * the header (Responsive UI refinement, placement pass) so it can live in
 * the composer's own bottom toolbar. The listbox/keyboard-nav/confirmation
 * semantics are unchanged from the header version; what changed is where it
 * renders and which direction its own popovers open.
 */
export function ProviderSwitcher({
  provider,
  availability,
  busy,
  conversationStarted,
  onSelectProvider,
  open,
  onOpenChange,
  portalContainer,
}: {
  provider: ProviderId;
  availability: AvailabilityMap | null;
  busy: boolean;
  conversationStarted: boolean;
  onSelectProvider: (id: ProviderId) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portalContainer: HTMLElement | null;
}) {
  const [pending, setPending] = useState<ProviderId | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement>({ vertical: "up", left: 0 });

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onOpenChange(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const options = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)');
      if (!options || options.length === 0) return;
      event.preventDefault();
      const current = Array.from(options).indexOf(document.activeElement as HTMLButtonElement);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = current === -1 ? 0 : (current + delta + options.length) % options.length;
      options[next].focus();
    }

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const selected = listRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
    selected?.focus();
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !containerRef.current) return;
    const PANEL_WIDTH = 260;
    const PANEL_HEIGHT_ESTIMATE = 150;
    const recompute = () => {
      if (!triggerRef.current || !containerRef.current) return;
      setPlacement(computePlacement(triggerRef.current, containerRef.current, PANEL_WIDTH, PANEL_HEIGHT_ESTIMATE));
    };
    recompute();
    window.addEventListener("resize", recompute);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", recompute);
    vv?.addEventListener("scroll", recompute);
    return () => {
      window.removeEventListener("resize", recompute);
      vv?.removeEventListener("resize", recompute);
      vv?.removeEventListener("scroll", recompute);
    };
  }, [open]);

  const closeDialog = () => {
    setPending(null);
    triggerRef.current?.focus();
  };

  const requestSwitch = (target: ProviderId) => {
    if (target === provider) return;
    if (!isProviderUsable(target, availability)) return;
    if (busy) return;
    if (!conversationStarted) {
      onSelectProvider(target);
      return;
    }
    setPending(target);
  };

  const meta = getProviderMeta(provider);

  return (
    // The width constraint lives on this wrapper, not the button: a
    // percentage max-width on the button itself, inside a wrapper with no
    // width of its own, is a circular dependency (the button's resolved
    // width feeds back into what the wrapper shrink-wraps to, so `right-0`
    // -- anchored to the WRAPPER's box -- ended up measurably wider than
    // the button actually rendered, pushing the opened panel off by the
    // difference). A fixed pixel cap, not a percentage, sidesteps that
    // class of bug entirely rather than just resolving it against a
    // different (still-shared) container -- the trigger now sits in a
    // `justify-end` group with Send/Stop rather than alone in a
    // `justify-between` row, so there is no longer one obvious "whole row"
    // for a percentage to resolve against anyway.
    <div className="relative max-w-[130px] min-w-0" ref={containerRef}>
      {/* Chatgpt-style trigger: plain text + a small chevron, no bordered
          chip -- the model picker itself (not a settings-style control)
          reads as a label you click, with a quiet hover highlight instead
          of a permanent outline. The exact model id no longer rides along
          on the trigger; it is still shown, never truncated, on each row
          inside the open menu below. */}
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="focus-glass flex h-11 w-full min-w-0 items-center gap-1 rounded-lg px-2 text-[13px] font-medium glass-text-dark transition-colors hover:bg-white/10"
        onClick={() => onOpenChange(!open)}
        ref={(el) => {
          triggerRef.current = el;
          setAnchorEl(el);
        }}
        type="button"
      >
        <span className="truncate">{meta.label}</span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 glass-text-subtle transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div
          aria-label="AI provider"
          className={`glass-modal absolute z-50 w-[260px] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl p-1.5 ${
            placement.vertical === "up" ? "bottom-[52px]" : "top-[52px]"
          }`}
          ref={listRef}
          role="listbox"
          style={{ left: placement.left }}
        >
          {PROVIDERS.map((item) => {
            const usable = isProviderUsable(item.id, availability);
            const isActive = item.id === provider;
            const locked = busy && !isActive;
            const reason =
              availability?.[item.id]?.reason ?? item.note ?? "Not connected yet.";
            const modelForItem = availability?.[item.id]?.model;
            return (
              // Chatgpt-style row: a plain list item, a quiet neutral
              // highlight (not the provider's own accent color) on the
              // selected one, and a checkmark rather than a badge -- the
              // same convention as ChatGPT's own model picker.
              <button
                aria-disabled={!usable || locked}
                aria-selected={isActive}
                className={`focus-glass flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left transition-colors ${
                  isActive
                    ? "bg-white/12 glass-text-dark"
                    : !usable || locked
                      ? "cursor-not-allowed opacity-45 glass-text-subtle"
                      : "glass-text-muted hover:bg-white/10"
                }`}
                data-provider={item.id}
                disabled={locked}
                key={item.id}
                onClick={() => {
                  if (!usable || locked) return;
                  onOpenChange(false);
                  requestSwitch(item.id);
                }}
                role="option"
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium">
                    {item.label}
                    {usable ? null : <span className="sr-only"> ({UNAVAILABLE_LABEL})</span>}
                  </span>
                  {/* The exact configured model id, never truncated here even
                      though the trigger's own compact readout may be -- this
                      is where the full value stays reachable by touch and
                      keyboard regardless of viewport width. */}
                  <span className="block truncate text-[10px] glass-text-subtle">
                    {usable ? (modelForItem ?? "model unavailable") : reason}
                  </span>
                </span>
                {isActive ? <CheckIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 glass-text-dark" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {pending ? (
        <SwitchDialog
          anchorEl={anchorEl}
          from={provider}
          onCancel={closeDialog}
          onConfirm={() => {
            if (!busy) onSelectProvider(pending);
            closeDialog();
          }}
          portalContainer={portalContainer}
          to={pending}
        />
      ) : null}
    </div>
  );
}
