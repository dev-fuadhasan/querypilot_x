import { NextRequest, NextResponse } from "next/server";
import { readSession, verifySameOrigin } from "@/lib/session";
import { executeQuery, getSchema } from "@/lib/database";
import { explainResult, planQuestion } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!verifySameOrigin(req)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await readSession();
  if (!session?.dbUrl) return NextResponse.json({ error: "Connect your Supabase database first." }, { status: 401 });
  try {
    const body = await req.json();
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question || question.length > 700) return NextResponse.json({ error: "Ask a question in 700 characters or less." }, { status: 400 });
    // Discovery happens for each question so the AI sees the currently accessible database schema.
    const schema = await getSchema(session.dbUrl);
    if (!schema.length) return NextResponse.json({ error: "No accessible public tables were found." }, { status: 400 });
    const plan = await planQuestion(question, schema);
    if (plan.action === "clarify") {
      return NextResponse.json({
        type: "clarification", question: plan.question, options: plan.options, originalQuestion: question,
      });
    }
    const data = await executeQuery(session.dbUrl, plan.sql || "");
    const report = await explainResult(question, plan.sql || "", data);
    return NextResponse.json({ type: "result", data, report, sql: plan.sql }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "We couldn't complete this query.";
    const safe = /AI service|AI API|AI response|rate.limit|Please|SQL|read.only|SELECT|generated|rephrase|statement|unsupported|configured|network/i.test(message);
    return NextResponse.json({ error: safe ? message : "The database query failed. Check the selected columns, permissions or query definition." }, { status: 400 });
  }
}
