import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface BackdropToggleContextValue {
  solid: boolean;
  toggle: () => void;
}

const BackdropToggleContext = createContext<BackdropToggleContextValue | null>(null);

// Lets content rendered inside a `backdropToggle` Modal put the toggle button
// wherever makes sense for that content (e.g. a game's own header row),
// instead of Modal dictating a fixed on-screen position for it.
export function useBackdropToggle() {
  return useContext(BackdropToggleContext);
}

export function Modal({
  onClose,
  children,
  size = "lg",
  dismissible = true,
  backdropToggle = false,
}: {
  onClose: () => void;
  children: React.ReactNode;
  size?: "md" | "lg" | "xl";
  // When false, the modal can only be closed by an explicit action inside it
  // (e.g. a game's own Leave/Exit button) — not by clicking the backdrop or Escape.
  dismissible?: boolean;
  // Makes the blurred/dimmed backdrop toggleable for a solid fill instead —
  // purely cosmetic, the card's own size never changes. Consume via
  // useBackdropToggle() to render the actual switch inside the modal's content.
  backdropToggle?: boolean;
}) {
  const [solidBackdrop, setSolidBackdrop] = useState(false);

  useEffect(() => {
    // Plain `overflow: hidden` on body doesn't stop iOS Safari's touch-driven
    // rubber-band scroll, which lets the page shift under this fixed-position
    // modal and leaves it visually clipped by the status bar/toolbar. Pinning
    // body with `position: fixed` (restoring scroll position on cleanup) is
    // the standard fix that actually blocks scroll on iOS.
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    // `dvh`/`position: fixed` are anchored to the layout viewport, which iOS
    // Safari does not keep in sync with the *visual* viewport while its
    // toolbar is collapsing/expanding — an animation triggered by any scroll
    // gesture on the page, including scrolling inside this modal's own
    // content, not just document scroll. That mismatch is what leaves the
    // modal visibly stuck/clipped under the status bar mid-scroll. Track the
    // real visual viewport continuously via CSS vars so the modal's size and
    // position never depend on a `dvh` snapshot the toolbar has outrun.
    const vv = window.visualViewport;
    const root = document.documentElement;
    const syncViewport = () => {
      if (!vv) return;
      root.style.setProperty("--app-vvh", `${vv.height}px`);
      root.style.setProperty("--app-vvw", `${vv.width}px`);
      root.style.setProperty("--app-vv-top", `${vv.offsetTop}px`);
      root.style.setProperty("--app-vv-left", `${vv.offsetLeft}px`);
    };
    syncViewport();
    vv?.addEventListener("resize", syncViewport);
    vv?.addEventListener("scroll", syncViewport);

    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
      window.removeEventListener("keydown", onKeyDown);
      vv?.removeEventListener("resize", syncViewport);
      vv?.removeEventListener("scroll", syncViewport);
      root.style.removeProperty("--app-vvh");
      root.style.removeProperty("--app-vvw");
      root.style.removeProperty("--app-vv-top");
      root.style.removeProperty("--app-vv-left");
    };
  }, [onClose, dismissible]);

  const contextValue = backdropToggle
    ? { solid: solidBackdrop, toggle: () => setSolidBackdrop((s) => !s) }
    : null;

  return createPortal(
    <div
      className="fixed z-50 flex items-center justify-center overscroll-none p-0 sm:p-4"
      style={{
        top: "var(--app-vv-top, 0px)",
        left: "var(--app-vv-left, 0px)",
        width: "var(--app-vvw, 100vw)",
        height: "var(--app-vvh, 100dvh)",
      }}
    >
      <div
        className={`absolute inset-0 transition-colors ${
          solidBackdrop ? "bg-background" : "bg-black/70 backdrop-blur-sm"
        }`}
        onClick={dismissible ? onClose : undefined}
      />
      <div className={`relative z-10 flex flex-col max-h-screen max-h-[var(--app-vvh,100dvh)] w-full overflow-hidden sm:max-h-[92vh] sm:max-h-[92dvh] sm:rounded-2xl sm:shadow-2xl ${size === "md" ? "max-w-md" : size === "xl" ? "max-w-[1400px]" : "max-w-3xl"}`}>
        <BackdropToggleContext.Provider value={contextValue}>{children}</BackdropToggleContext.Provider>
      </div>
    </div>,
    document.body
  );
}
