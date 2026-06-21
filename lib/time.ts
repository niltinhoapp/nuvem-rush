// Utilitarios de tempo (puros, sem dependencias externas).
import type { DelayUnit } from "@/types";

const MS: Record<DelayUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export function delayToMs(d: { value: number; unit: DelayUnit }): number {
  return d.value * MS[d.unit];
}
