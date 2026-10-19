import { NextResponse } from "next/server";
import { aiConfigured, oauthConfigured, readSession } from "@/lib/session";
import { selectedProvider } from "@/lib/ai";

export const runtime = "nodejs";
export async function GET() {
  const session = await readSession();
  return NextResponse.json({
    connected: Boolean(session?.dbUrl || (session?.mode === "oauth" && session?.projectRef && session?.accessToken)),
    projectName: session?.projectName || "",
    projectRef: session?.projectRef || "",
    projects: session?.mode === "oauth" ? (session.projects || []) : [],
    mode: session?.mode || null,
    oauthEnabled: oauthConfigured(),
    configured: Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32),
    aiConfigured: aiConfigured(),
    aiProvider: selectedProvider(),
  }, { headers: { "Cache-Control": "no-store" } });
}
