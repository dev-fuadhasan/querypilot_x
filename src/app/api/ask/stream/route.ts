import { NextRequest, NextResponse } from "next/server";
import { executeQuery, getSchema, guardSql } from "@/lib/database";
import { executeOAuthQuery, ensureOAuthSession, getOAuthSchema, managementReadOnly, SupabaseQueryError } from "@/lib/management";
import { readSession, saveSession, verifySameOrigin } from "@/lib/session";
import { explainResult, planQuestion, repairQuestion } from "@/lib/ai";
import { enrichSchemaWithExamples } from "@/lib/profiles";
import type { TableInfo } from "@/lib/database";

export const runtime = "nodejs";
export const maxDuration = 60;
type StreamEvent =
  | { type: "stage"; stage: "schema" | "planning" | "validated" | "executing" | "report"; detail: string; sql?: string }
  | { type: "clarification"; question: string; options: string[]; originalQuestion: string }
  | { type: "result"; data: Awaited<ReturnType<typeof executeQuery>>; report: Awaited<ReturnType<typeof explainResult>>; sql: string }
  | { type: "error"; error: string };

function enforceTables(sql: string, schema: TableInfo[]) {
  const allowed = new Set(schema.map((t) => t.name.toLowerCase()));
  const ctes = new Set([...sql.matchAll(/\b(?:with|,)\s*(\w+)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()));
  const refs = [...sql.matchAll(/\b(?:from|join)\s+(?:(?:public|"public")\.)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi)];
  if (!refs.length) return;
  for (const ref of refs) {
    const table = (ref[1] || ref[2]).toLowerCase();
    if (!allowed.has(table) && !ctes.has(table)) throw new Error("Generated SQL references an unapproved table.");
  }
}
export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await readSession();
  if (!session || !(session.dbUrl || (session.mode === "oauth" && session.projectRef)))
    return NextResponse.json({ error: "Connect a Supabase database first." }, { status: 401 });
  let question = "";
  try {
    const body: unknown = await request.json();
    question = typeof (body as { question?: unknown })?.question === "string" ? String((body as { question: string }).question).trim() : "";
  } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!question || question.length > 900) return NextResponse.json({ error: "Ask a question in 900 characters or less." }, { status: 400 });
  let active = session;
  let refreshed = false;
  try {
    if (session.mode === "oauth") {
      const result = await ensureOAuthSession(session);
      active = result.session;
      refreshed = result.refreshed;
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Supabase authorization expired." }, { status: 401 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: StreamEvent) => {
        if (closed || request.signal.aborted) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); }
        catch { closed = true; }
      };
      try {
        send({ type: "stage", stage: "schema", detail: "Inspecting approved database tables and columns" });
        const discovered = active.mode === "oauth" ? await getOAuthSchema(active) : await getSchema(active.dbUrl || "");
        if (!discovered.length) throw new Error("No readable public tables were found in the connected project.");
        const schema = await enrichSchemaWithExamples(discovered, async (sql) => {
          if (active.mode === "oauth") return managementReadOnly(active, sql);
          return (await executeQuery(active.dbUrl || "", sql)).rows;
        });
        send({ type: "stage", stage: "planning", detail: "Understanding your question and generating PostgreSQL" });
        const planned = await planQuestion(question, schema);
        if (planned.action === "clarify") {
          send({ type: "clarification", question: planned.question || "Could you clarify?", options: planned.options || [], originalQuestion: question });
          return;
        }
        let sql = guardSql(planned.sql || "");
        enforceTables(sql, schema);
        let data: Awaited<ReturnType<typeof executeQuery>> | undefined;
        let repaired = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          send({ type: "stage", stage: "validated", detail: repaired ? "Validating corrected SQL against the approved schema" : "Validating SELECT-only SQL against the approved schema", sql });
          send({ type: "stage", stage: "executing", detail: repaired ? "Retrying SQL execution against Supabase" : "Executing against your Supabase database", sql });
          try {
            data = active.mode === "oauth" ? await executeOAuthQuery(active, sql) : await executeQuery(active.dbUrl || "", sql);
            break;
          } catch (error) {
            if (attempt !== 0 || !(error instanceof SupabaseQueryError) || !error.repairable) {
              throw error;
            }
            repaired = true;
            send({ type: "stage", stage: "planning", detail: "Supabase rejected the SQL. Generating one safe correction" });
            const proposed = await repairQuestion(question, sql, error.message, schema);
            sql = guardSql(proposed);
            enforceTables(sql, schema);
          }
        }
        if (!data) throw new Error("Database query did not return a result.");
        send({ type: "stage", stage: "report", detail: "Building visuals and checking evidence for the analysis report", sql });
        const report = await explainResult(question, sql, data);
        send({ type: "result", data, report, sql });
      } catch (err) {
        const message = err instanceof Error ? err.message : "The analysis could not be completed.";
        const known = /SQL|read.only|Supabase|public|SELECT|AI |query|database|tables|model|API key|rate.limit|provider|schema|authorization|connect/i.test(message);
        send({ type: "error", error: known ? message : "The analysis failed. Check your question and database permissions." });
      } finally {
        if (!closed) try { controller.close(); } catch { /* client disconnected */ }
      }
    },
  });
  const response = new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no",
    },
  });
  if (refreshed) {
    const { issuedAt: _previousTime, ...current } = active;
    saveSession(response, current);
  }
  return response;
}
