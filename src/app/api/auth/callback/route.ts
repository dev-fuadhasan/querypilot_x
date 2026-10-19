import { NextRequest, NextResponse } from "next/server";
import { clearOAuthState, readOAuthState, saveSession } from "@/lib/session";

export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL || req.nextUrl.origin;
  const failure = (error: string) => {
    const result = NextResponse.redirect(new URL("/?error=" + encodeURIComponent(error), appUrl));
    clearOAuthState(result);
    return result;
  };
  if (req.nextUrl.searchParams.has("error")) return failure("Supabase authorization was cancelled.");
  const authorization = await readOAuthState();
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  if (!authorization || !state || state !== authorization.state || !code) return failure("Supabase authorization expired. Please try again.");
  const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return failure("Supabase OAuth is not configured.");
  const callback = new URL("/api/auth/callback", appUrl).toString();
  try {
    const tokenResponse = await fetch("https://api.supabase.com/v1/oauth/token", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64"),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: callback,
        code_verifier: authorization.verifier,
      }),
    });
    if (!tokenResponse.ok) return failure("Supabase could not authorize this application.");
    const tokens = await tokenResponse.json();
    if (typeof tokens.access_token !== "string") return failure("Supabase returned no authorization token.");
    const projectsResponse = await fetch("https://api.supabase.com/v1/projects", {
      headers: { Authorization: "Bearer " + tokens.access_token },
      cache: "no-store",
    });
    if (!projectsResponse.ok) return failure("Could not list Supabase projects. Check the integration scopes.");
    const projectsData: unknown = await projectsResponse.json();
    const projectList = Array.isArray(projectsData) ? projectsData : [];
    const projects = projectList.slice(0, 25)
      .filter((project): project is { id: string; name: string } =>
        Boolean(project && typeof project.id === "string" && typeof project.name === "string"))
      .map((project) => ({ id: project.id, name: project.name.slice(0, 90) }));
    if (projects.length === 0) return failure("No Supabase projects were accessible to the integration.");
    // Drop Management API tokens after discovery; we only need project name and ref.
    const response = NextResponse.redirect(new URL("/?setup=project", appUrl));
    saveSession(response, { projects });
    clearOAuthState(response);
    return response;
  } catch {
    return failure("Could not finish connecting to Supabase. Please try again.");
  }
}
