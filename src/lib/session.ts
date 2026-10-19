import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export type Project = { id: string; name: string };
export type Session = {
  mode?: "oauth" | "postgres";
  dbUrl?: string;
  projectName?: string;
  projectRef?: string;
  projects?: Project[];
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  issuedAt: number;
};
export type OAuthState = { state: string; verifier: string; issuedAt: number };
const SESSION_COOKIE = "qp_session";
const OAUTH_COOKIE = "qp_oauth";
function secretKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return scryptSync(secret, "querypilot-x-session-v1", 32);
}
function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const content = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString("base64url");
}
function unseal<T>(encrypted?: string): T | null {
  if (!encrypted) return null;
  try {
    const bytes = Buffer.from(encrypted, "base64url");
    if (bytes.length < 30) return null;
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch { return null; }
}
export async function readSession(): Promise<Session | null> {
  const jar = await cookies();
  const session = unseal<Session>(jar.get(SESSION_COOKIE)?.value);
  if (!session || !session.issuedAt || Date.now() - session.issuedAt > 7 * 86400000) return null;
  return session;
}
export async function readOAuthState(): Promise<OAuthState | null> {
  const jar = await cookies();
  const item = unseal<OAuthState>(jar.get(OAUTH_COOKIE)?.value);
  if (!item || Date.now() - item.issuedAt > 10 * 60000) return null;
  return item;
}
function options(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}
export function saveSession(response: NextResponse, details: Omit<Session, "issuedAt">) {
  const encrypted = seal({ ...details, issuedAt: Date.now() });
  // Most browsers enforce a 4096-byte cookie limit. Avoid silently writing a broken session.
  if (encrypted.length > 3700) throw new Error("Too many Supabase projects for a browser session. Select fewer projects.");
  response.cookies.set(SESSION_COOKIE, encrypted, options(7 * 86400));
}
export function saveOAuthState(response: NextResponse, state: OAuthState) {
  response.cookies.set(OAUTH_COOKIE, seal(state), options(600));
}
export function clearOAuthState(response: NextResponse) {
  response.cookies.set(OAUTH_COOKIE, "", options(0));
}
export function clearSession(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", options(0));
}
export function verifySameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const requestUrl = new URL(request.url);
  const allowedOrigin = process.env.APP_URL ? new URL(process.env.APP_URL).origin : requestUrl.origin;
  return origin === allowedOrigin;
}
export function oauthConfigured() {
  return Boolean(process.env.APP_URL && process.env.SUPABASE_OAUTH_CLIENT_ID && process.env.SUPABASE_OAUTH_CLIENT_SECRET);
}
export function aiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY);
}
