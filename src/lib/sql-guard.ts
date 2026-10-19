import { parse } from "pgsql-ast-parser";

export class SqlValidationError extends Error {
  constructor(message: string) { super(message); this.name = "SqlValidationError"; }
}
// Normalize formatting, SQL comments and terminating semicolons without
// confusing punctuation inside ordinary quoted data with new statements.
export function normalizeAndGuardSql(raw: string): string {
  let sql = raw.trim();
  const fenced = /^\x60{3}(?:sql|postgresql|postgres)?[ \t]*\r?\n([\s\S]*?)\r?\n\x60{3}$/i.exec(sql);
  if (fenced) sql = fenced[1].trim();
  if (!sql || sql.length > 8000) throw new SqlValidationError("The generated SQL was empty or too long.");
  let output = "";
  let masked = "";
  let state: "normal" | "single" | "double" | "line" | "block" = "normal";
  const semicolons: number[] = [];
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (state === "single") {
      output += c; masked += c === "\n" ? "\n" : " ";
      if (c === "'" && next === "'") { output += next; masked += " "; i++; }
      else if (c === "'") state = "normal";
      continue;
    }
    if (state === "double") {
      output += c; masked += " ";
      if (c === '"' && next === '"') { output += next; masked += " "; i++; }
      else if (c === '"') state = "normal";
      continue;
    }
    if (state === "line") {
      if (c === "\n") { output += "\n"; masked += "\n"; state = "normal"; }
      else { output += " "; masked += " "; }
      continue;
    }
    if (state === "block") {
      if (c === "*" && next === "/") { output += "  "; masked += "  "; i++; state = "normal"; }
      else { const char = c === "\n" ? "\n" : " "; output += char; masked += char; }
      continue;
    }
    if (c === "'") { state = "single"; output += c; masked += " "; continue; }
    if (c === '"') { state = "double"; output += c; masked += " "; continue; }
    if (c === "-" && next === "-") { state = "line"; output += "  "; masked += "  "; i++; continue; }
    if (c === "/" && next === "*") { state = "block"; output += "  "; masked += "  "; i++; continue; }
    if (c === "$" && (next === "$" || /^\$[A-Za-z_][A-Za-z_0-9]*\$/.test(sql.slice(i))))
      throw new SqlValidationError("Dollar-quoted SQL literals are not supported in generated queries.");
    if (c === ";") semicolons.push(output.length);
    output += c; masked += c;
  }
  if (state === "single" || state === "double" || state === "block")
    throw new SqlValidationError("SQL contains an unterminated quoted value or comment.");
  output = output.trim(); masked = masked.trim();
  if (!output) throw new SqlValidationError("No SQL statement was generated.");
  if (semicolons.length) {
    if (semicolons.length > 1 || masked.lastIndexOf(";") !== masked.length - 1)
      throw new SqlValidationError("Only one read-only SQL statement is supported.");
    output = output.slice(0, -1).trim(); masked = masked.slice(0, -1).trim();
  }
  if (!/^(select|with)\b/i.test(masked)) throw new SqlValidationError("Only SELECT queries are allowed.");
  if (/\b(insert|update|delete|drop|create|alter|truncate|grant|revoke|execute|call|copy|vacuum|analyze|set|reset|show|lock|into|merge|pg_sleep|dblink|lo_export|pg_read_file|pg_ls_dir)\b/i.test(masked))
    throw new SqlValidationError("The query contains an unsupported database operation.");
  if (/\b(pg_catalog|information_schema|auth|storage|vault|extensions|realtime|graphql|supabase_functions)\s*\./i.test(masked))
    throw new SqlValidationError("Only the approved public schema can be queried.");
  let parsed: ReturnType<typeof parse>;
  try { parsed = parse(output); }
  catch { throw new SqlValidationError("SQL syntax could not be validated. QueryPilot will try to repair the SQL."); }
  // pgsql-ast-parser represents a SELECT using WITH CTEs as type "with".
  // All write statements, extra statements and unsafe schemas were rejected above.
  if (parsed.length !== 1 || !["select", "with"].includes(parsed[0]?.type))
    throw new SqlValidationError("Only a single read-only SELECT is supported.");
  return output;
}
