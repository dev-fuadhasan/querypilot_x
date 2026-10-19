export type ProjectChoice = { id: string; name: string };
export type ConnectionState = {
  connected: boolean;
  mode?: "oauth" | "postgres" | null;
  projectRef?: string;
  projects: ProjectChoice[];
};
export type StartupPhase = "landing" | "setup" | "workspace";

// Project-list existence does NOT mean the active connection must be selected again.
export function resolveStartupPhase(session: ConnectionState): StartupPhase {
  if (session.connected) return "workspace";
  if (session.mode === "oauth" && session.projects.length > 0) return "setup";
  return "landing";
}
export function initialProjectRef(session: ConnectionState): string {
  const selected = session.projects.find(project => project.id === session.projectRef);
  return selected?.id || session.projects[0]?.id || "";
}
