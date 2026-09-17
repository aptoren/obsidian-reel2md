# Reel2MD CLI

The Reel2MD CLI converts supported Instagram video URLs into structured Markdown notes and can optionally transcribe speech locally with `faster-whisper`.

Supported URL forms currently include Instagram `/reel/`, `/reels/`, `/p/`, and legacy `/tv/` paths. Photo-only `/p/` posts are rejected rather than treated as video sources.

The CLI also exposes a `doctor` command used by the Obsidian plugin to test Instagram and Hugging Face network access without creating notes or saving media.

See the repository root README and `docs/INSTALL.md` for full documentation.
