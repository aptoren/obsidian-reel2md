# Reel2MD CLI

The Reel2MD CLI converts supported Instagram video URLs into structured Markdown notes and can optionally transcribe speech locally with `faster-whisper`.

Supported URL forms currently include Instagram `/reel/`, `/reels/`, `/p/`, and legacy `/tv/` paths. Photo-only `/p/` posts are rejected rather than treated as video sources.

The CLI exposes:

- `batch` — process a queue into Markdown notes;
- `doctor` — test Instagram and Hugging Face network access without creating notes or saving media;
- `deps` — report local Reel2MD Python dependency versions/status as JSON without network access.

Request spacing uses a fixed system minimum of 2 seconds and a maximum clamped to 2–60 seconds. The legacy `--delay-min` argument remains accepted for compatibility but no longer changes the effective system minimum.

When `--keep-video` or `--keep-audio` is enabled, `--media-dir` is required.

See the repository root README and `docs/INSTALL.md` for full documentation.
