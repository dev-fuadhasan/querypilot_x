import { NextRequest, NextResponse } from "next/server";
import { getSchema, validateSupabaseUri } from "@/lib/database";
import { readSession, saveSession, verifySameOrigin } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(req: NextRequest) {
  if (!verifySameOrigin(req)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const body: unknown = await req.json();
    const args = body as { uri?: unknown; projectRef?: unknown };
    if (typeof args?.uri !== "string") return NextResponse.json({ error: "Add a PostgreSQL connection string." }, { status: 400 });
    const session = await readSession();
    const selected = typeof args.projectRef === "string" ? session?.projects?.find((p) => p.id === args.projectRef) : undefined;
    const connection = validateSupabaseUri(args.uri, selected?.id);
    const schema = await getSchema(connection.url);
    if (!schema.length) throw new Error("No accessible tables found in public. Create a read-only database role with SELECT access.");
    const projectName = selected?.name || "Supabase project";
    const response = NextResponse.json({ connected: true, projectName, tables: schema.length });
    saveSession(response, { mode: "postgres", dbUrl: connection.url, projectRef: connection.ref, projectName });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed.";
    const safe = /connection string|Supabase|database username|password are required|SSL must|public|Only standard|project|pooler|extra connection|PostgreSQL/i.test(message);
    return NextResponse.json({
      error: safe ? message : "Could not connect. Check your connection string, read-only role and database network access.",
    }, { status: 400 });
  }
}
