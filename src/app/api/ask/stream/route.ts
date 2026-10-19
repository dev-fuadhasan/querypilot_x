import { NextRequest, NextResponse } from "next/server";
import { executeQuery, getSchema, guardSql } from "@/lib/database";
import { executeOAuthQuery, ensureOAuthSession, getOAuthSchema, managementReadOnly, SupabaseQueryError } from "@/lib/management";
import { readSession, saveSession, verifySameOrigin } from "@/lib/session";
import { explainResult, planQuestion, repairQuestion } from "@/lib/ai";
import { enrichSchemaWithExamples } from "@/lib/profiles";
import type { TableInfo } from "@/lib/database";
import { findExactNumericFilter, numericStatsSql, rangeCountsSql, rangeDefinitions, buildMissingValueClarification } from "@/lib/value-check";
import { inspectProject, isChartOnlyRequest, chartQueryFor, verifiedChoices } from "@/lib/intelligence";
import { requestedChartTypes } from "@/lib/charts";
import type { ChartKind } from "@/lib/charts";

export const runtime = "nodejs";
export const maxDuration = 60;
type StreamEvent =
  | { type: "stage"; stage: "schema" | "checking" | "planning" | "validated" | "executing" | "report"; detail: string; sql?: string }
  | { type: "clarification"; question: string; options: string[]; optionQueries?: string[]; originalQuestion: string; example?: string }
  | { type: "result"; data: Awaited<ReturnType<typeof executeQuery>>; report: Awaited<ReturnType<typeof explainResult>>; sql: string;
      panels?: { kind: ChartKind; title: string; data: Awaited<ReturnType<typeof executeQuery>>; sql: string; xKey: string; yKeys: string[] }[];
      unavailable?: string[] }
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
        const effectiveQuestion = question.startsWith("CUSTOM CLARIFICATION:")
          ? question.split("\nPRIOR REQUEST FOR CONTEXT:")[0] : question;
        const exact = findExactNumericFilter(effectiveQuestion, schema);
        if (exact) {
          send({ type: "stage", stage: "checking", detail: "Checking the requested " + exact.column + " against real database values" });
          const check = async (sql: string) => {
            const approved = guardSql(sql);
            enforceTables(approved, schema);
            return active.mode === "oauth"
              ? managementReadOnly(active, approved)
              : (await executeQuery(active.dbUrl || "", approved)).rows;
          };
          // Never claim a value is absent without a successful database check.
          const stats = (await check(numericStatsSql(exact)))[0];
          if (!stats) throw new Error("The connected dataset did not return numeric-value statistics.");
          if (Number(stats.exact_matches) === 0 && Number(stats.valid_count) > 0) {
            const min = Number(stats.min_value), max = Number(stats.max_value);
            const bands = rangeDefinitions(min, max, exact.value);
            const counts = bands.length ? (await check(rangeCountsSql(exact, bands)))[0] || {} : {};
            const clarification = buildMissingValueClarification(question, exact, stats, bands, counts);
            if (clarification) {
              send({ type: "clarification", ...clarification, example: clarification.optionQueries[0], originalQuestion: question });
              return;
            }
          }
        }
        const requestedCharts = requestedChartTypes(question);
        const queryDb = async (sql: string) => {
          const approved = guardSql(sql);
          enforceTables(approved, schema);
          return active.mode === "oauth" ? executeOAuthQuery(active, approved) : executeQuery(active.dbUrl || "", approved);
        };
        let profile: Awaited<ReturnType<typeof inspectProject>> | null = null;
        const getProfile = async () => {
          if (profile) return profile;
          profile = await inspectProject(schema, async sql =>
            active.mode === "oauth" ? await managementReadOnly(active, sql)
              : (await executeQuery(active.dbUrl || "", sql)).rows
          );
          return profile;
        };
        const autoChart = requestedCharts.length > 0 && (
          isChartOnlyRequest(question) ||
          (/\b(?:record counts|distribution)\b/i.test(question) &&
            (await getProfile()).starters.some(starter => starter.toLowerCase() === question.toLowerCase()))
        );
        if (autoChart) {
          send({ type: "stage", stage: "planning", detail: "Choosing meaningful chart dimensions from actual project values" });
          const project = await getProfile();
          const panels: { kind: ChartKind; title: string; data: Awaited<ReturnType<typeof executeQuery>>; sql: string; xKey: string; yKeys: string[] }[] = [];
          const unavailable: string[] = [];
          for (const kind of requestedCharts.slice(0, 4)) {
            const plan = chartQueryFor(kind, project);
            if (!plan) { unavailable.push(kind); continue; }
            try {
              send({ type: "stage", stage: "executing", detail: "Querying " + plan.title + " for " + kind + " chart", sql: plan.sql });
              const data = await queryDb(plan.sql);
              if (data.rows.length === 0) { unavailable.push(kind); continue; }
              panels.push({ kind, title: plan.title, sql: plan.sql, data, xKey: plan.xKey, yKeys: plan.yKeys });
            } catch {
              // A failed panel does not discard other independently verified visualizations.
              unavailable.push(kind);
            }
          }
          if (panels.length) {
            const first = panels[0];
            send({ type: "stage", stage: "report", detail: "Rendering " + panels.length + " database-backed visualizations" });
            const report = await explainResult(question, first.sql, first.data);
            send({ type: "result", data: first.data, sql: first.sql, report, panels, unavailable });
            return;
          }
          const choices = verifiedChoices(project, question);
          send({ type: "clarification",
            question: "I could not build those charts from the connected project's verified fields. Choose a supported analysis, or type your preferred table and metrics.",
            options: choices.map(choice => choice.label),
            optionQueries: choices.map(choice => choice.query),
            example: choices[0]?.query,
            originalQuestion: question });
          return;
        }
        send({ type: "stage", stage: "planning", detail: "Understanding your question and generating PostgreSQL" });
        const planned = await planQuestion(question, schema);
        if (planned.action === "clarify") {
          const project = await getProfile();
          const choices = verifiedChoices(project, question);
          send({ type: "clarification",
            question: (planned.question || "Which data would you like to analyze?") + (choices.length ? " The options below were verified against this project." : " Type the specific table or metric you want."),
            options: choices.map(choice => choice.label),
            optionQueries: choices.map(choice => choice.query),
            example: choices[0]?.query,
            originalQuestion: question });
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
        send({ type: "stage", stage: "report", detail: "Preparing visualizations from the executed SQL results", sql });
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
