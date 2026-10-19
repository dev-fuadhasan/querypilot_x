import { NextResponse } from "next/server";
import { executeQuery, getSchema } from "@/lib/database";
import { ensureOAuthSession, getOAuthSchema, managementReadOnly } from "@/lib/management";
import { inspectProject } from "@/lib/intelligence";
import { readSession, saveSession } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET() {
  const existing = await readSession();
  if (!existing || !(existing.dbUrl || (existing.mode === "oauth" && existing.projectRef))) {
    return NextResponse.json({ error: "Connect a project to see verified suggestions." }, { status: 401 });
  }
  try {
    const access = existing.mode === "oauth"
      ? await ensureOAuthSession(existing)
      : { session: existing, refreshed: false };
    const active = access.session;
    const schema = active.mode === "oauth" ? await getOAuthSchema(active) : await getSchema(active.dbUrl || "");
    if (!schema.length) return NextResponse.json({ starters: [], tables: [], catalog: [], note: "No readable public tables." });
    const profile = await inspectProject(schema, async sql => active.mode === "oauth"
      ? await managementReadOnly(active, sql)
      : (await executeQuery(active.dbUrl || "", sql)).rows);
    const response = NextResponse.json({
      ...profile,
      catalog: schema.map(table => ({ name: table.name, columns: table.columns.length }))
    }, { headers: { "Cache-Control": "private, no-store" } });
    if (access.refreshed) {
      const { issuedAt: _previous, ...current } = active;
      saveSession(response, current);
    }
    return response;
  } catch {
    return NextResponse.json({
      starters: [], tables: [], catalog: [], note: "Could not inspect tables. Please refresh the connection or check read-only access."
    }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
