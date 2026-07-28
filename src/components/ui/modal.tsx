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
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, dismissible]);

  const contextValue = backdropToggle
    ? { solid: solidBackdrop, toggle: () => setSolidBackdrop((s) => !s) }
    : null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
      <div
        className={`absolute inset-0 transition-colors ${
          solidBackdrop ? "bg-background" : "bg-black/70 backdrop-blur-sm"
        }`}
        onClick={dismissible ? onClose : undefined}
      />
      <div className={`relative z-10 max-h-screen w-full overflow-hidden sm:max-h-[92vh] sm:rounded-2xl sm:shadow-2xl ${size === "md" ? "max-w-md" : size === "xl" ? "max-w-[1400px]" : "max-w-3xl"}`}>
        <BackdropToggleContext.Provider value={contextValue}>{children}</BackdropToggleContext.Provider>
      </div>
    </div>,
    document.body
  );
}
