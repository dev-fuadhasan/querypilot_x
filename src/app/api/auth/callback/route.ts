import { NextRequest, NextResponse } from "next/server";
import { clearOAuthState, readOAuthState, saveSession } from "@/lib/session";
import { exchangeOAuth, getOAuthSchema, listProjects } from "@/lib/management";

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
    // Automatically connect a single project only after verifying read-only query access.
    let selected: { projectRef?: string; projectName?: string } = {};
    if (projects.length === 1) {
      try {
        const probe = await getOAuthSchema({ mode: "oauth", ...tokens, projectRef: projects[0].id, issuedAt: Date.now() });
        if (!probe.length) throw new Error("No accessible public tables.");
        selected = { projectRef: projects[0].id, projectName: projects[0].name };
      } catch {
        // Keep project authorized, show selector and allow manual read-only fallback.
      }
    }
    const response = NextResponse.redirect(new URL(selected.projectRef ? "/?connected=1" : "/?setup=project", base));
    saveSession(response, { mode: "oauth", ...tokens, projects, ...selected });
    clearOAuthState(response);
    return response;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not complete Supabase authorization.");
  }
}
