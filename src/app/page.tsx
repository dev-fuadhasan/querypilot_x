"use client";

import { useEffect, useRef, useState } from "react";
import { initialProjectRef, resolveStartupPhase } from "@/lib/connection-flow";
import {
  ArrowRight, ArrowUpRight, BarChart3, Check, CheckCircle2, ChevronDown,
  CircleHelp, Database, Eye, EyeOff, FileText, Layers3, LoaderCircle,
  LockKeyhole, LogOut, MessageSquareText, SendHorizontal, ShieldCheck, Sparkles, Table2, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie,
  PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";

type SessionStatus = {
  connected: boolean;
  projectName: string;
  projects: { id: string; name: string }[];
  projectRef?: string;
  oauthEnabled: boolean;
  configured: boolean;
  aiConfigured: boolean;
  mode?: "oauth" | "postgres" | null;
  aiProvider?: "gemini" | "groq" | null;
};
type Column = { name: string; type: "number" | "date" | "text" };
type DataResult = { columns: Column[]; rows: Record<string, unknown>[]; truncated: boolean };
type ChartSpec = { type: "bar" | "line" | "pie" | "area" | "scatter"; title: string; xKey: string; yKeys: string[] };
type Report = {
  title: string; summary: string; insights: string[]; caveats: string[];
  visualization: "bar" | "line" | "pie" | "area" | "scatter" | "table" | "kpi";
  xKey?: string; yKeys?: string[]; visualizations: ChartSpec[]; suggestedQuestions: string[];
};
type Answer = { data: DataResult; report: Report; sql: string };
type Message = {
  id: number; role: "user" | "assistant"; text: string;
  options?: string[]; optionQueries?: string[]; original?: string;
};
type AskReply =
  | { type: "stage"; stage: ProgressStage; detail: string; sql?: string }
  | ({ type: "clarification" } & Clarification)
  | ({ type: "result" } & Answer)
  | { type: "error"; error: string };
type ProgressStage = "schema" | "checking" | "planning" | "validated" | "executing" | "report";
type Progress = { stage: ProgressStage; detail: string; sql?: string };
type Clarification = { question: string; options: string[]; optionQueries?: string[]; originalQuestion: string };
const STAGES: { stage: ProgressStage; label: string; description: string }[] = [
  { stage: "schema", label: "Inspect database", description: "Discovering available tables" },
  { stage: "checking", label: "Validate request", description: "Checking actual dataset values" },
  { stage: "planning", label: "Generate SQL", description: "Translating your question" },
  { stage: "validated", label: "Validate query", description: "Checking read-only SQL" },
  { stage: "executing", label: "Execute SQL", description: "Querying Supabase" },
  { stage: "report", label: "Create insights", description: "Building your analysis" },
];

const COLORS = ["#6366f1", "#059669", "#f59e0b", "#3b82f6", "#e879f9", "#f97316"];
const EXAMPLES = ["How did sales perform last month?", "Show the top products by revenue", "Compare this month with the previous month"];

function SupabaseMark({ size = 23 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12.64 1.5c.45-.55 1.35-.23 1.35.49v9.03h6.42c.65 0 1 .74.6 1.23L11.36 22.5c-.45.55-1.35.23-1.35-.49v-9.03H3.59c-.65 0-1-.74-.6-1.23L12.64 1.5Z" fill="#3ECF8E" />
      <path d="M10.01 12.98h3.98v8.03L11.36 22.5c-.45.55-1.35.23-1.35-.49v-9.03Z" fill="#20A879" />
    </svg>
  );
}
function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={"brand " + (small ? "brand-small" : "")}>
      <span className="brand-icon"><Layers3 size={small ? 17 : 21} strokeWidth={2.2}/></span>
      <span>QueryPilot <strong>X</strong></span>
    </div>
  );
}
function valueText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value) : "—";
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) && value.length < 18) return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value));
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function prettyLabel(name: string) { return name.replace(/_/g, " ").replace(/\b\w/g, (a) => a.toUpperCase()); }
function chartValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function DataTable({ data }: { data: DataResult }) {
  return (
    <div className="data-table-scroll">
      <table className="data-table">
        <thead><tr><th className="row-index">#</th>{data.columns.map((col) => <th key={col.name}>{prettyLabel(col.name)}</th>)}</tr></thead>
        <tbody>{data.rows.map((row, index) => (
          <tr key={index}><td className="row-index">{index + 1}</td>{data.columns.map((col) => <td key={col.name} title={valueText(row[col.name])}>{valueText(row[col.name])}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}
function ChartView({ answer, view }: { answer: Answer; view: ChartSpec }) {
  const { data } = answer;
  const numeric = data.columns.filter((c) => c.type === "number").map((c) => c.name);
  const yKeys = (view.yKeys || []).filter((c) => numeric.includes(c)).slice(0, 3);
  const xKey = data.columns.some((c) => c.name === view.xKey) ? view.xKey : undefined;
  if (!xKey || yKeys.length === 0 || data.rows.length < 2) return null;
  const normalized = data.rows.slice(0, view.type === "pie" ? 8 : 40)
    .map((row) => ({ ...row, ...Object.fromEntries([
      ...yKeys.map((key) => [key, chartValue(row[key])]),
      ...(view.type === "scatter" ? [[xKey, chartValue(row[xKey])]] : []),
    ]) }));
  const kind = view.type;
  return (
    <section className="viz-card">
      <div className="viz-heading"><span><BarChart3 size={16}/> {view.title}</span><span className="viz-hint">Based on query results</span></div>
      <div className="chart-box">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "pie" ? (
            <PieChart><Tooltip formatter={(value) => valueText(value)}/><Legend />
              <Pie data={normalized} dataKey={yKeys[0]} nameKey={xKey} cx="50%" cy="48%" outerRadius="77%" innerRadius="52%" paddingAngle={2}>
                {normalized.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
              </Pie>
            </PieChart>
          ) : kind === "scatter" ? (
            <ScatterChart margin={{ top: 12, right: 22, left: 2, bottom: 10 }}>
              <CartesianGrid stroke="#edf0f2"/>
              <XAxis type="number" dataKey={xKey} name={prettyLabel(xKey)} tick={{ fill: "#90949c", fontSize: 11 }}/>
              <YAxis type="number" dataKey={yKeys[0]} name={prettyLabel(yKeys[0])} tick={{ fill: "#90949c", fontSize: 11 }}/>
              <Tooltip cursor={{ strokeDasharray: "3 3" }}/>
              <Scatter data={normalized} fill={COLORS[0]} name={prettyLabel(yKeys[0])}/>
            </ScatterChart>
          ) : kind === "area" ? (
            <AreaChart data={normalized} margin={{ top: 8, right: 16, left: -12, bottom: 6 }}>
              <CartesianGrid stroke="#edf0f2" vertical={false}/>
              <XAxis dataKey={xKey} tick={{ fill: "#90949c", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={26} tickFormatter={(v) => String(v).slice(0, 10)}/>
              <YAxis tick={{ fill: "#90949c", fontSize: 11 }} tickLine={false} axisLine={false} width={58}/>
              <Tooltip formatter={(value) => valueText(value)}/>
              {yKeys.length > 1 && <Legend/>}
              {yKeys.map((key, i) => <Area key={key} type="monotone" dataKey={key} stroke={COLORS[i]} fill={COLORS[i]} fillOpacity={0.12} strokeWidth={2.4}/>)}
            </AreaChart>
          ) : kind === "line" ? (
            <LineChart data={normalized} margin={{ top: 8, right: 16, left: -12, bottom: 6 }}>
              <CartesianGrid stroke="#edf0f2" vertical={false} />
              <XAxis dataKey={xKey} tick={{ fill: "#90949c", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={26} tickFormatter={(v) => String(v).slice(0, 10)}/>
              <YAxis tick={{ fill: "#90949c", fontSize: 11 }} tickLine={false} axisLine={false} width={58} />
              <Tooltip formatter={(value) => valueText(value)} />
              {yKeys.length > 1 && <Legend />}
              {yKeys.map((key, i) => <Line key={key} type="monotone" dataKey={key} stroke={COLORS[i]} strokeWidth={2.6} dot={{ r: 2.5 }} activeDot={{ r: 5 }}/>)}
            </LineChart>
          ) : (
            <BarChart data={normalized} margin={{ top: 10, right: 16, left: -12, bottom: 6 }}>
              <CartesianGrid stroke="#edf0f2" vertical={false} />
              <XAxis dataKey={xKey} tick={{ fill: "#90949c", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" tickFormatter={(v) => String(v).slice(0, 17)}/>
              <YAxis tick={{ fill: "#90949c", fontSize: 11 }} tickLine={false} axisLine={false} width={58}/>
              <Tooltip formatter={(value) => valueText(value)}/>
              {yKeys.length > 1 && <Legend />}
              {yKeys.map((key, i) => <Bar key={key} dataKey={key} fill={COLORS[i]} radius={[4, 4, 0, 0]} maxBarSize={52}/>)}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
}
function AnswerCanvas({ answer, question }: { answer: Answer; question: string }) {
  const { data, report } = answer;
  const metrics = data.rows.length === 1 ? data.columns.filter((c) => c.type === "number").slice(0, 5) : [];
  const charts: ChartSpec[] = Array.isArray(report.visualizations) ? report.visualizations : [];
  if (!charts.length && report.xKey && report.yKeys?.length && ["bar", "line", "pie", "area", "scatter"].includes(report.visualization)) {
    charts.push({
      type: report.visualization as ChartSpec["type"],
      title: "Visual overview",
      xKey: report.xKey,
      yKeys: report.yKeys,
    });
  }
  return (
    <div className="answer-canvas">
      <div className="answer-heading">
        <div className="eyebrow"><Sparkles size={13}/> AI-POWERED ANALYSIS</div>
        <h1>{report.title}</h1>
        <p className="answer-question">{question}</p>
      </div>
      <div className="answer-description">{report.summary}</div>
      {metrics.length > 0 && (
        <div className="metric-grid">
          {metrics.map((col, i) => (
            <div className="metric-card" key={col.name}>
              <div className="metric-top"><span>{prettyLabel(col.name)}</span><span className="metric-dot" style={{ background: COLORS[i % COLORS.length] }}/></div>
              <div className="metric-value">{valueText(data.rows[0][col.name])}</div>
            </div>
          ))}
        </div>
      )}
      {charts.map((view, index) => <ChartView answer={answer} view={view} key={view.type + index}/>)}
      <section className="viz-card table-section">
        <div className="viz-heading"><span><Table2 size={16}/> Query results <span className="count-chip">{data.rows.length}{data.truncated ? "+" : ""} rows</span></span></div>
        {data.rows.length ? <DataTable data={data}/> : <div className="no-rows">No rows matched your question. Try adjusting the filters or time range.</div>}
        {data.truncated && <p className="table-footnote">Preview is limited to the first 200 rows.</p>}
      </section>
      <section className="analysis-card">
        <div className="viz-heading"><span><FileText size={17}/> AI analysis report</span><span className="report-badge"><CheckCircle2 size={13}/> Database-backed</span></div>
        {report.insights.length ? (
          <div className="insight-list">{report.insights.map((item, index) => <div className="insight" key={index}><span className="insight-number">{String(index + 1).padStart(2, "0")}</span><p>{item}</p></div>)}</div>
        ) : <p className="analysis-copy">{report.summary}</p>}
        {report.caveats.length > 0 && <div className="caveat"><CircleHelp size={15}/><div>{report.caveats.join(" ")}</div></div>}
        <details className="sql-disclosure" open>
          <summary><span><Database size={15}/> View executed SQL</span><ChevronDown size={15}/></summary>
          <pre>{answer.sql}</pre>
        </details>
      </section>
    </div>
  );
}

function QueryProgress({ progress }: { progress: Progress }) {
  const index = STAGES.findIndex((item) => item.stage === progress.stage);
  return (
    <div className="query-progress">
      <div className="progress-shell">
        <div className="progress-icon">
          {progress.stage === "executing" ? <Database size={24} strokeWidth={1.7}/> :
            progress.stage === "report" ? <BarChart3 size={24} strokeWidth={1.7}/> :
            <Layers3 size={24} strokeWidth={1.7}/>}
          <span className="progress-orbit"/>
        </div>
        <div className="progress-kicker"><span className="pulse-dot"/> LIVE QUERY EXECUTION</div>
        <h2>{progress.stage === "validated" ? "SQL validated" :
          progress.stage === "executing" ? "Executing your query" :
          progress.stage === "report" ? "Preparing your analysis" :
          progress.stage === "planning" ? "Generating your SQL" :
          progress.stage === "checking" ? "Validating against your data" : "Exploring your database"}</h2>
        <p className="progress-subtitle">{progress.detail}</p>
        <div className="progress-steps">
          {STAGES.map((step, i) => (
            <div className={"progress-step " + (i < index ? "done" : i === index ? "active" : "")} key={step.stage}>
              <span className="progress-step-icon">{i < index ? <Check size={13}/> :
                i === index ? <LoaderCircle size={13} className="spin"/> : String(i+1).padStart(2,"0")}</span>
              <div><strong>{step.label}</strong><small>{step.description}</small></div>
              {i === index && <span className="progress-live">In progress</span>}
              {i < index && <CheckCircle2 size={15} className="progress-done"/>}
            </div>
          ))}
        </div>
        {progress.sql && (
          <div className="query-code">
            <div className="query-code-top"><span><CheckCircle2 size={14}/> SELECT query passed safety checks</span><span>READ ONLY</span></div>
            <pre>{progress.sql}</pre>
            {progress.stage === "executing" && <div className="query-running"><span className="pulse-dot"/> Running query against the connected project…</div>}
          </div>
        )}
      </div>
    </div>
  );
}

let messageCounter = 0;
function nextMessage() { messageCounter += 1; return messageCounter; }

export default function Home() {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [phase, setPhase] = useState<"landing" | "setup" | "workspace">("landing");
  const [databaseUri, setDatabaseUri] = useState("");
  const [showUri, setShowUri] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [projectRef, setProjectRef] = useState("");
  const [switchOpen, setSwitchOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [activeClarification, setActiveClarification] = useState<Clarification | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const [asking, setAsking] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function notify(text: string, error = false) {
    setToast({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4800);
  }
  useEffect(() => {
    let active = true;
    fetch("/api/session", { cache: "no-store" }).then(async (res) => {
      if (!res.ok) throw new Error("Cannot load the workspace.");
      return await res.json() as SessionStatus;
    }).then((data) => {
      if (!active) return;
      setSession(data);
      const params = new URLSearchParams(window.location.search);
      const nextPhase = resolveStartupPhase(data);
      setPhase(params.has("setup") && nextPhase === "landing" ? "setup" : nextPhase);
      setProjectRef(initialProjectRef(data));
      setManualMode(!data.oauthEnabled || (data.projects.length === 0 && params.get("setup") === "manual"));
      if (params.has("connected") && data.connected) notify("Your Supabase database is connected.");
      const err = params.get("error");
      if (err) notify(err, true);
      if (params.has("setup") || params.has("connected") || err) window.history.replaceState({}, "", "/");
    }).catch((err) => { if (active) notify(err instanceof Error ? err.message : "Could not start the application.", true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, asking]);

  function beginConnect() {
    if (!session?.configured) return notify("Set SESSION_SECRET on Vercel before connecting.", true);
    if (session.mode === "oauth" && session.projects.length > 0) {
      setManualMode(false);
      setProjectRef(initialProjectRef(session));
      setPhase("setup");
    } else if (session.oauthEnabled) window.location.assign("/api/auth/start");
    else { setManualMode(true); setPhase("setup"); }
  }
  async function connectAuthorizedProject(targetRef: string = projectRef) {
    if (!targetRef || connecting || asking) return;
    if (session?.connected && targetRef === session.projectRef) {
      setSwitchOpen(false);
      setPhase("workspace");
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch("/api/projects/select", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRef: targetRef }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not connect this project.");
      setProjectRef(targetRef);
      setSession((old) => old ? { ...old, connected: true, mode: "oauth", projectRef: targetRef, projectName: data.projectName } : old);
      requestIdRef.current += 1;
      requestAbortRef.current?.abort();
      setAnswer(null); setMessages([]); setProgress(null); setActiveClarification(null); setAnalysisError(null); setCurrentQuestion(""); setQuestion("");
      setSwitchOpen(false);
      setPhase("workspace");
      notify("Connected to " + data.projectName + ".");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not connect this project.", true); }
    finally { setConnecting(false); }
  }
  async function connectDatabase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!databaseUri.trim() || connecting) return;
    setConnecting(true);
    try {
      const res = await fetch("/api/connect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: databaseUri.trim(), projectRef }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed.");
      setSession((old) => old ? { ...old, connected: true, mode: "postgres", projects: [], projectName: data.projectName } : old);
      setDatabaseUri("");
      setPhase("workspace");
      requestIdRef.current += 1;
      requestAbortRef.current?.abort();
      setAnswer(null); setMessages([]); setProgress(null); setActiveClarification(null); setAnalysisError(null);
      notify("Your database is connected.");
    } catch (err) { notify(err instanceof Error ? err.message : "Could not connect.", true); }
    finally { setConnecting(false); }
  }
  async function disconnect() {
    try {
      const res = await fetch("/api/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Could not disconnect.");
      requestIdRef.current += 1;
      requestAbortRef.current?.abort();
      setAnswer(null);
      setMessages([]);
      setProgress(null);
      setActiveClarification(null);
      setAnalysisError(null);
      setProjectRef("");
      setSwitchOpen(false);
      setSession((old) => old ? { ...old, connected: false, mode: null, projectRef: undefined, projects: [], projectName: "" } : old);
      setPhase("landing");
      notify("Database disconnected.");
    } catch { notify("Could not disconnect. Please retry.", true); }
  }
  async function askQuestion(text: string, displayText?: string) {
    const prompt = text.trim();
    if (!prompt || asking || !session?.connected) return;
    const requestId = ++requestIdRef.current;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setQuestion("");
    setAsking(true);
    // Never keep showing the last question's visualization while processing a new request.
    setAnswer(null);
    setActiveClarification(null);
    setAnalysisError(null);
    setCurrentQuestion(displayText || prompt);
    setProgress({ stage: "schema", detail: "Inspecting connected Supabase tables and values" });
    setMessages((old) => [...old, { id: nextMessage(), role: "user", text: displayText || prompt }]);
    const isLatest = () => requestId === requestIdRef.current && !controller.signal.aborted;
    try {
      const response = await fetch("/api/ask/stream", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        cache: "no-store",
        body: JSON.stringify({ question: prompt }),
      });
      if (!isLatest()) return;
      if (!response.ok) {
        const value = await response.json() as { error?: string };
        throw new Error(value.error || "Unable to analyze your data.");
      }
      if (!response.body) throw new Error("The AI analysis stream could not be started.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      function handleEvent(item: AskReply) {
        if (!isLatest()) return;
        if (item.type === "stage") {
          setProgress({ stage: item.stage, detail: item.detail, sql: item.sql });
        } else if (item.type === "clarification") {
          finished = true;
          setProgress(null);
          setActiveClarification(item);
          setMessages((old) => [...old, {
            id: nextMessage(), role: "assistant", text: item.question,
            options: item.options, optionQueries: item.optionQueries, original: item.originalQuestion,
          }]);
        } else if (item.type === "result") {
          finished = true;
          setAnswer({ data: item.data, report: item.report, sql: item.sql });
          setProgress(null);
          setActiveClarification(null);
          setMessages((old) => [...old, {
            id: nextMessage(), role: "assistant",
            text: item.data.rows.length ? "Your new analysis is ready. See the results and report on the left." :
              "The query completed without matching rows. Explore its SQL and report on the left.",
          }]);
        } else if (item.type === "error") {
          throw new Error(item.error);
        }
      }
      while (isLatest()) {
        const { done, value } = await reader.read();
        if (!isLatest()) return;
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) if (line.trim()) handleEvent(JSON.parse(line) as AskReply);
        if (done) {
          if (buffer.trim()) handleEvent(JSON.parse(buffer) as AskReply);
          break;
        }
      }
      if (isLatest() && !finished) throw new Error("The response ended before analysis was complete. Try again.");
    } catch (error) {
      if (!isLatest()) return;
      const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
      setProgress(null);
      setAnalysisError(message);
      setMessages((old) => [...old, { id: nextMessage(), role: "assistant", text: message }]);
    } finally {
      if (isLatest()) {
        setAsking(false);
        requestAbortRef.current = null;
      }
    }
  }
  function selectClarification(option: string, query: string) {
    void askQuestion(query, option);
  }

  return (
    <div className="app-root">
      {!session ? (
        <div className="session-loading" role="status" aria-label="Restoring your workspace">
          <Brand/>
        </div>
      ) : phase === "landing" ? (
        <div className="onboarding">
          <div className="onboard-brand"><Brand/></div>
          <main className="welcome">
            <div className="welcome-symbol"><Database size={30} strokeWidth={1.65}/></div>
            <div className="welcome-eyebrow">INTELLIGENT DATABASE ANALYTICS</div>
            <h1>Your data,<br/><em>answered.</em></h1>
            <p>Connect your database. Ask your questions.<br/>Understand the answers.</p>
            <button className="black-button" disabled={!session} onClick={beginConnect}>
              <SupabaseMark size={22}/><span>Connect your database</span><ArrowRight size={17}/>
            </button>
            <div className="welcome-foot"><ShieldCheck size={15}/> Secure connection with Supabase</div>
          </main>
          <div className="onboard-footer">QUERYPILOT X <span>·</span> BUILT FOR BETTER DECISIONS</div>
        </div>
      ) : phase === "setup" ? (
        <div className="onboarding">
          <div className="onboard-brand"><Brand/></div>
          <main className="setup-shell">
            <button className="back-link" onClick={() => setPhase(session.connected ? "workspace" : "landing")}><ArrowRight size={16}/> Back</button>
            <div className="setup-icon"><SupabaseMark size={31}/></div>
            <h1>{session.projects.length > 0 && !manualMode ? "Choose your project" : "Connect your database"}</h1>
            <p>{session.projects.length && !manualMode ? "Supabase is authorized. Choose the project you want QueryPilot X to analyze." :
              "Connect any Supabase PostgreSQL project using its read-only connection string."}</p>
            {session.projects.length > 0 && !manualMode && (
              <div className="oauth-selector">
                <div className="project-list-label">YOUR AUTHORIZED PROJECTS <span>{session.projects.length}</span></div>
                <div className="project-choice-list" role="group" aria-label="Supabase projects">
                  {session.projects.map((project) => (
                    <button key={project.id} type="button"
                      className={"project-choice " + (projectRef === project.id ? "selected" : "")}
                      onClick={() => setProjectRef(project.id)}
                      disabled={connecting}>
                      <span className="project-choice-icon"><Database size={19}/></span>
                      <span className="project-choice-details"><strong>{project.name}</strong><small>Supabase · {project.id}</small></span>
                      <span className="project-choice-indicator">{projectRef === project.id ? <Check size={14}/> : null}</span>
                    </button>
                  ))}
                </div>
                <button className="black-button full" onClick={() => connectAuthorizedProject()} disabled={connecting || !projectRef}>
                  {connecting ? <LoaderCircle size={18} className="spin"/> : <SupabaseMark size={20}/>}
                  {connecting ? "Verifying selected project…" : "Continue to dashboard"}<ArrowRight size={17}/>
                </button>
                <div className="auto-connect-hint"><ShieldCheck size={16}/> Read-only access · Project selection is saved for your next visit.</div>
              </div>
            )}
            {(manualMode || !session.projects.length) && <form className="connect-form" onSubmit={connectDatabase}>
              {session.projects.length > 0 && manualMode && (
                <label className="form-group">
                  <span>Supabase project</span>
                  <select value={projectRef} onChange={(event) => setProjectRef(event.target.value)}>
                    {session.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
                  </select>
                </label>
              )}
              <label className="form-group">
                <span>PostgreSQL connection string</span>
                <div className="secret-input">
                  <input value={databaseUri} onChange={(event) => setDatabaseUri(event.target.value)}
                    type={showUri ? "text" : "password"} spellCheck={false} autoComplete="off"
                    placeholder="postgresql://user.project-ref:password@...pooler.supabase.com:5432/postgres" required/>
                  <button type="button" aria-label={showUri ? "Hide credentials" : "Show credentials"} onClick={() => setShowUri(!showUri)}>
                    {showUri ? <EyeOff size={17}/> : <Eye size={17}/>}
                  </button>
                </div>
              </label>
              <button className="black-button full" type="submit" disabled={connecting || !databaseUri.trim()}>
                {connecting ? <LoaderCircle size={18} className="spin"/> : <LockKeyhole size={17}/>}
                {connecting ? "Verifying connection…" : "Connect securely"}<ArrowRight size={17}/>
              </button>
            </form>}
            {session.oauthEnabled && <button type="button" className="connection-toggle"
              onClick={() => {
                if (manualMode && !session.projects.length) window.location.assign("/api/auth/start");
                else setManualMode(!manualMode);
              }}>
              {manualMode ? (session.projects.length ? "Use authorized Supabase projects" : "Connect using Supabase OAuth") : "Use a PostgreSQL read-only connection instead"} <ArrowRight size={14}/>
            </button>}
            <div className="setup-help">
              <ShieldCheck size={17}/><span>Sessions are encrypted and isolated by browser. OAuth uses Supabase's read-only query endpoint; manual connections should use a SELECT-only role.</span>
            </div>
            <a className="doc-link" href="https://supabase.com/docs/guides/database/connecting-to-postgres" target="_blank" rel="noreferrer">
              Where can I find my connection string? <ArrowUpRight size={14}/>
            </a>
          </main>
          <div className="onboard-footer">QUERYPILOT X <span>·</span> SECURE BY DESIGN</div>
        </div>
      ) : (
        <div className="workspace">
          <section className="workspace-main">
            <header className="workspace-header">
              <Brand small/>
              <div className="header-right">
                {session.mode === "oauth" && session.projects.length > 0 ? (
                  <div className="project-switch-anchor">
                    <button className={"connected-pill project-pill " + (switchOpen ? "open" : "")}
                      type="button" aria-haspopup="dialog" aria-expanded={switchOpen}
                      aria-label={"Current project: " + session.projectName + ". Switch Supabase project"}
                      onClick={() => setSwitchOpen(value => !value)} disabled={connecting || asking}>
                      <span className="online-indicator"/><SupabaseMark size={16}/>
                      <span className="connected-name">{session.projectName}</span>
                      <ChevronDown size={14} className={switchOpen ? "rotate" : ""}/>
                    </button>
                    {switchOpen && (
                      <>
                        <button type="button" className="project-switch-backdrop" aria-label="Close project switcher" onClick={() => setSwitchOpen(false)}/>
                        <div className="project-switch-menu" role="dialog" aria-label="Switch Supabase project">
                          <div className="project-switch-title">SWITCH PROJECT <span>{session.projects.length} AVAILABLE</span></div>
                          <div className="project-switch-list">
                            {session.projects.map(project => (
                              <button type="button" className={"switch-project-option " + (project.id === session.projectRef ? "active" : "")}
                                key={project.id} disabled={connecting || asking}
                                onClick={() => { setProjectRef(project.id); void connectAuthorizedProject(project.id); }}>
                                <span className="switch-option-icon"><Database size={16}/></span>
                                <span className="switch-option-text"><strong>{project.name}</strong><small>{project.id === session.projectRef ? "Current project" : project.id}</small></span>
                                {connecting && project.id === projectRef ? <LoaderCircle size={15} className="spin"/> : project.id === session.projectRef ? <Check size={15}/> : <ArrowRight size={14}/>}
                              </button>
                            ))}
                          </div>
                          <div className="switch-menu-foot"><ShieldCheck size={13}/> Your authorized Supabase projects</div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="connected-pill"><span className="online-indicator"/><SupabaseMark size={16}/><span className="connected-name">{session.projectName}</span><Check size={14}/></div>
                    <button className="icon-button" title="Connect a different project" aria-label="Connect a different project"
                      disabled={asking || connecting}
                      onClick={() => { setManualMode(true); setPhase("setup"); }}><Database size={17}/></button>
                  </>
                )}
                <button className="icon-button" title="Disconnect database" aria-label="Disconnect database" onClick={disconnect}><LogOut size={17}/></button>
              </div>
            </header>
            <main className="results-scroll">
              {asking && progress ? <QueryProgress progress={progress}/> :
                activeClarification ? (
                  <div className="clarification-canvas">
                    <div className="clarification-card">
                      <span className="clarification-kicker"><CircleHelp size={15}/> CHECKED AGAINST YOUR DATA</span>
                      <h2>Choose an available value</h2>
                      <p>{activeClarification.question}</p>
                      <div className="clarification-canvas-options">
                        {activeClarification.options.map((option, index) => (
                          <button key={option} type="button" disabled={asking} onClick={() => selectClarification(
                            option, activeClarification.optionQueries?.[index] || activeClarification.originalQuestion + ". Clarification: " + option
                          )}>{option}<ArrowRight size={15}/></button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : analysisError ? (
                  <div className="clarification-canvas">
                    <div className="clarification-card">
                      <span className="clarification-kicker"><CircleHelp size={15}/> QUERY COULD NOT BE COMPLETED</span>
                      <h2>No results for this request</h2><p>{analysisError}</p>
                      <small>You can adjust your question and try again. Previous results were cleared to avoid displaying outdated data.</small>
                    </div>
                  </div>
                ) : !answer ? (
                <div className="empty-results">
                  <div className="empty-icon"><Sparkles size={26} strokeWidth={1.5}/></div>
                  <h2>Ask. Analyze. Understand.</h2>
                  <p>Your insights will appear here.<br/>Start with a question in the chat.</p>
                  <div className="empty-divider"/>
                  <div className="empty-powered"><span className="online-indicator"/> Database ready for analysis</div>
                </div>
              ) : <AnswerCanvas answer={answer} question={currentQuestion}/>}
            </main>
          </section>
          <aside className="chat-panel">
            <div className="chat-top">
              <div className="chat-heading"><div className="chat-avatar"><MessageSquareText size={17}/></div><div><h2>Ask QueryPilot</h2><p>AI database assistant</p></div></div>
              <div className="chat-online"><span className="online-indicator"/> Online</div>
            </div>
            <div className="messages-scroll" ref={messagesRef}>
              <div className="chat-intro"><span className="chat-intro-symbol"><Sparkles size={18}/></span><h3>What would you like to know?</h3><p>Ask a question about your connected database in plain English.</p></div>
              {messages.length === 0 && (
                <div className="suggestions">
                  {EXAMPLES.map((example) => <button key={example} onClick={() => askQuestion(example)} disabled={asking}>{example}<ArrowUpRight size={15}/></button>)}
                </div>
              )}
              {messages.map((message) => (
                <div key={message.id} className={"message-row " + message.role}>
                  {message.role === "assistant" && <span className="assistant-badge"><Sparkles size={13}/></span>}
                  <div className="message-content">
                    <div className="message-bubble">{message.text}</div>
                    {message.options && (
                      <div className="clarification-options">{message.options.map((option) =>
                        <button key={option} disabled={asking} onClick={() => selectClarification(option, message.optionQueries?.[message.options?.indexOf(option) ?? -1] || message.original + ". Clarification: " + option)}>
                          {option}<ArrowRight size={14}/>
                        </button>
                      )}</div>
                    )}
                  </div>
                </div>
              ))}
              {asking && <div className="typing"><LoaderCircle size={16} className="spin"/> {progress?.detail || "Connecting to your database…"}</div>}
              {answer && !asking && messages.length > 0 && answer.report.suggestedQuestions.length > 0 && (
                <div className="follow-up-questions">
                  <div className="follow-up-title">KEEP EXPLORING</div>
                  {answer.report.suggestedQuestions.map((suggestion) => <button key={suggestion} onClick={() => askQuestion(suggestion)}>{suggestion}<ArrowUpRight size={13}/></button>)}
                </div>
              )}
            </div>
            <div className="composer-wrap">
              {!session.aiConfigured && <div className="config-hint">Set GEMINI_API_KEY or GROQ_API_KEY in Vercel to enable AI analysis.</div>}
              <form className="composer" onSubmit={(event) => {event.preventDefault(); askQuestion(question);}}>
                <textarea rows={2} value={question} maxLength={700} disabled={asking}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) {event.preventDefault(); askQuestion(question);} }}
                  placeholder="Ask anything about your data…" aria-label="Ask your database"/>
                <div className="composer-bottom"><span><LockKeyhole size={12}/> Read-only access</span><button className="send-button" disabled={!question.trim() || asking || !session.aiConfigured} title="Send message" aria-label="Send message">
                  {asking ? <LoaderCircle size={17} className="spin"/> : <SendHorizontal size={17}/>}
                </button></div>
              </form>
              <div className="composer-caption">{session.aiProvider === "groq" ? "Groq" : "Gemini"} AI · Read-only data · Verify important insights</div>
            </div>
          </aside>
        </div>
      )}
      {toast && <div className={"toast " + (toast.error ? "toast-error" : "")} role="status">
        {toast.error ? <X size={16}/> : <CheckCircle2 size={17}/>}<span>{toast.text}</span>
        <button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={14}/></button>
      </div>}
    </div>
  );
}
