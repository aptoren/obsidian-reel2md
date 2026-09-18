# Reel2MD

Reel2MD turns supported Instagram video URLs into structured Markdown notes for Obsidian or any Markdown-based knowledge base.

It is intentionally small and local-first: a Python CLI performs ingestion and local transcription, while an optional desktop-only Obsidian plugin provides configuration, validation, dependency checks, live job output, and a one-command queue workflow.

## What it does

- Reads one or many supported Instagram URLs from a Markdown/text queue.
- Supports `/reel/`, `/reels/`, `/p/`, and legacy `/tv/` URL forms.
- Canonicalizes tracking variants and deduplicates by Instagram shortcode.
- Extracts caption and source metadata with `yt-dlp`.
- Optionally falls back to a logged-in browser session for content that the same account is allowed to access.
- Resolves the media stream without requiring a permanent video download.
- Creates temporary 16 kHz mono audio for local transcription with `faster-whisper`.
- Optionally keeps the video and/or transcription audio in an explicitly configured media folder.
- Writes one structured Markdown note per source.
- Stores the human-readable source title as an Obsidian `aliases` property while keeping the filename tied to the stable source ID.
- Uses a system minimum spacing of 2 seconds and a configurable random maximum of 2–60 seconds between jobs.
- Provides local dependency, setup, and network checks from the Obsidian plugin.
- Can show live job output in an Obsidian window while processing.

`/p/` URLs are accepted when they contain video media. Photo-only posts are rejected with a clear unsupported-post error.

## Example output

```markdown
---
type: instagram-reel
platform: instagram
source_url: "https://www.instagram.com/reel/EXAMPLE/"
source_id: "EXAMPLE"
aliases:
  - "Example Reel Title"
creator: "example_creator"
creator_id: "example_creator"
published_at: "2026-09-17"
captured_at: "2026-09-17T08:00:00-04:00"
source_access: "anonymous"
metadata_access: "anonymous"
media_access: "anonymous"
caption_status: fetched
caption_method: yt-dlp
transcript_status: completed
transcript_method: "faster-whisper-small.en"
transcript_language: "en"
transcript_language_probability: 0.998
tags:
  - source/instagram
  - media/reel
---

# Example Reel Title

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
Instagram URL(s)
        ↓
Reel2MD CLI
  ├─ yt-dlp: metadata + media URL
  ├─ ffmpeg: temporary speech audio / optional retained media
  └─ faster-whisper: local transcript
        ↓
Structured Markdown
        ↓
Obsidian / Git / any Markdown workflow
```

The Obsidian plugin is deliberately thin. It starts the local CLI and does not copy Instagram cookies or credentials into the vault.

## Requirements

- Desktop OS supported by your Obsidian installation.
- Python 3.10+.
- `ffmpeg` available on the system, or an explicit path configured.
- Network access to Instagram for ingestion.
- Network access to Hugging Face when the selected Whisper model is not already cached.

The Python package installs these runtime dependencies:

- `yt-dlp`
- `faster-whisper`
- `huggingface-hub`

## Quick start: CLI

From a clone of this repository:

```bash
python3 -m venv ~/.reel2md
~/.reel2md/bin/pip install --upgrade pip
~/.reel2md/bin/pip install -e ./cli
~/.reel2md/bin/reel2md deps
~/.reel2md/bin/reel2md batch --input "Instagram Queue.md" --output "Instagram"
```

On Windows, use the equivalent virtual-environment executables under `Scripts`.

`reel2md deps` is a local, non-network check that reports the installed versions/status of Reel2MD, `yt-dlp`, `faster-whisper`, and `huggingface-hub`.

## Obsidian plugin

The plugin is desktop-only because it starts a local process.

From `plugin/`:

```bash
npm install
npm run build
```

For manual development installation, copy `manifest.json`, `main.js`, and `styles.css` into a vault plugin folder named `reel2md`.

The settings UI is grouped by workflow:

- **Source & output** — queue note and output folder. Queue paths accept the `.md` extension or omit it.
- **Processing** — caption/transcript behavior, Whisper model, metadata, and optional live job output.
- **Media retention** — keep video/audio; the media-folder field only appears when retention is enabled.
- **Local tools** — Reel2MD CLI and `ffmpeg`, with automatic local dependency status and install/repair hints.
- **Network & access** — authenticated fallback, conditional browser/proxy fields, Hugging Face Xet behavior, and **Test network**.
- **Request spacing** — fixed 2-second minimum and configurable maximum from 2 to 60 seconds.

**Test setup** and **Test network** use the same standard button style. Local dependency checks run when the settings page opens; network access is only tested when the user explicitly runs **Test network**.

See [docs/INSTALL.md](docs/INSTALL.md) for detailed setup.

## Proxy support

The plugin supports three proxy modes:

- **Inherit system proxy** — pass the current process environment through unchanged.
- **No proxy** — remove standard HTTP/HTTPS and `ALL_PROXY` variables from Reel2MD child processes.
- **Manual HTTP/HTTPS proxy** — set standard `HTTP_PROXY`/`HTTPS_PROXY` variables from one configured proxy URL and remove `ALL_PROXY`.

Manual SOCKS proxy configuration is not currently supported by the plugin UI.

The optional **Disable Hugging Face Xet** setting sets `HF_HUB_DISABLE_XET=1` for Reel2MD child processes. This can help on networks where Hugging Face Xet/CAS downloads do not work correctly.

Proxy values are stored in the plugin's local settings. Avoid embedding sensitive credentials in a proxy URL unless you accept that storage model.

## Authenticated fallback

Authenticated fallback is **off by default**. If enabled, Reel2MD asks `yt-dlp` to read cookies from the browser selected by the user, such as Firefox.

The Browser field is only shown while authenticated fallback is enabled.

Reel2MD does not copy browser cookies into the vault or generated notes. The fallback does not bypass access controls; it can only request content the logged-in browser account is already permitted to access.

## Media retention

By default:

- video is not kept;
- transcription audio is temporary and deleted after processing;
- Markdown is the durable output.

Video and/or audio retention can be enabled explicitly. The Media folder setting appears only while retention is enabled, and processing is blocked if retention is enabled without a media folder. The CLI applies the same guard when used directly.

## Request spacing

Reel2MD always uses a 2-second minimum pause between jobs. The user selects a maximum from 2 to 60 seconds. For each gap between jobs, Reel2MD randomly chooses a delay between 2 seconds and the selected maximum.

The CLI enforces the same 2–60 second range even when invoked directly.

## Validation

Run the Python regression suite from the repository root:

```bash
python -m unittest discover -s tests -v
```

The regression coverage includes supported URL forms, canonicalization, deduplication, aliases, clear rejection of photo-only `/p/` posts, request-spacing clamps, retention safety, and dependency-report shape.

## Responsible use

Reel2MD is intended for personal research, note-taking, and archiving content you are permitted to access and process. Instagram behavior and endpoints can change without notice. Respect applicable rights, platform terms, and rate limits.

## Status

Public alpha `0.1.0` is available as a GitHub pre-release. The current development version is `0.1.1`, focused on settings UX and Community Plugins submission readiness.

Release: https://github.com/aptoren/obsidian-reel2md/releases/tag/0.1.0

## License

MIT. See [LICENSE](LICENSE).
