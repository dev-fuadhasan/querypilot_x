// Pure chart selection shared by server and client; no database or model dependencies.
export const CHART_TYPES = ["line", "column", "bar", "pie", "donut", "area", "scatter", "radar", "heatmap", "card", "stacked-column", "combo"] as const;
export type ChartKind = typeof CHART_TYPES[number];
export type ChartSpec = { type: ChartKind; title: string; xKey: string; yKeys: string[] };
export type ChartData = {
  columns: { name: string; type: "number" | "date" | "text" }[];
  rows: Record<string, unknown>[];
};
const aliases: { type: ChartKind; pattern: RegExp }[] = [
  { type: "stacked-column", pattern: /\b(stacked\s+(?:column|bar|chart)|stacked)\b/i },
  { type: "combo", pattern: /\b(combination|combo|mixed)\s*(?:chart|graph)?\b/i },
  { type: "heatmap", pattern: /\bheat[\s-]?map\b/i },
  { type: "donut", pattern: /\b(donut|doughnut)\b/i },
  { type: "scatter", pattern: /\bscatter(?:plot| chart| graph)?\b/i },
  { type: "radar", pattern: /\b(radar|spider)\s*(?:chart|plot|graph)?\b/i },
  { type: "line", pattern: /\b(line|trend)\s*(?:chart|graph|plot|diagram)\b|\bplot\s+(?:a\s+)?line\b|\bline\s+(?:and|&)\s+(?:pie|bar|column)\b/i },
  { type: "pie", pattern: /\bpie\s*(?:chart|graph|plot)?\b/i },
  { type: "area", pattern: /\barea\s*(?:chart|graph|plot)\b/i },
  { type: "column", pattern: /\b(column|vertical\s+bar)\s*(?:chart|graph|plot)?\b/i },
  { type: "bar", pattern: /\b(horizontal\s+bar|bar)\s*(?:chart|graph|plot)?\b/i },
  { type: "card", pattern: /\b(kpi|metric|statistic|summary)\s*(?:card|tile|dashboard)?s?\b|\bcards?\b/i },
];
export function requestedChartTypes(question: string): ChartKind[] {
  const matches = aliases.flatMap(({ type, pattern }) => {
    const index = question.search(pattern);
    return index < 0 ? [] : [{ type, index }];
  }).sort((a, b) => a.index - b.index);
  const kinds: ChartKind[] = [];
  for (const item of matches) {
    if (item.type === "bar" && kinds.includes("stacked-column")) continue;
    if (item.type === "column" && kinds.includes("stacked-column")) continue;
    if (!kinds.includes(item.type)) kinds.push(item.type);
  }
  return kinds.slice(0, 6);
}
export function wantsMultipleCharts(question: string): boolean {
  return /\b(multiple|several|different|various|dashboard|more than one|more charts|all chart types)\b/i.test(question);
}
export function isNumerical(value: unknown): boolean {
  return typeof value === "number" ? Number.isFinite(value)
    : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}
function isPositive(data: ChartData, key: string): boolean {
  return data.rows.some(row => isNumerical(row[key]) && Number(row[key]) > 0)
    && data.rows.every(row => !isNumerical(row[key]) || Number(row[key]) >= 0);
}
const chartLabel = (kind: ChartKind) => kind.split("-").map(part => part[0].toUpperCase() + part.slice(1)).join(" ") + (kind === "card" ? "s" : " chart");
export function buildDashboardCharts(
  question: string,
  data: ChartData,
  suggestions: ChartSpec[] = []
): ChartSpec[] {
  const available = new Set(data.columns.map(col => col.name));
  const numeric = data.columns.filter(col => col.type === "number" || data.rows.some(row => isNumerical(row[col.name]) && row[col.name] !== null))
    .map(col => col.name);
  const categorical = data.columns.filter(col => !numeric.includes(col.name)).map(col => col.name);
  const preferredX = [...data.columns].sort((a,b) =>
    (a.type === "date" ? -2 : a.type === "text" ? -1 : 0) - (b.type === "date" ? -2 : b.type === "text" ? -1 : 0)
  )[0]?.name || "";
  const explicit = requestedChartTypes(question);
  const desired: ChartKind[] = explicit.length ? explicit : suggestions
    .map(s => s.type).filter(t => CHART_TYPES.includes(t));
  if (!desired.length && data.rows.length > 1 && numeric.length) {
    desired.push("column");
    if (wantsMultipleCharts(question)) desired.push("line", "pie", "heatmap");
  }
  if (wantsMultipleCharts(question) && desired.length < 2 && numeric.length && data.rows.length > 1) {
    for (const kind of ["column", "line", "donut", "heatmap"] as ChartKind[]) {
      if (!desired.includes(kind)) desired.push(kind);
      if (desired.length >= 4) break;
    }
  }
  const specs: ChartSpec[] = [];
  for (const kind of desired.slice(0, 6)) {
    if (!numeric.length || !data.rows.length) continue;
    const candidate = suggestions.find(s => s.type === kind && available.has(s.xKey) &&
      s.yKeys.some(y => numeric.includes(y)));
    let xKey = candidate?.xKey || categorical[0] || preferredX;
    let yKeys = (candidate?.yKeys || numeric).filter(k => numeric.includes(k) && k !== xKey).slice(0, 3);
    if (kind === "scatter") {
      if (numeric.length < 2 || data.rows.length < 2) continue;
      xKey = numeric[0];
      yKeys = [numeric[1]];
    } else if (kind === "card") {
      xKey = categorical[0] || numeric[0];
      yKeys = numeric.filter(key => key !== xKey).slice(0, 4);
      if (!yKeys.length) yKeys = [numeric[0]];
    } else if (kind === "pie" || kind === "donut" || kind === "radar") {
      if (data.rows.length < 2) continue;
      if (!categorical.length) continue;
      xKey = categorical[0];
      yKeys = numeric.filter(k => k !== xKey && isPositive(data, k)).slice(0, kind === "radar" ? 2 : 1);
    } else if (data.rows.length < 2) {
      continue;
    }
    if (!yKeys.length || !xKey) continue;
    if (kind === "combo" && yKeys.length < 2) continue;
    if (kind === "stacked-column" && yKeys.length < 2) continue;
    if (specs.some(spec => spec.type === kind)) continue;
    specs.push({ type: kind, title: candidate?.title || chartLabel(kind), xKey, yKeys });
  }
  return specs.slice(0, 6);
}
