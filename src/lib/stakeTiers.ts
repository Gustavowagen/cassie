export type Tier = "low" | "medium" | "high";
export type ChipDef = { value: number; ring: string; face: string; text: string };

export const CHIPS_LOW: ChipDef[] = [
  { value: 0.1,  ring: "#374151", face: "#6b7280", text: "#f9fafb" },
  { value: 0.5,  ring: "#831843", face: "#be185d", text: "#fce7f3" },
  { value: 1,    ring: "#1e3a8a", face: "#2563eb", text: "#dbeafe" },
  { value: 5,    ring: "#7f1d1d", face: "#b91c1c", text: "#fee2e2" },
];

export const CHIPS_MEDIUM: ChipDef[] = [
  { value: 25,   ring: "#14532d", face: "#16a34a", text: "#dcfce7" },
  { value: 100,  ring: "#1f2937", face: "#374151", text: "#f3f4f6" },
  { value: 500,  ring: "#7f1d1d", face: "#b91c1c", text: "#fee2e2" },
  { value: 1000, ring: "#1e3a8a", face: "#2563eb", text: "#dbeafe" },
];

export const CHIPS_HIGH: ChipDef[] = [
  { value: 5000,   ring: "#3b0764", face: "#7c3aed", text: "#ede9fe" },
  { value: 25000,  ring: "#78350f", face: "#d97706", text: "#fef3c7" },
  { value: 100000, ring: "#0f172a", face: "#1e293b", text: "#e2e8f0" },
  { value: 1000000, ring: "#713f12", face: "#ca8a04", text: "#fefce8" },
];

export const CHIPS_BY_TIER: Record<Tier, ChipDef[]> = {
  low: CHIPS_LOW,
  medium: CHIPS_MEDIUM,
  high: CHIPS_HIGH,
};

export const TIER_LABELS: Record<Tier, string> = { low: "Low", medium: "Mid", high: "High" };

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatChipLabel(value: number): string {
  if (value < 1) return value.toString();
  if (value >= 1_000_000) return `${value / 1_000_000}M`;
  if (value >= 1_000) return `${value / 1_000}K`;
  return value.toString();
}
