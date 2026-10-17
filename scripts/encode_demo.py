"""Encode the original browser-captured WebM into shareable MP4 and GIF assets.

Requires FFmpeg on PATH or the development-only imageio-ffmpeg Python package.
"""

from pathlib import Path
import json
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "docs" / "media"
ffmpeg = shutil.which("ffmpeg")
if not ffmpeg:
    import imageio_ffmpeg

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

source = MEDIA / "demo.webm"
video = MEDIA / "demo.mp4"
gif = MEDIA / "demo.gif"
capture = json.loads((MEDIA / "capture-metadata.json").read_text(encoding="utf-8"))
seek = ["-ss", str(capture["trimStartSeconds"])]
subprocess.run(
    [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        *seek,
        "-i",
        str(source),
        "-an",
        "-c:v",
        "libx264",
        "-crf",
        "22",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(video),
    ],
    check=True,
)


def encode_gif(width, colors):
    filters = f"fps=6,scale={width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors={colors}[p];[b][p]paletteuse=dither=bayer:bayer_scale=3"
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            *seek,
            "-i",
            str(source),
            "-filter_complex",
            filters,
            "-loop",
            "0",
            str(gif),
        ],
        check=True,
    )


encode_gif(480, 128)
if gif.stat().st_size > 9_500_000:
    encode_gif(400, 96)

probe = subprocess.run([ffmpeg, "-hide_banner", "-i", str(video)], capture_output=True, text=True)
match = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", probe.stderr)
if not match:
    raise RuntimeError("Could not verify the encoded demo duration")
duration = int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])
if duration < 30:
    raise RuntimeError(f"Demo is too short: {duration} seconds")
metadata = {
    "durationSeconds": duration,
    "sourceBytes": source.stat().st_size,
    "mp4Bytes": video.stat().st_size,
    "gifBytes": gif.stat().st_size,
    "note": "Original application capture; recording excluded from benchmark runs.",
}
(MEDIA / "media-metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
print(json.dumps(metadata))
