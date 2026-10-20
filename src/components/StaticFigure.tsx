"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Image as ImageIcon, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ChartSpec } from "@/lib/charts";

type FigureData = {
  columns: { name: string; type: "number" | "date" | "text" }[];
  rows: Record<string, unknown>[];
};
export function StaticFigure({ data, view }: { data: FigureData; view: ChartSpec }) {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const payload = useMemo(() => ({
    type: view.type, title: view.title, xKey: view.xKey, yKeys: view.yKeys,
    xLabel: view.xLabel, yLabel: view.yLabel, unit: view.unit,
    seriesLabels: view.seriesLabels,
    // Send only plotted columns to Python. Never upload entire database records.
    rows: data.rows.slice(0, 200).map(row =>
      Object.fromEntries([view.xKey, ...view.yKeys].map(key => [key, row[key]]))),
  }), [data, view]);

  const serialized = JSON.stringify(payload);
  useEffect(() => {
    let url = "";
    const controller = new AbortController();
    setImage("");
    setError("");
    setLoading(true);
    const render = async () => {
      try {
        const response = await fetch("/api/figures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: serialized,
          signal: controller.signal,
        });
        if (!response.ok) {
          const message = await response.json().catch(() => null) as {error?: string} | null;
          throw new Error(message?.error || ("Figure service unavailable (" + response.status + ")."));
        }
        const blob = await response.blob();
        if (!blob.type.startsWith("image/png") || blob.size === 0 || blob.size > 4_000_000)
          throw new Error("The renderer returned an invalid image.");
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage(url);
      } catch (cause) {
        if (!controller.signal.aborted) setError(
          cause instanceof Error ? cause.message : "Could not generate this static figure."
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void render();
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [serialized]);

  const filename = (view.title || "querypilot-figure").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) + ".png";
  return (
    <section className="viz-card static-figure-card" aria-label={view.title}>
      <div className="viz-heading">
        <span><ImageIcon size={16}/> {view.title}</span>
        <span className="viz-hint">STATIC FIGURE · MATPLOTLIB</span>
      </div>
      {loading ? (
        <div className="static-figure-status" role="status">
          <LoaderCircle className="spin" size={22}/>
          <span>Rendering a labeled figure from the SQL results…</span>
        </div>
      ) : error ? (
        <div className="static-figure-status static-figure-error" role="alert">
          <TriangleAlert size={21}/>
          <span>{error} The verified result table and executed SQL are shown below.</span>
        </div>
      ) : (
        <figure className="static-figure-content">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={view.title + ". " + (view.yLabel || view.yKeys.join(", ")) +
            " by " + (view.xLabel || view.xKey) + "."}
            loading="eager" className="static-figure-image"/>
          <figcaption className="static-figure-footer">
            <span>High-resolution static image · SQL-verified values</span>
            <a className="static-figure-download" href={image} download={filename}>
              <Download size={14}/> Download PNG
            </a>
          </figcaption>
        </figure>
      )}
    </section>
  );
}
