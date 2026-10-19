import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";

export const runtime = "nodejs";
export async function GET() {
  const session = await readSession();
  return NextResponse.json({
    connected: Boolean(session?.dbUrl),
    projectName: session?.projectName || "",
    projects: session?.projects || [],
    oauthEnabled: Boolean(process.env.SUPABASE_OAUTH_CLIENT_ID && process.env.SUPABASE_OAUTH_CLIENT_SECRET && process.env.APP_URL),
    configured: Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32),
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
  }, { headers: { "Cache-Control": "no-store" } });
}
