import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { saveOAuthState } from "@/lib/session";

export const runtime = "nodejs";
export async function GET() {
  const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) return NextResponse.redirect(new URL("/?setup=manual", appUrl || "http://localhost:3000"));
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const callback = new URL("/api/auth/callback", appUrl).toString();
  const url = new URL("https://api.supabase.com/v1/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  const response = NextResponse.redirect(url);
  saveOAuthState(response, { state, verifier, issuedAt: Date.now() });
  return response;
}
