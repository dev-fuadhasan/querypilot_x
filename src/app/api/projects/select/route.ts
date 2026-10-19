import { NextRequest, NextResponse } from "next/server";
import { ensureOAuthSession, getOAuthSchema } from "@/lib/management";
import { readSession, saveSession, verifySameOrigin } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 45;
export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const body: unknown = await request.json();
    const ref = (body as { projectRef?: unknown })?.projectRef;
    const existing = await readSession();
    if (!existing || existing.mode !== "oauth" || typeof ref !== "string") {
      return NextResponse.json({ error: "Authorize Supabase before selecting a project." }, { status: 401 });
    }
    const selected = existing.projects?.find((project) => project.id === ref);
    if (!selected) return NextResponse.json({ error: "This project was not authorized by Supabase." }, { status: 403 });
    const current = await ensureOAuthSession(existing);
    const connected = { ...current.session, projectRef: selected.id, projectName: selected.name };
    const schema = await getOAuthSchema(connected);
    if (!schema.length) {
      return NextResponse.json({ error: "No readable tables in public, or Supabase's beta query endpoint cannot access the database. Use manual read-only connection." }, { status: 400 });
    }
    const response = NextResponse.json({ connected: true, projectName: selected.name, tables: schema.length });
    saveSession(response, connected);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to connect this project." }, { status: 400 });
  }
}
