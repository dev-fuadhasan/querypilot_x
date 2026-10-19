import { NextRequest, NextResponse } from "next/server";
import { clearOAuthState, readOAuthState, saveSession } from "@/lib/session";
import { exchangeOAuth, listProjects } from "@/lib/management";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const base = process.env.APP_URL || req.nextUrl.origin;
  function fail(reason: string) {
    const response = NextResponse.redirect(new URL("/?error=" + encodeURIComponent(reason), base));
    clearOAuthState(response);
    return response;
  }
  if (req.nextUrl.searchParams.has("error")) return fail("Supabase authorization was cancelled.");
  const saved = await readOAuthState();
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  if (!saved || !code || saved.state !== state) return fail("Supabase authorization expired. Please try again.");
  try {
    const tokens = await exchangeOAuth(code, saved.verifier, new URL("/api/auth/callback", base).toString());
    const projects = await listProjects(tokens.accessToken);
    if (projects.length === 0) return fail("No accessible Supabase projects. Check project authorization.");
    // Authorization alone must never select a project or open the dashboard.
    // Even a single-project organization must explicitly select the intended database.
    const response = NextResponse.redirect(new URL("/?setup=project", base));
    saveSession(response, { mode: "oauth", ...tokens, projects });
    clearOAuthState(response);
    return response;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not complete Supabase authorization.");
  }
}
