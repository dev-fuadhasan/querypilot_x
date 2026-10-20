"""Static, publication-style charts for the Next.js QueryPilot dashboard.

Vercel Python function: POST /api/figures with a bounded chart specification
and previously executed SQL result rows. No database credentials or SQL needed.
"""
from http.server import BaseHTTPRequestHandler
from io import BytesIO
import json
import math
import re

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import FuncFormatter, MaxNLocator

TYPES = {"line", "bar", "column", "pie", "donut", "area", "scatter",
         "heatmap", "radar", "stacked-column", "combo", "card"}
COLORS = ("#5868D5", "#15A38D", "#EB9D44", "#9470D6", "#408FBB",
          "#D56A86", "#6D7C9B", "#82B9A9", "#B98049", "#ADB6C5")
INK = "#253248"
MUTED = "#64748B"
GRID = "#E7EBF0"
MAX_BODY = 250_000
MAX_ROWS = 200
MAX_SERIES = 8

def clean_text(value, maximum=150):
    if value is None:
        return ""
    return re.sub(r"[\r\n\t]+", " ", str(value)).strip()[:maximum]

def numeric(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        result = float(value)
    elif isinstance(value, str) and re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", value.strip()):
        result = float(value.strip())
    else:
        return None
    return result if math.isfinite(result) and abs(result) <= 1e15 else None

def pretty(value):
    return clean_text(value).replace("_", " ").replace("-", " ").title()

def plot_format(value, percent=False):
    if not math.isfinite(value):
        return "—"
    if percent:
        return f"{value:,.2f}%"
    if abs(value) >= 10000:
        return f"{value:,.0f}"
    if abs(value-round(value)) < 1e-9:
        return f"{value:,.0f}"
    return f"{value:,.2f}"

def prepare(payload):
    if not isinstance(payload, dict):
        raise ValueError("Chart specification must be an object.")
    kind = payload.get("type")
    if kind not in TYPES:
        raise ValueError("Unsupported chart type.")
    rows = payload.get("rows")
    xkey = payload.get("xKey")
    ykeys = payload.get("yKeys")
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS:
        raise ValueError("Figure needs 1–200 result rows.")
    if not isinstance(xkey, str) or len(xkey) > 128 or not isinstance(ykeys, list):
        raise ValueError("Missing result column identifiers.")
    if not 1 <= len(ykeys) <= MAX_SERIES or not all(isinstance(k,str) and 0<len(k)<=128 for k in ykeys):
        raise ValueError("Figure needs 1–8 numeric measures.")
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError("Rows must contain named columns.")
    labels = [clean_text(row.get(xkey), 78) for row in rows]
    if any(not label for label in labels):
        raise ValueError("Every plotted row needs an x-axis value.")
    values = [[numeric(row.get(key)) for row in rows] for key in ykeys]
    if all(not any(v is not None for v in series) for series in values):
        raise ValueError("No verified numeric data for this chart.")
    series_labels = payload.get("seriesLabels") or {}
    if not isinstance(series_labels, dict):
        series_labels = {}
    title = clean_text(payload.get("title") or "Data visualization", 100)
    xlabel = clean_text(payload.get("xLabel") or pretty(xkey), 70)
    ylabel = clean_text(payload.get("yLabel") or pretty(ykeys[0]), 70)
    unit = payload.get("unit")
    percent = unit == "%" or bool(re.search(r"(?:percent|percentage|rate_pct|_pct)$", ykeys[0], re.I)) or ylabel.endswith("(%)")
    if percent:
        ylabel = ylabel.rstrip(" %") + " (%)" if "(%)" not in ylabel else ylabel
    return kind, rows, labels, ykeys, values, series_labels, title, xlabel, ylabel, percent

def render_png(payload):
    kind, rows, labels, keys, values, aliases, title, xlabel, ylabel, percent = prepare(payload)
    n = len(labels)
    # Limit labels rather than silently overcrowding the figure.
    limit = 24 if kind in ("bar", "column", "heatmap", "stacked-column", "combo") else 50
    if kind in ("pie", "donut", "radar"):
        limit = 12
    if kind == "card":
        limit = 1 if n == 1 else 4
    clipped = max(0, n-limit)
    labels = labels[:limit]
    values = [v[:limit] for v in values]
    n = len(labels)
    series = [np.array([np.nan if v is None else v for v in column], dtype=float) for column in values]
    if kind in ("pie", "donut") and (n < 2 or np.isnan(series[0]).any() or
         (series[0] < 0).any() or np.nansum(series[0]) <= 0):
        raise ValueError("Pie charts require at least two nonnegative part-to-whole values.")
    if kind == "scatter":
        xvalues = [numeric(row.get(payload["xKey"])) for row in rows[:limit]]
        if any(v is None for v in xvalues):
            raise ValueError("Scatter plots need a numeric x-axis.")
    if kind in ("line", "area", "radar") and n < 2:
        raise ValueError("This figure requires at least two observations.")
    if kind in ("stacked-column", "combo", "heatmap", "radar") and len(series) < 2:
        raise ValueError("This figure needs at least two numerical measures.")
    if kind == "stacked-column" and any((v < 0).any() for v in series if len(v)):
        raise ValueError("Stacked charts require nonnegative values.")

    plt.rcParams.update({
        "font.family": "DejaVu Sans",
        "font.size": 10.2,
        "axes.titlesize": 16,
        "axes.labelsize": 10.5,
        "axes.edgecolor": GRID,
        "axes.labelcolor": MUTED,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "text.color": INK,
        "savefig.facecolor": "white",
        "figure.facecolor": "white",
        "svg.fonttype": "none",
    })
    size_y = max(4.8, min(10.0, 1.7 + n*0.40)) if kind == "bar" else 5.6
    fig, ax = plt.subplots(figsize=(10.2, size_y), dpi=175)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")
    fig.suptitle(title, x=0.07, ha="left", y=0.985, fontsize=16, weight="bold", color=INK)
    indexes = np.arange(n)
    shown = [clean_text(label, 37) for label in labels]
    names = [clean_text(aliases.get(k) or pretty(k), 48) for k in keys]

    for edge in ("top", "right", "left"):
        ax.spines[edge].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.set_axisbelow(True)

    if kind == "bar":
        height = 0.72 / len(series)
        for j, (v, name) in enumerate(zip(series, names)):
            pos = indexes+(j-(len(series)-1)/2)*height
            ax.barh(pos, v, height=height*0.93, color=COLORS[j%len(COLORS)], label=name)
            for y, val in zip(pos,v):
                if np.isfinite(val):
                    ax.annotate(plot_format(val,percent), (val,y), xytext=(5,0),
                        textcoords="offset points", va="center", fontsize=9, color=INK)
        ax.set_yticks(indexes,shown)
        ax.invert_yaxis()
        ax.set_xlabel(ylabel)
        ax.xaxis.grid(True,color=GRID,linewidth=.9)
        maximum=float(max((np.nanmax(v) for v in series if np.isfinite(v).any()), default=1))
        ax.set_xlim(left=min(0,maximum),right=100 if percent and maximum<=100 else max(maximum*1.30,1))
    elif kind in ("column","stacked-column","combo"):
        width=0.72/max(1, len(series)) if kind=="column" else 0.7
        baseline=np.zeros(n)
        for j,(v,name) in enumerate(zip(series,names)):
            if kind=="combo" and j>0:
                ax.plot(indexes,v,marker="o",linewidth=2.4,color=COLORS[j%len(COLORS)],label=name)
                continue
            pos=indexes+(j-(len(series)-1)/2)*width if kind=="column" else indexes
            ax.bar(pos,np.nan_to_num(v,nan=0),bottom=baseline if kind=="stacked-column" else 0,
                width=width*.92,color=COLORS[j%len(COLORS)],label=name)
            if kind=="stacked-column":baseline+=np.nan_to_num(v,nan=0)
            if kind=="column" and len(series)==1:
                for x,val in zip(pos,v):
                    if np.isfinite(val):
                        ax.annotate(plot_format(val,percent),(x,val),xytext=(0,4),textcoords="offset points",
                            ha="center",fontsize=8.5,color=INK)
        ax.set_xticks(indexes,shown,rotation=40 if n>6 else 0,
            ha="right" if n>6 else "center")
        ax.set_ylabel(ylabel)
        ax.yaxis.grid(True,color=GRID,linewidth=.9)
        if percent and kind=="column" and len(series)==1 and np.nanmax(series[0])<=100:
            ax.set_ylim(0,105)
    elif kind in ("line","area"):
        # Preserve SQL-defined order; the query planner owns chronological ordering.
        for j,(v,name) in enumerate(zip(series,names)):
            ax.plot(indexes,v,color=COLORS[j%len(COLORS)],linewidth=2.25,
                marker="o" if n<=25 else None,markersize=4.2,label=name)
            if kind=="area":ax.fill_between(indexes,v,alpha=.11,color=COLORS[j%len(COLORS)])
        skip=max(1,math.ceil(n/12))
        ticks=list(range(0,n,skip))
        if n-1 not in ticks:ticks.append(n-1)
        ax.set_xticks(ticks,[shown[i] for i in ticks],rotation=35 if n>8 else 0,
            ha="right" if n>8 else "center")
        ax.set_xlim(-.3,n-.7)
        ax.set_xlabel(xlabel)
        ax.set_ylabel(ylabel)
        ax.yaxis.grid(True,color=GRID,linewidth=.9)
    elif kind=="scatter":
        x=np.array([numeric(row.get(payload["xKey"])) for row in rows[:limit]],dtype=float)
        for j,(v,name) in enumerate(zip(series,names)):
            valid=np.isfinite(x)&np.isfinite(v)
            ax.scatter(x[valid],v[valid],s=39,color=COLORS[j%len(COLORS)],alpha=.82,label=name,
                       edgecolors="white",linewidths=.5)
        ax.set_xlabel(xlabel);ax.set_ylabel(ylabel)
        ax.grid(True,color=GRID,linewidth=.8)
    elif kind in ("pie","donut"):
        wedges, texts, pcts=ax.pie(series[0],labels=None,autopct=lambda pct:f"{pct:.1f}%" if pct>=4 else "",
             startangle=90,counterclock=False,pctdistance=.75 if kind=="pie" else .81,
             wedgeprops={"linewidth":1.7,"edgecolor":"white",
                         "width":.43 if kind=="donut" else 1.0},
             colors=COLORS[:n],textprops={"fontsize":9.5,"color":INK})
        ax.legend(wedges, [f"{label} · {plot_format(val)}" for label,val in zip(shown,series[0])],
                 loc="center left",bbox_to_anchor=(1.02,.5),frameon=False,fontsize=9)
        ax.axis("equal")
        if kind=="donut":
            ax.text(0,0,plot_format(float(np.nansum(series[0]))),ha="center",va="center",
                    fontsize=17,weight="bold",color=INK)
    elif kind=="heatmap":
        matrix=np.vstack(series).T
        im=ax.imshow(np.ma.masked_invalid(matrix),cmap="YlGnBu",aspect="auto")
        ax.set_yticks(indexes,shown)
        ax.set_xticks(np.arange(len(keys)),names,rotation=25,ha="right")
        for y in range(n):
            for x in range(len(keys)):
                if np.isfinite(matrix[y,x]):
                    ax.text(x,y,plot_format(float(matrix[y,x])),ha="center",va="center",
                        fontsize=8.5,color="white" if matrix[y,x]>(np.nanmin(matrix)+np.nanmax(matrix))/2 else INK)
        fig.colorbar(im,ax=ax,shrink=.86,pad=.025)
        ax.spines[:].set_visible(False)
    elif kind=="radar":
        ax.remove()
        ax=fig.add_subplot(111,polar=True)
        angles=np.linspace(0,2*np.pi,n,endpoint=False)
        ax.set_xticks(angles,shown)
        ax.tick_params(labelsize=8.6)
        for j,(v,name) in enumerate(zip(series,names)):
            closed=np.r_[v,v[0]]
            ax.plot(np.r_[angles,angles[0]],closed,label=name,color=COLORS[j%len(COLORS)],lw=2)
            ax.fill(np.r_[angles,angles[0]],closed,alpha=.085,color=COLORS[j%len(COLORS)])
        ax.grid(color=GRID)
    elif kind=="card":
        ax.axis("off")
        for j,(v,name) in enumerate(zip(series[:4],names[:4])):
            value=next((v0 for v0 in v if np.isfinite(v0)),None)
            if value is None:continue
            box_x=.045+(j%2)*.49;box_y=.60-(j//2)*.44
            ax.text(box_x,box_y+0.15,name,transform=ax.transAxes,fontsize=12,color=MUTED)
            ax.text(box_x,box_y,plot_format(value,percent),transform=ax.transAxes,
                    fontsize=25,color=INK,weight="bold")

    if kind not in ("pie","donut","heatmap","card") and len(series)>1:
        ax.legend(loc="upper center",bbox_to_anchor=(.5,-.19),ncol=min(4,len(series)),
                  frameon=False,fontsize=9)
    if kind not in ("pie","donut","heatmap","card","radar"):
        if percent and kind=="bar":ax.xaxis.set_major_formatter(FuncFormatter(lambda v,_:f"{v:g}%"))
        if percent and kind in ("column","line","area"):ax.yaxis.set_major_formatter(FuncFormatter(lambda v,_:f"{v:g}%"))
    fig.text(.075,.012,"Source: verified SQL result  •  Static Matplotlib figure",color=MUTED,fontsize=8.4)
    if clipped:
        fig.text(.99,.012,f"Showing {n} of {n+clipped} rows",ha="right",color=MUTED,fontsize=8.4)
    fig.tight_layout(rect=(.045,.065,.985,.925))
    buffer=BytesIO()
    fig.savefig(buffer,format="png",dpi=175,facecolor="white",bbox_inches="tight",pad_inches=.25)
    plt.close(fig)
    return buffer.getvalue()

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length=self.headers.get("Content-Length","0")
        try:
            size=int(length)
        except (ValueError,TypeError):
            size=0
        if size<=0 or size>MAX_BODY:
            self._error(413,"Invalid figure payload size.")
            return
        try:
            payload=json.loads(self.rfile.read(size).decode("utf-8"))
            png=render_png(payload)
        except (ValueError, TypeError, KeyError, OverflowError) as exc:
            self._error(422,str(exc)[:180])
            return
        except Exception:
            self._error(500,"Could not render this chart.")
            return
        self.send_response(200)
        self.send_header("Content-Type","image/png")
        self.send_header("Content-Length",str(len(png)))
        self.send_header("Cache-Control","private, no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.end_headers()
        self.wfile.write(png)
    def _error(self,status,message):
        data=json.dumps({"error":message}).encode()
        self.send_response(status)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(data)))
        self.send_header("Cache-Control","private, no-store")
        self.end_headers()
        self.wfile.write(data)
