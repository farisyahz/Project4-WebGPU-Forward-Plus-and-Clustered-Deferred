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


GIF_WIDTH = 960
GIF_FPS = 8
GIF_COLORS = 256


def encode_gif():
    # Keep the recording's native resolution so the feature captions stay legible.
    # A shared palette and stable dithering reduce changes between adjacent frames.
    filters = (
        f"fps={GIF_FPS},scale={GIF_WIDTH}:-1:flags=lanczos,split[frames][colors];"
        f"[colors]palettegen=max_colors={GIF_COLORS}:stats_mode=diff[palette];"
        "[frames][palette]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle"
    )
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


encode_gif()

if gif.stat().st_size >= 100 * 1024 * 1024:
    raise RuntimeError("The GIF exceeds GitHub's file-size limit. Lower GIF_FPS and re-encode.")

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
    "gifWidth": GIF_WIDTH,
    "gifFramesPerSecond": GIF_FPS,
    "gifPaletteColors": GIF_COLORS,
    "note": "Original application capture; recording excluded from benchmark runs.",
}
(MEDIA / "media-metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
print(json.dumps(metadata))
