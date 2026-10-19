import { NextRequest, NextResponse } from "next/server";
import { getSchema, validateSupabaseUri } from "@/lib/database";
import { readSession, saveSession, verifySameOrigin } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(req: NextRequest) {
  if (!verifySameOrigin(req)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const body = await req.json();
    if (typeof body.uri !== "string") return NextResponse.json({ error: "Add the PostgreSQL connection string." }, { status: 400 });
    const session = await readSession();
    const selected = typeof body.projectRef === "string" ? session?.projects?.find((p) => p.id === body.projectRef) : undefined;
    if (session?.projects?.length && !selected) return NextResponse.json({ error: "Select a project that you authorized through Supabase." }, { status: 400 });
    const connection = validateSupabaseUri(body.uri, selected?.id);
    const schema = await getSchema(connection.url);
    if (!schema.length) throw new Error("No accessible tables were found in the public schema. Grant SELECT privileges to a read-only database role.");
    const projectName = selected?.name || "Supabase project";
    const response = NextResponse.json({ connected: true, projectName, tables: schema.length });
    saveSession(response, { dbUrl: connection.url, projectRef: connection.ref, projectName });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed.";
    const safe = /connection string|Supabase|database username|password are required|SSL must|public schema|Only standard|project|pooler|extra connection|PostgreSQL/i.test(message);
    return NextResponse.json({ error: safe ? message : "Could not connect. Check your database password, read-only role, pooler host, and network access." }, { status: 400 });
  }
}
