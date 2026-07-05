import { useEffect } from "react";
import { createPortal } from "react-dom";

export function Modal({
  onClose,
  children,
  size = "lg",
}: {
  onClose: () => void;
  children: React.ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div className={`relative z-10 max-h-screen w-full overflow-hidden sm:max-h-[92vh] sm:rounded-2xl sm:shadow-2xl ${size === "md" ? "max-w-md" : size === "xl" ? "max-w-[1260px]" : "max-w-3xl"}`}>
        {children}
      </div>
    </div>,
    document.body
  );
}
