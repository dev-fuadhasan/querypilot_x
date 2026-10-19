import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QueryPilot X — Your data, answered.",
  description: "Ask your Supabase database questions and get meaningful, evidence-based analytics.",
  applicationName: "QueryPilot X",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
