# Reel2MD

Reel2MD turns Instagram Reel URLs into structured Markdown notes for Obsidian or any Markdown-based knowledge base.

It is intentionally small and local-first: a Python CLI performs ingestion and transcription, while an optional desktop-only Obsidian plugin provides a settings UI and a one-command workflow.

## What it does

- Reads one or many Instagram Reel URLs from a Markdown/text queue.
- Deduplicates Reel IDs and skips notes that already exist.
- Extracts caption and source metadata with `yt-dlp`.
- Optionally falls back to a logged-in browser session for content that the same account is allowed to access.
- Resolves the media stream without requiring a permanent video download.
- Creates temporary 16 kHz mono audio for local transcription with `faster-whisper`.
- Optionally keeps the video and/or transcription audio.
- Writes one structured Markdown note per Reel.
- Uses conservative request spacing and stops on obvious rate-limit responses.

## Example output

```markdown
---
type: instagram-reel
platform: instagram
source_url: "https://www.instagram.com/reel/EXAMPLE/"
source_id: "EXAMPLE"
creator: "example_creator"
published_at: "2026-09-17"
captured_at: "2026-09-17T08:00:00-04:00"
source_access: "anonymous"
caption_status: fetched
transcript_status: completed
transcript_method: faster-whisper-small.en
---

# Reel title

## Source

https://www.instagram.com/reel/EXAMPLE/

## Caption

Original caption...

## Transcript

Local transcript...

## Notes

## Derived Knowledge
```

## Architecture

```text
Instagram Reel URL(s)
        ↓
Reel2MD CLI
  ├─ yt-dlp: metadata + media URL
  ├─ ffmpeg: temporary speech audio / optional media
  └─ faster-whisper: local transcript
        ↓
Structured Markdown
        ↓
Obsidian / Git / any Markdown workflow
```

The Obsidian plugin is deliberately thin. It calls the CLI and does not store Instagram credentials or cookies.

## Requirements

- Desktop OS supported by your Obsidian installation.
- Python 3.10+.
- `ffmpeg` available on the system, or an explicit path configured.
- Network access to Instagram for ingestion.
- Network access to Hugging Face on first use if the selected Whisper model is not cached.

The Python package installs `yt-dlp` and `faster-whisper` as dependencies.

## Quick start: CLI

```bash
python3 -m venv ~/.reel2md
~/.reel2md/bin/pip install -e ./cli
~/.reel2md/bin/reel2md batch --input "Instagram Queue.md" --output "Instagram"
```

On Windows, use the equivalent virtual-environment paths under `Scripts`.

## Obsidian plugin

The plugin is desktop-only because it starts the local Reel2MD CLI process.

From `plugin/`:

```bash
npm install
npm run build
```

For manual development installation, copy `manifest.json`, `main.js`, and `styles.css` into a vault plugin folder named `reel2md`.

See [docs/INSTALL.md](docs/INSTALL.md) for the current setup instructions.

## Authenticated fallback

Authenticated fallback is **off by default**. If enabled, Reel2MD asks `yt-dlp` to read cookies from a browser selected by the user (for example Firefox). Reel2MD does not copy browser cookies into the vault or generated Markdown.

This does not bypass access controls. It can only access content that the logged-in browser account is already permitted to view.

## Media retention

By default:

- video is not kept;
- transcription audio is temporary and deleted after success;
- Markdown is the durable output.

Both video and audio retention can be enabled explicitly.

## Responsible use

Reel2MD is intended for personal research, note-taking, and archiving content you are permitted to access and process. Instagram behavior and endpoints can change without notice. Respect applicable rights, platform terms, and rate limits.

## Status

`v0.1.0-alpha` — extracted from a working personal workflow and being prepared for broader testing.

## License

MIT. See [LICENSE](LICENSE).
