import { NextRequest, NextResponse } from "next/server";
import { clearSession, verifySameOrigin } from "@/lib/session";

export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  if (!verifySameOrigin(req)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const response = NextResponse.json({ disconnected: true });
  clearSession(response);
  return response;
}
