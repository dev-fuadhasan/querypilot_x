import type { ChartSpec } from "./charts";
import { formatDisplayValue } from "./format-values.ts";

type Column = { name: string; type: "number" | "date" | "text"; numericKind?: "integer" | "decimal" };
type ResultData = { columns: Column[]; rows: Record<string, unknown>[] };
export type BarRow = { label: string; value: number; percentageOfScale: number; formatted: string };
export type BarDisplay = {
  rows: BarRow[];
  ticks: { value: number; label: string }[];
  isPercentage: boolean;
  axisMaximum: number;
  axisLabel: string;
  categoryLabel: string;
  clipped: number;
};
function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function pretty(name: string): string {
  return name.replace(/_/g, " ").replace(/\b[a-z]/g, c => c.toUpperCase());
}
function niceMaximum(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.pow(10, Math.floor(Math.log10(value)));
  const ratio = value / exponent;
  const nice = [1, 2, 2.5, 5, 10].find(option => option >= ratio) || 10;
  return nice * exponent;
}
export function prepareHorizontalBars(data: ResultData, view: ChartSpec): BarDisplay | null {
  if (view.type !== "bar" || view.yKeys.length !== 1 ||
    !data.columns.some(col => col.name === view.xKey) ||
    !data.columns.some(col => col.name === view.yKeys[0])) return null;
  const key = view.yKeys[0];
  const metricColumn = data.columns.find(col => col.name === key);
  const categoryColumn = data.columns.find(col => col.name === view.xKey);
  const valid = data.rows.map(row => {
    const value = numeric(row[key]);
    const label = row[view.xKey];
    if (value === null || value < 0 || label === undefined || label === null) return null;
    return { label: formatDisplayValue(label, categoryColumn), value };
  }).filter((row): row is {label: string;value: number} => row !== null);
  if (!valid.length) return null;
  const largest = Math.max(...valid.map(row => row.value));
  const namedPercent = view.unit === "%" || /(?:percent|percentage|rate_pct|_pct|_percent)$/i.test(key) || /\(\s*%\s*\)/.test(view.yLabel || view.title);
  const isPercentage = namedPercent && largest <= 100;
  const axisMaximum = isPercentage ? 100 : niceMaximum(largest);
  const visible = valid.slice(0, 20);
  const formatValue = (value: number) =>
    formatDisplayValue(value, metricColumn) +
    (isPercentage ? "%" : "");
  return {
    rows: visible.map(row => ({
      ...row, percentageOfScale: Math.max(0, Math.min(100, row.value / axisMaximum * 100)),
      formatted: formatValue(row.value)
    })),
    ticks: [0, 0.25, 0.5, 0.75, 1].map(part => ({
      value: axisMaximum * part,
      label: isPercentage ? String(Math.round(100 * part)) + "%" :
        new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, notation: axisMaximum >= 10000 ? "compact" : "standard" }).format(axisMaximum * part)
    })),
    isPercentage, axisMaximum,
    axisLabel: view.yLabel || (isPercentage ? "Rate (%)" : pretty(key)),
    categoryLabel: view.xLabel || pretty(view.xKey),
    clipped: Math.max(0, valid.length - visible.length)
  };
}
export type RateHighlights = {
  higher: { label: string; rate: string; total: number; positive: number };
  lower: { label: string; rate: string; total: number; positive: number };
  difference: string;
  total: number;
};
export function rateHighlights(data: ResultData): RateHighlights | null {
  const cols = new Set(data.columns.map(c => c.name));
  if (![ "group_name", "total", "positive", "rate_pct" ].every(key => cols.has(key))) return null;
  const values = data.rows.flatMap(row => {
    const rate = numeric(row.rate_pct);
    const total = numeric(row.total);
    const positive = numeric(row.positive);
    if (rate === null || total === null || positive === null || rate < 0 || rate > 100 ||
      !Number.isInteger(total) || !Number.isInteger(positive) || positive > total ||
      typeof row.group_name !== "string") return [];
    return [{ label: row.group_name, rate, total, positive }];
  }).sort((a,b) => b.rate - a.rate);
  if (values.length < 2) return null;
  const highest = values[0], lowest = values[values.length - 1];
  return {
    higher: { label: highest.label, rate: highest.rate.toFixed(2) + "%", total: highest.total, positive: highest.positive },
    lower: { label: lowest.label, rate: lowest.rate.toFixed(2) + "%", total: lowest.total, positive: lowest.positive },
    difference: (highest.rate - lowest.rate).toFixed(2) + " pp",
    total: values.reduce((sum, item) => sum + item.total, 0)
  };
}
