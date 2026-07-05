import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, CalendarDays, ArrowRight } from "lucide-react";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseLocal(str: string): Date | null {
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toLocalIso(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function fmtShort(str: string): string | null {
  const d = parseLocal(str);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
}

// ─── Shared calendar internals ────────────────────────────────────────────────

function useCalendarPortal(open: boolean, triggerRef: React.RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const calH = 340;
    const top = window.innerHeight - r.bottom < calH + 8 ? r.top - calH - 6 : r.bottom + 6;
    setPos({ top, left: r.left });
  }, [open]);
  return pos;
}

function useCloseOnOutside(
  open: boolean,
  refs: React.RefObject<HTMLElement | null>[],
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (refs.some(r => r.current?.contains(e.target as Node))) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);
}

// ─── Single DatePicker ────────────────────────────────────────────────────────

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Pick a date",
  label,
}: {
  value: string;
  onChange: (val: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const calRef = useRef<HTMLDivElement>(null);

  const selected = parseLocal(value);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [viewYear, setViewYear] = useState(selected?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected?.getMonth() ?? today.getMonth());

  useEffect(() => {
    if (selected) { setViewYear(selected.getFullYear()); setViewMonth(selected.getMonth()); }
  }, [value]);

  const pos = useCalendarPortal(open, buttonRef);
  useCloseOnOutside(open, [buttonRef, calRef], () => setOpen(false));

  function prevMonth() { viewMonth === 0 ? (setViewYear(y => y - 1), setViewMonth(11)) : setViewMonth(m => m - 1); }
  function nextMonth() { viewMonth === 11 ? (setViewYear(y => y + 1), setViewMonth(0)) : setViewMonth(m => m + 1); }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const minDate = parseLocal(min ?? "");
  const maxDate = parseLocal(max ?? "");

  return (
    <div className="relative inline-block">
      {label && <p className="text-xs text-muted-foreground mb-1">{label}</p>}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary min-w-[128px] ${
          open ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/50"
        }`}
      >
        <CalendarDays className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {fmtShort(value) ?? placeholder}
        </span>
      </button>

      {open && createPortal(
        <div ref={calRef} style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-64 rounded-xl border border-border bg-card shadow-2xl p-3 select-none">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevMonth} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <span className="text-sm font-semibold">{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map(d => <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground/70 py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {Array.from({ length: firstDow }, (_, i) => <div key={`p${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const d = new Date(viewYear, viewMonth, day);
              const disabled = (minDate && d < minDate) || (maxDate && d > maxDate) || false;
              const sel = selected && toLocalIso(d) === value;
              const tod = toLocalIso(d) === toLocalIso(today);
              return (
                <button key={day} type="button" disabled={!!disabled}
                  onClick={() => { if (!disabled) { onChange(toLocalIso(d)); setOpen(false); } }}
                  className={`h-8 w-full rounded-lg text-xs font-medium transition-colors ${
                    sel ? "bg-primary text-primary-foreground shadow-sm"
                    : disabled ? "text-muted-foreground/30 cursor-not-allowed"
                    : tod ? "bg-muted text-foreground ring-1 ring-inset ring-primary/40 hover:bg-muted/70"
                    : "text-foreground hover:bg-muted"
                  }`}>{day}</button>
              );
            })}
          </div>
          <div className="mt-2 pt-2 border-t border-border/60">
            <button type="button" onClick={() => {
              const iso = toLocalIso(today);
              if (minDate && today < minDate) return;
              if (maxDate && today > maxDate) return;
              onChange(iso); setOpen(false);
            }} className="w-full rounded-lg py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">Today</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── DateRangePicker ──────────────────────────────────────────────────────────

type RangeStep = "from" | "to";

export function DateRangePicker({
  from,
  to,
  onFromChange,
  onToChange,
  maxTo,
}: {
  from: string;
  to: string;
  onFromChange: (val: string) => void;
  onToChange: (val: string) => void;
  maxTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<RangeStep>("from");
  const [hovered, setHovered] = useState<string | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const calRef = useRef<HTMLDivElement>(null);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const fromDate = parseLocal(from);
  const toDate = parseLocal(to);
  const maxDate = parseLocal(maxTo ?? "");

  const [viewYear, setViewYear] = useState(() => fromDate?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => fromDate?.getMonth() ?? today.getMonth());

  const pos = useCalendarPortal(open, wrapperRef);
  useCloseOnOutside(open, [wrapperRef, calRef], () => { setOpen(false); setHovered(null); });

  function openCalendar(s: RangeStep) {
    setStep(s);
    setHovered(null);
    const anchor = s === "from" ? fromDate : toDate;
    setViewYear(anchor?.getFullYear() ?? today.getFullYear());
    setViewMonth(anchor?.getMonth() ?? today.getMonth());
    setOpen(true);
  }

  function prevMonth() { viewMonth === 0 ? (setViewYear(y => y - 1), setViewMonth(11)) : setViewMonth(m => m - 1); }
  function nextMonth() { viewMonth === 11 ? (setViewYear(y => y + 1), setViewMonth(0)) : setViewMonth(m => m + 1); }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();

  // The effective range-end for hover preview
  const highlightEnd: Date | null = (step === "to" && hovered) ? parseLocal(hovered) : toDate;

  function getDayInfo(day: number) {
    const date = new Date(viewYear, viewMonth, day);
    const str = toLocalIso(date);
    const dow = date.getDay();

    const isFrom = str === from;
    const effectiveTo = step === "to" && hovered ? hovered : to;
    const isTo = str === effectiveTo;

    const hasRange = !!(fromDate && highlightEnd && fromDate < highlightEnd);
    const inBand = hasRange ? date > fromDate! && date < highlightEnd! : false;

    const disabled =
      (!!maxDate && date > maxDate) ||
      (step === "to" && !!from && str < from);

    const isToday = str === toLocalIso(today);
    const isRowStart = dow === 0;
    const isRowEnd = dow === 6;

    return { isFrom, isTo, inBand, hasRange, disabled, isToday, isRowStart, isRowEnd };
  }

  function handleDayClick(day: number) {
    const str = toLocalIso(new Date(viewYear, viewMonth, day));
    if (step === "from") {
      onFromChange(str);
      if (to && str > to) onToChange("");
      setStep("to");
      setHovered(null);
      // Stay open — user now picks "to"
    } else {
      onToChange(str);
      setOpen(false);
      setHovered(null);
    }
  }

  function handleTodayClick() {
    const iso = toLocalIso(today);
    if (maxDate && today > maxDate) return;
    if (step === "from") {
      onFromChange(iso);
      if (to && iso > to) onToChange("");
      setStep("to");
      setHovered(null);
    } else {
      if (!from || iso >= from) {
        onToChange(iso);
        setOpen(false);
        setHovered(null);
      }
    }
  }

  return (
    <div ref={wrapperRef} className="inline-flex items-center gap-2">
      {/* From trigger */}
      <button type="button" onClick={() => openCalendar("from")}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary min-w-[120px] ${
          open && step === "from" ? "border-primary bg-primary/5 text-foreground" : "border-border bg-background hover:bg-muted/50"
        }`}
      >
        <CalendarDays className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className={from ? "text-foreground" : "text-muted-foreground"}>
          {fmtShort(from) ?? "Start date"}
        </span>
      </button>

      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />

      {/* To trigger */}
      <button type="button" onClick={() => openCalendar(from ? "to" : "from")}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary min-w-[120px] ${
          open && step === "to" ? "border-primary bg-primary/5 text-foreground" : "border-border bg-background hover:bg-muted/50"
        }`}
      >
        <CalendarDays className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className={to ? "text-foreground" : "text-muted-foreground"}>
          {fmtShort(to) ?? "End date"}
        </span>
      </button>

      {open && createPortal(
        <div ref={calRef} style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-72 rounded-xl border border-border bg-card shadow-2xl p-3.5 select-none">

          {/* Step indicator */}
          <div className="flex items-center gap-1.5 mb-3 pb-2.5 border-b border-border/60">
            <button type="button" onClick={() => { setStep("from"); setHovered(null); }}
              className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-colors ${
                step === "from" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className={`h-4 w-4 rounded-full text-[10px] flex items-center justify-center font-bold shrink-0 ${
                step === "from" ? "bg-primary text-primary-foreground" : from ? "bg-primary/30 text-primary" : "bg-muted text-muted-foreground"
              }`}>1</span>
              <span>{fmtShort(from) ?? "Start"}</span>
            </button>

            <div className="flex-1 h-px bg-border mx-0.5" />

            <div className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md ${
              step === "to" ? "bg-primary/10 text-primary" : "text-muted-foreground"
            }`}>
              <span className={`h-4 w-4 rounded-full text-[10px] flex items-center justify-center font-bold shrink-0 ${
                step === "to" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>2</span>
              <span>{fmtShort(to) ?? "End"}</span>
            </div>
          </div>

          {/* Month navigation */}
          <div className="flex items-center justify-between mb-1.5">
            <button type="button" onClick={prevMonth} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-sm font-semibold tracking-tight">{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-0.5">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground/60 py-1">{d}</div>
            ))}
          </div>

          {/* Day grid — no row gap so the range band is seamless */}
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDow }, (_, i) => <div key={`p${i}`} className="h-9" />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const { isFrom, isTo, inBand, hasRange, disabled, isToday, isRowStart, isRowEnd } = getDayInfo(day);
              const isEndpoint = isFrom || isTo;

              return (
                <div key={day} className="relative h-9"
                  onMouseEnter={() => { if (!disabled && step === "to") setHovered(toLocalIso(new Date(viewYear, viewMonth, day))); }}
                  onMouseLeave={() => setHovered(null)}
                >
                  {/* Range band: right half only at "from" endpoint */}
                  {isFrom && hasRange && !isTo && (
                    <div className="absolute left-1/2 right-0 top-[5px] bottom-[5px] bg-primary/12" />
                  )}
                  {/* Range band: left half only at "to" endpoint */}
                  {isTo && hasRange && !isFrom && (
                    <div className="absolute right-1/2 left-0 top-[5px] bottom-[5px] bg-primary/12" />
                  )}
                  {/* Range band: full width for mid-range days, rounded at row edges */}
                  {inBand && (
                    <div className={`absolute inset-x-0 top-[5px] bottom-[5px] bg-primary/12 ${isRowStart ? "rounded-l-full" : ""} ${isRowEnd ? "rounded-r-full" : ""}`} />
                  )}

                  <button type="button" disabled={!!disabled}
                    onClick={() => { if (!disabled) handleDayClick(day); }}
                    className={`relative z-10 h-9 w-full flex items-center justify-center text-xs font-medium transition-colors ${
                      disabled ? "cursor-not-allowed" : "cursor-pointer"
                    }`}
                  >
                    {/* Endpoint filled circle */}
                    {isEndpoint && (
                      <span className="absolute h-8 w-8 rounded-full bg-primary shadow-sm" />
                    )}
                    {/* Today ring (behind endpoint if both) */}
                    {isToday && !isEndpoint && (
                      <span className="absolute h-8 w-8 rounded-full ring-1 ring-inset ring-primary/40 bg-muted/40" />
                    )}
                    <span className={`relative z-10 ${
                      isEndpoint ? "text-primary-foreground font-semibold"
                      : disabled ? "text-muted-foreground/30"
                      : isToday ? "text-foreground"
                      : "text-foreground"
                    }`}>
                      {day}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-2 pt-2 border-t border-border/60 flex items-center justify-between gap-2">
            <button type="button" onClick={handleTodayClick}
              className="flex-1 rounded-lg py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              Today
            </button>
            {step === "to" && (
              <button type="button" onClick={() => { setStep("from"); setHovered(null); }}
                className="flex-1 rounded-lg py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                ← Back
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
