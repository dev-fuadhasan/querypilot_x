// Display-only formatting shared by tables, metric cards and chart labels.
// Keep the original query results untouched for SQL, chart calculations and exports.
export type DisplayColumn = {
  name?: string;
  type?: "number" | "date" | "text";
  numericKind?: "integer" | "decimal";
};

const decimals = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const integers = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const NUMERIC_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const IDENTIFIER = /(?:^|_)(?:id|code|sku|zip|postal|phone|serial|version|reference|ref)(?:_|$)/i;

export function formatDisplayValue(value: unknown, column?: DisplayColumn): string {
  if (value === null || value === undefined) return "—";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    const isDecimal = column?.numericKind === "decimal" || !Number.isInteger(value);
    return isDecimal ? decimals.format(value) : integers.format(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!NUMERIC_LITERAL.test(trimmed) || column?.type === "date") return value;

    // PostgreSQL NUMERIC and Supabase's API often serialize decimals as long strings.
    // Integer-like strings may be IDs, so leave them untouched unless typed DECIMAL.
    const hasFraction = /[.eE]/.test(trimmed);
    if (!hasFraction && column?.numericKind !== "decimal") return value;
    if (column?.type === "text" && IDENTIFIER.test(column.name || "")) return value;

    const number = Number(trimmed);
    // Unsafe large numeric strings must not be silently rounded through JS Number.
    if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) return value;
    return decimals.format(number);
  }

  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
