# Reel2MD

Reel2MD turns supported Instagram video URLs into structured Markdown notes for Obsidian or any Markdown-based knowledge base.

It is intentionally small and local-first: a Python CLI performs ingestion and local transcription, while an optional desktop-only Obsidian plugin provides configuration, validation, dependency checks, live job output, and a one-command queue workflow.

> **New to Reel2MD?** Start with the [Beginner installation guide](#beginner-installation-guide). It walks through installation, first setup, testing, and common problems step by step.

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

## External access and data handling

Reel2MD is local-first, but ingestion and model setup require explicit external access:

- **Instagram** — `yt-dlp` requests metadata and media for the Instagram URLs you choose to process. Media may be served from Instagram/CDN endpoints.
- **Hugging Face** — `faster-whisper` model metadata/files are accessed when the selected model is not already cached, and when you explicitly run the network test.
- **Authenticated browser fallback** — off by default. If enabled, `yt-dlp` reads the selected browser's existing session only when anonymous Instagram access fails. Reel2MD does not copy browser cookie values into the vault or generated Markdown.
- **Local processes** — the desktop plugin starts the configured `reel2md` CLI and `ffmpeg` executables on your machine.
- **Files** — generated Markdown is written to the configured vault folder. Retained video/audio is written only when you enable retention and explicitly configure a media folder; that folder may be outside the vault.
- **Proxy settings** — a manually entered proxy URL is stored in the plugin's local settings. Avoid embedding credentials unless you accept that local storage model.

Opening the settings page runs local dependency checks only. Instagram and Hugging Face network checks run only when you explicitly choose **Test network**. Reel2MD does not implement analytics or telemetry.

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

## Beginner installation guide

If you are not a developer, use this section. You do **not** need to clone the repository or build anything from source.

> **Current testing status:** Reel2MD 0.1.1 has been tested end-to-end on Ubuntu. Windows and macOS users are especially welcome to test it and report anything that behaves differently.

### Step 1 — Install Python and ffmpeg

Reel2MD needs:

- **Python 3.10 or newer**
- **ffmpeg**
- the desktop version of **Obsidian**

Check Python:

**Windows PowerShell**

```powershell
py --version
```

**macOS / Linux**

```bash
python3 --version
```

Check ffmpeg:

```bash
ffmpeg -version
```

If ffmpeg is missing, common installation commands are:

**Windows PowerShell**

```powershell
winget install Gyan.FFmpeg
```

**macOS with Homebrew**

```bash
brew install ffmpeg
```

**Ubuntu / Debian**

```bash
sudo apt update
sudo apt install ffmpeg
```

After installing Python or ffmpeg, close and reopen Obsidian before continuing.

### Step 2 — Download Reel2MD 0.1.1

Until Reel2MD is available in the Obsidian Community Plugins directory, installation is manual.

Download exactly these two files:

- [Reel2MD plugin ZIP](https://github.com/aptoren/obsidian-reel2md/releases/download/0.1.1/reel2md-0.1.1-plugin.zip)
- [Reel2MD CLI wheel](https://github.com/aptoren/obsidian-reel2md/releases/download/0.1.1/reel2md-0.1.1-py3-none-any.whl)

The ZIP is the Obsidian plugin. The `.whl` file is the local Reel2MD command-line component used by the plugin.

You can also view the complete [Reel2MD 0.1.1 release](https://github.com/aptoren/obsidian-reel2md/releases/tag/0.1.1).

### Step 3 — Install the local Reel2MD CLI

The commands below create a dedicated Reel2MD Python environment so it does not interfere with your other Python software.

#### Windows PowerShell

Assuming the wheel is in your Downloads folder:

```powershell
py -m venv "$HOME\.reel2md"
& "$HOME\.reel2md\Scripts\python.exe" -m pip install --upgrade pip
& "$HOME\.reel2md\Scripts\python.exe" -m pip install "$HOME\Downloads\reel2md-0.1.1-py3-none-any.whl"
& "$HOME\.reel2md\Scripts\reel2md.exe" deps
```

Your Reel2MD executable is:

```text
%USERPROFILE%\.reel2md\Scripts\reel2md.exe
```

In Reel2MD settings, use the full expanded path shown by:

```powershell
Write-Output "$HOME\.reel2md\Scripts\reel2md.exe"
```

#### macOS / Linux

Assuming the wheel is in your Downloads folder:

```bash
python3 -m venv "$HOME/.reel2md"
"$HOME/.reel2md/bin/python" -m pip install --upgrade pip
"$HOME/.reel2md/bin/python" -m pip install "$HOME/Downloads/reel2md-0.1.1-py3-none-any.whl"
"$HOME/.reel2md/bin/reel2md" deps
```

Your Reel2MD executable is:

```text
$HOME/.reel2md/bin/reel2md
```

To print the full path for the Obsidian setting:

```bash
echo "$HOME/.reel2md/bin/reel2md"
```

A successful `reel2md deps` check reports Reel2MD, `yt-dlp`, `faster-whisper`, and `huggingface-hub`.

### Step 4 — Install the Obsidian plugin

1. Close Obsidian.
2. Open your Obsidian vault folder in your file manager.
3. Open the hidden `.obsidian` folder.
   - On Windows, enable **View → Show → Hidden items** if needed.
   - On macOS, press **Command + Shift + .** to show hidden files if needed.
4. Inside `.obsidian`, open or create the `plugins` folder.
5. Create this folder:

```text
reel-to-md
```

The final location should be:

```text
<Vault>/.obsidian/plugins/reel-to-md/
```

6. Open `reel2md-0.1.1-plugin.zip`.
7. Copy these three files directly into the `reel-to-md` folder:

```text
main.js
manifest.json
styles.css
```

Do not leave them inside an extra nested folder.

8. Start Obsidian.
9. Open **Settings → Community plugins**.
10. Enable **Reel2MD**.

If Reel2MD does not appear, see **Troubleshooting** below.

### Step 5 — Configure Reel2MD

Open:

```text
Settings → Reel2MD
```

Start with these settings:

- **Queue note** — a note containing one or more Instagram URLs.
  - Example: `Sources/Media/Instagram-Queue.md`
- **Output folder** — the vault folder where Reel2MD should create Markdown notes.
- **Reel2MD executable** — paste the full executable path from Step 3.
- **ffmpeg** — leave this as `ffmpeg` if `ffmpeg -version` worked in your terminal.
- **Include caption** — ON
- **Include transcript** — ON
- **Authenticated browser fallback** — leave OFF for your first test.
- **Keep video / Keep audio** — leave OFF for your first test.

You do not need to change the other settings for a basic first run.

### Step 6 — Create a test queue note

Create the queue note you selected in Step 5 and place one supported Instagram URL on its own line, for example:

```text
https://www.instagram.com/reel/EXAMPLE/
```

Supported URL types are:

```text
/reel/<shortcode>
/reels/<shortcode>
/p/<shortcode>   (video posts only)
/tv/<shortcode>
```

Photo-only `/p/` posts are intentionally not supported.

### Step 7 — Run Test setup

In **Settings → Reel2MD**, click **Test setup**.

A successful result looks like:

```text
Reel2MD setup OK: queue note, CLI dependencies, ffmpeg, and local settings validated.
```

If this test fails, fix the reported item before continuing.

### Step 8 — Run Test network

Click **Test network**.

A successful result looks similar to:

```text
Reel2MD network OK: instagram_metadata=anonymous instagram_media=anonymous huggingface=ok
```

The first Hugging Face/model access can take longer than later runs.

### Step 9 — Process your first Reel

Open the Command Palette and run:

```text
Process Instagram Reel queue
```

If **Show live job output** is enabled, a window shows progress while Reel2MD runs.

A successful single-item job ends with:

```text
SUMMARY created=1 skipped=0 failed=0
```

Your generated Markdown note should then appear in the configured output folder.

## Troubleshooting for beginners

### Reel2MD does not appear in Obsidian

Check all of these:

- the folder is named exactly `reel-to-md`;
- the folder is directly inside `.obsidian/plugins/`;
- `main.js`, `manifest.json`, and `styles.css` are directly inside that folder;
- there is no extra nested folder from the ZIP;
- Obsidian was restarted after copying the files;
- Community plugins are enabled in Obsidian.

Correct:

```text
.obsidian/plugins/reel-to-md/manifest.json
.obsidian/plugins/reel-to-md/main.js
.obsidian/plugins/reel-to-md/styles.css
```

Incorrect:

```text
.obsidian/plugins/reel-to-md/reel2md-0.1.1-plugin/manifest.json
```

### Test setup says Reel2MD is missing

The **Reel2MD executable** setting is probably incorrect.

Use the full path:

**Windows**

```text
C:\Users\USERNAME\.reel2md\Scripts\reel2md.exe
```

**macOS / Linux**

```text
/Users/USERNAME/.reel2md/bin/reel2md
```

or:

```text
/home/USERNAME/.reel2md/bin/reel2md
```

Then reopen Reel2MD settings.

### The dependency checker says the CLI is outdated

Install the current wheel again:

**Windows PowerShell**

```powershell
& "$HOME\.reel2md\Scripts\python.exe" -m pip install --upgrade --force-reinstall "$HOME\Downloads\reel2md-0.1.1-py3-none-any.whl"
```

**macOS / Linux**

```bash
"$HOME/.reel2md/bin/python" -m pip install --upgrade --force-reinstall "$HOME/Downloads/reel2md-0.1.1-py3-none-any.whl"
```

Then restart Obsidian.

### Test setup says ffmpeg is missing

First check:

```bash
ffmpeg -version
```

If that fails, install ffmpeg using Step 1.

If it works in your terminal but Reel2MD still cannot find it, enter the full ffmpeg path in Reel2MD settings.

**macOS / Linux**

```bash
which ffmpeg
```

**Windows**

```powershell
where.exe ffmpeg
```

### Test network fails on Instagram

Try these in order:

1. Make sure the URL in your queue opens normally in a browser.
2. Try a public Reel first.
3. Check Reel2MD's **Proxy mode** if your network requires a proxy.
4. If anonymous access fails for content your account can access, enable **Authenticated browser fallback** and select the browser where you are already logged into Instagram.
5. Run **Test network** again.

Authenticated fallback does not bypass Instagram permissions. It only uses access already available to your logged-in browser session.

### Hugging Face or the Whisper model download fails

Check that your network can reach Hugging Face.

In Reel2MD settings, **Disable Hugging Face Xet** is enabled by default because it can improve compatibility on some networks. Leave it enabled unless you have a reason to change it.

The first model download is much larger than later runs, so it can take some time.

### A `/p/` Instagram URL is rejected

Reel2MD accepts `/p/` URLs only when the post contains video. Photo-only posts are not supported.

### The job says `skipped=1`

Reel2MD deduplicates Instagram sources by shortcode. A source that has already been processed may be skipped instead of being imported again.

### You enabled Keep video or Keep audio and processing is blocked

When either retention option is enabled, **Media folder** is required.

Either:

- configure a media folder; or
- turn **Keep video** and **Keep audio** back OFF.

### You use a proxy

Start with **Inherit system proxy**.

If you need a manually configured HTTP/HTTPS proxy, select **Manual HTTP/HTTPS proxy** and enter the proxy URL.

The plugin UI does not currently support manually configured SOCKS proxy URLs.

### Still stuck?

When reporting a problem, include:

```text
Operating system:
Obsidian version:
Reel2MD version:
Python version:
ffmpeg version:
Test setup result:
Test network result:
Live job output / error:
Instagram URL type: reel / reels / p / tv
```

You do not need to share private Instagram URLs or credentials.

For more technical installation details, see [docs/INSTALL.md](docs/INSTALL.md).

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

The repository-root `manifest.json` is the manifest consumed by the Obsidian Community directory. `plugin/manifest.json` is kept byte-for-byte identical for local development and release packaging.

The plugin is desktop-only because it starts a local process.

From `plugin/`:

```bash
npm install
npm run build
```

For manual development installation, copy `manifest.json`, `main.js`, and `styles.css` into a vault plugin folder named `reel-to-md`. The folder name should match the plugin `id` in `manifest.json`.

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
PYTHONPATH=cli python3 -m unittest discover -s tests -v
```

The regression coverage includes supported URL forms, canonicalization, deduplication, aliases, clear rejection of photo-only `/p/` posts, request-spacing clamps, retention safety, and dependency-report shape.

## Responsible use

Reel2MD is intended for personal research, note-taking, and archiving content you are permitted to access and process. Instagram behavior and endpoints can change without notice. Respect applicable rights, platform terms, and rate limits.

## Status

Reel2MD 0.1.1 is the current public release.

It has been validated end-to-end on Ubuntu with the Obsidian desktop plugin, including clean CLI installation, local dependency checks, Instagram/Hugging Face network diagnostics, and real queue processing.

Broader operating-system and environment coverage is still limited.

Release: https://github.com/aptoren/obsidian-reel2md/releases/tag/0.1.1

## License

MIT. See [LICENSE](LICENSE).
