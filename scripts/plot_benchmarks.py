"""Generate report figures and a tidy CSV from the application's raw exports.

Usage: python scripts/plot_benchmarks.py
Requires matplotlib (analysis only; not part of the WebGPU application).
Error bars describe variation between repetition means, not confidence intervals.
"""
from pathlib import Path
import csv
import json
import statistics

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "benchmarks"
OUT = ROOT / "docs" / "media"
OUT.mkdir(parents=True, exist_ok=True)
plt.rcParams.update({
    "figure.facecolor": "#0b1220", "axes.facecolor": "#0b1220",
    "savefig.facecolor": "#0b1220", "text.color": "#e5edf9",
    "axes.labelcolor": "#b2c2d9", "xtick.color": "#b2c2d9", "ytick.color": "#b2c2d9",
    "axes.edgecolor": "#34435b", "grid.color": "#25334a", "font.size": 10,
    "axes.spines.top": False, "axes.spines.right": False, "legend.frameon": False, "axes.axisbelow": True,
})
COLORS = {"naive": "#f6b366", "forward+": "#7eafff", "clustered deferred": "#79ddbc"}
LABELS = {"naive": "Naive", "forward+": "Forward+", "clustered deferred": "Clustered deferred"}


def load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8-sig"))


def aggregate(result):
    grouped = {}
    for run in result["runs"]:
        grouped.setdefault((run["mode"], run["lights"]), []).append(run)
    output = {}
    for key, runs in grouped.items():
        gpu = [r["summary"]["gpu"]["mean"] for r in runs if r["summary"]["gpu"] is not None]
        passes = sorted({p for r in runs for p in r["summary"]["passes"]})
        output[key] = {
            "gpu": statistics.mean(gpu) if gpu else None,
            "gpu_sd": statistics.pstdev(gpu) if gpu else 0,
            "cpu": statistics.mean(r["summary"]["cpu"]["mean"] for r in runs),
            "cpu_sd": statistics.pstdev(r["summary"]["cpu"]["mean"] for r in runs),
            "passes": {p: statistics.mean(r["summary"]["passes"][p]["mean"] for r in runs if p in r["summary"]["passes"]) for p in passes},
            "clusters": runs[0]["clusters"],
        }
    return output


def finish(fig, name, note=None):
    if note:
        fig.text(.5, .01, note, ha="center", color="#90a4c0", fontsize=8)
    fig.tight_layout(rect=(0, .04 if note else 0, 1, 1))
    fig.savefig(OUT / f"{name}.png", dpi=180)
    plt.close(fig)


def line(ax, data, mode, label=None, color=None):
    points = sorted((lights, value) for (m, lights), value in data.items() if m == mode)
    ax.errorbar([p[0] for p in points], [p[1]["gpu"] for p in points],
                yerr=[p[1]["gpu_sd"] for p in points], marker="o", capsize=3,
                linewidth=2, color=color or COLORS[mode], label=label or LABELS[mode])
    ax.set_xlabel("Point lights")
    ax.set_ylabel("GPU passes (ms)")
    ax.set_ylim(bottom=0)
    ax.grid(axis="y", alpha=.6)


baseline = load("renderers.json")
core = aggregate(baseline)
optimization_file = "paired-optimizations.json" if (DATA / "paired-optimizations.json").exists() else "optimizations.json"
optimizations = load(optimization_file)["experiments"]
experiments = {e["name"]: aggregate(e["result"]) for e in optimizations}
workloads = load("workloads.json")["experiments"]
work = {e["name"]: aggregate(e["result"]) for e in workloads}
note = "Hardware WebGPU, headless Chrome, Radeon 780M, 960 × 540. Error bars: SD across repetition means."

fig, axes = plt.subplots(1, 2, figsize=(11, 4.6))
for mode in COLORS:
    line(axes[0], core, mode)
for mode in ["forward+", "clustered deferred"]:
    line(axes[1], core, mode)
axes[0].set_title("All three renderers", loc="left", fontweight="bold")
axes[1].set_title("Clustered renderers", loc="left", fontweight="bold")
for ax in axes:
    ax.legend()
finish(fig, "renderer-scaling", note)

fig, ax = plt.subplots(figsize=(9, 4.8))
for name, color in zip(["Deferred baseline", "Compute lighting", "Packed G-buffer", "Packed + compute", "Packed + compute + bloom"], ["#79ddbc", "#7eafff", "#c4a0fa", "#f6b366", "#f391ae"]):
    line(ax, experiments[name], "clustered deferred", name, color)
ax.set_title("Deferred pipeline variants", loc="left", fontweight="bold")
ax.legend(ncol=2, fontsize=9)
finish(fig, "deferred-variants", f"Same scene and camera, 30 warmup + 90 samples × {optimizations[0]['result']['methodology']['repeats']} repetitions per case. GPU milliseconds.")

fig, axes = plt.subplots(1, 2, figsize=(11, 4.7))
for enabled, color in [(False, "#7eafff"), (True, "#79ddbc")]:
    line(axes[0], experiments[f"Forward+ prepass {str(enabled).lower()}"], "forward+", f"Prepass {'on' if enabled else 'off'}", color)
axes[0].set_title("Depth prepass: total GPU cost", loc="left", fontweight="bold")
axes[0].legend()
x = np.arange(3)
for enabled, offset, color in [(False, -.18, "#7eafff"), (True, .18, "#79ddbc")]:
    values = [experiments[f"Render bundles {str(enabled).lower()}"][(mode, 500)] for mode in COLORS]
    axes[1].bar(x + offset, [v["cpu"] for v in values], width=.34,
                yerr=[v["cpu_sd"] for v in values], capsize=3, color=color, error_kw={"ecolor": "#dae5f5"},
                label=f"Bundles {'on' if enabled else 'off'}")
axes[1].set_xticks(x, ["Naive", "Forward+", "Deferred"])
axes[1].set_ylabel("CPU encoding (ms)")
axes[1].set_title("Render bundles: CPU cost at 500 lights", loc="left", fontweight="bold")
axes[1].legend()
axes[1].grid(axis="y", alpha=.4)
finish(fig, "prepass-bundles", "Different quantities: prepass targets GPU shading; bundles target CPU command encoding")

fig, ax = plt.subplots(figsize=(7.5, 4.5))
bottom = np.zeros(2)
for name, values, color in [("G-buffer color", [28, 8], "#7eafff"), ("Depth", [4, 4], "#c4a0fa"), ("Shared HDR output", [8, 8], "#79ddbc")]:
    ax.bar([0, 1], values, bottom=bottom, width=.5, label=name, color=color)
    bottom += values
for i, total in enumerate(bottom):
    ax.text(i, total + .7, f"{int(total)} B/pixel", ha="center")
ax.set_xticks([0, 1], ["Baseline deferred", "Packed deferred"])
ax.set_ylabel("Logical storage (bytes / pixel)")
ax.set_ylim(0, 48)
ax.set_title("Logical render-target storage", loc="left", fontweight="bold")
ax.legend(loc="upper right")
finish(fig, "gbuffer-memory", "Geometry: 32 to 12 B/pixel. Shared HDR: 8 B/pixel. Bloom excluded. Format-based estimate.")

fig, axes = plt.subplots(1, 2, figsize=(11, 4.6))
sizes = ["960x540", "1280x720", "1920x1080"]
for mode in ["forward+", "clustered deferred"]:
    values = [work[f"Resolution {size}"][(mode, 2000)] for size in sizes]
    axes[0].errorbar(range(3), [v["gpu"] for v in values], yerr=[v["gpu_sd"] for v in values], marker="o", capsize=3, color=COLORS[mode], label=LABELS[mode])
for enabled, offset, color in [(False, -.18, "#7eafff"), (True, .18, "#79ddbc")]:
    values = [work[f"Bloom {str(enabled).lower()} {size}"][("clustered deferred", 2000)] for size in sizes]
    axes[1].bar(np.arange(3) + offset, [v["gpu"] for v in values], width=.34,
                yerr=[v["gpu_sd"] for v in values], capsize=3, color=color, error_kw={"ecolor": "#dae5f5"}, label=f"Bloom {'on' if enabled else 'off'}")
for ax in axes:
    ax.set_xticks(range(3), [s.replace("x", " × ") for s in sizes])
    ax.set_ylabel("GPU passes (ms)")
    ax.set_ylim(bottom=0)
    ax.grid(axis="y", alpha=.4)
    ax.legend()
axes[0].set_title("Baseline renderers versus resolution", loc="left", fontweight="bold")
axes[1].set_title("Bloom cost with packed compute deferred", loc="left", fontweight="bold")
finish(fig, "resolution-bloom", "2,000 lights, 30 warmup + 60 samples × 2 repetitions per case")

fig, axes = plt.subplots(1, 2, figsize=(11, 4.6))
poses = ["Atrium", "Balcony", "Side aisle"]
grids = ["8x6x16", "16x12x24", "24x18x32"]
for mode, offset in [("forward+", -.18), ("clustered deferred", .18)]:
    values = [work[f"Camera {pose}"][(mode, 2000)] for pose in poses]
    axes[0].bar(np.arange(3) + offset, [v["gpu"] for v in values], width=.34, yerr=[v["gpu_sd"] for v in values], capsize=3, color=COLORS[mode], error_kw={"ecolor": "#dae5f5"}, label=LABELS[mode])
    values = [work[f"Grid {grid}"][(mode, 2000)] for grid in grids]
    axes[1].errorbar([768, 4608, 13824], [v["gpu"] for v in values], yerr=[v["gpu_sd"] for v in values], marker="o", capsize=3, color=COLORS[mode], label=LABELS[mode])
axes[0].set_xticks(range(3), poses)
axes[1].set_xticks([768, 4608, 13824], ["768", "4,608", "13,824"])
axes[1].set_xlabel("Clusters in the frustum")
axes[0].set_title("Camera workload", loc="left", fontweight="bold")
axes[1].set_title("Cluster-grid tradeoff", loc="left", fontweight="bold")
for ax in axes:
    ax.set_ylabel("GPU passes (ms)")
    ax.set_ylim(bottom=0)
    ax.grid(axis="y", alpha=.4)
    ax.legend()
finish(fig, "camera-grid", "2,000 lights, 960 × 540, equal light seed/time; different visibility and cluster occupancy")

fig, axes = plt.subplots(1, 2, figsize=(11, 4.6))
for mode, ax in zip(["forward+", "clustered deferred"], axes):
    for name, color in [("fixed-list-smoke.json", "#f391ae"), ("compact-list-smoke.json", "#79ddbc")]:
        line(ax, aggregate(load(name)), mode, "128-entry fixed lists" if name.startswith("fixed") else "Variable-length pool", color)
    ax.set_title(LABELS[mode], loc="left", fontweight="bold")
    ax.legend()
finish(fig, "light-list-optimization", "Diagnostic runs: 10 warmup + 30 samples, one repetition, before the shared HDR composite was introduced")

all_rows = []
datasets = [("Renderer sweep", baseline)] + [(e["name"], e["result"]) for e in optimizations + workloads]
for name, result in datasets:
    for run in result["runs"]:
        row = {"experiment": name, "mode": run["mode"], "lights": run["lights"], "repeat": run["repeat"], "width": result["environment"]["width"], "height": result["environment"]["height"], "gpu_mean_ms": run["summary"]["gpu"]["mean"] if run["summary"]["gpu"] else "", "cpu_mean_ms": run["summary"]["cpu"]["mean"], "overflow_clusters": run["clusters"]["overflow"] if run["clusters"] else "", "grid": "x".join(str(result["settings"][f"cluster{axis}"]) for axis in "XYZ")}
        all_rows.append(row)
with (DATA / "summary.csv").open("w", newline="", encoding="utf-8") as file:
    writer = csv.DictWriter(file, fieldnames=list(all_rows[0]))
    writer.writeheader()
    writer.writerows(all_rows)
report = {"renderers": {f"{mode}/{lights}": values for (mode, lights), values in core.items()}, "optimizations": {name: {f"{mode}/{lights}": values for (mode, lights), values in data.items()} for name, data in experiments.items()}, "workloads": {name: {f"{mode}/{lights}": values for (mode, lights), values in data.items()} for name, data in work.items()}}
(DATA / "report-summary.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(f"Generated 7 figures, {len(all_rows)} CSV rows, and report-summary.json")
