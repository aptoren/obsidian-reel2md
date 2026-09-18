# Installation

Reel2MD has two parts:

1. `reel2md` Python CLI — required.
2. Reel2MD Obsidian plugin — optional desktop UI/orchestration layer.

## 1. Install ffmpeg

Install `ffmpeg` using your operating-system package manager and verify:

```bash
ffmpeg -version
```

Examples:

- Ubuntu/Debian: `sudo apt install ffmpeg`
- macOS with Homebrew: `brew install ffmpeg`
- Windows with winget: `winget install Gyan.FFmpeg`

If `ffmpeg` is not on `PATH`, configure the plugin with its full executable path.

## 2. Install the CLI

Clone or download this repository first.

### Linux/macOS

```bash
python3 -m venv ~/.reel2md
~/.reel2md/bin/pip install --upgrade pip
~/.reel2md/bin/pip install -e ./cli
~/.reel2md/bin/reel2md deps
~/.reel2md/bin/reel2md --help
```

### Windows PowerShell

```powershell
py -m venv $HOME\.reel2md
& $HOME\.reel2md\Scripts\pip.exe install --upgrade pip
& $HOME\.reel2md\Scripts\pip.exe install -e .\cli
& $HOME\.reel2md\Scripts\reel2md.exe deps
& $HOME\.reel2md\Scripts\reel2md.exe --help
```

The CLI installs `yt-dlp`, `faster-whisper`, and `huggingface-hub`.

`reel2md deps` is a local, non-network dependency check. If one of those Python packages is missing, reinstall or repair the Reel2MD CLI environment.

The first transcription downloads the configured faster-whisper model if it is not already cached.

## 3. Build the Obsidian plugin

From the repository:

```bash
cd plugin
npm install
npm run build
```

Create this folder under your vault:

```text
.obsidian/plugins/reel-to-md/
```

Copy these files into it:

```text
manifest.json
main.js
styles.css
```

The folder name must match the plugin ID: `reel-to-md`. For Community directory submission, the repository-root `manifest.json` is authoritative; `plugin/manifest.json` must remain identical to it.

Restart Obsidian if necessary, then enable Reel2MD under Community Plugins.

## 4. Configure Reel2MD

The settings page is grouped into the following sections.

### Source & output

- **Queue note** — vault-relative note containing supported Instagram URLs.
  - `.md` is optional.
  - Example: `Sources/Media/Instagram-Queue.md`
- **Output folder** — vault-relative folder for generated Markdown notes.

Supported Instagram URL paths are:

```text
/reel/<shortcode>
/reels/<shortcode>
/p/<shortcode>
/tv/<shortcode>
```

`/p/` sources must contain video media. Photo-only posts are not processed.

### Processing

- **Include caption** — on by default.
- **Include transcript** — on by default.
- **Whisper model** — shown only when transcription is enabled; `small.en` is the default.
- **Show live job output** — optionally opens an Obsidian window with live CLI stdout/stderr while a queue job is running.
- Metadata toggles control creator, publication time, capture time, access provenance, and transcript metadata.

Closing the live-output window does not stop the running job.

### Media retention

- **Keep video** — off by default.
- **Keep audio** — off by default.
- **Media folder** — shown only when either retention option is enabled.

A media folder is mandatory while retention is enabled. Both the plugin and direct CLI usage enforce this guard.

### Local tools

- **Reel2MD executable** — `reel2md` or a full executable path.
- **ffmpeg** — `ffmpeg` or a full executable path.

When the settings page opens, Reel2MD performs local, non-network checks for:

- Reel2MD CLI;
- `ffmpeg`;
- `yt-dlp`;
- `faster-whisper`;
- `huggingface-hub`.

Detected versions/status are shown in the settings page. When a dependency is unavailable, a short install or repair hint is shown next to it.

The configured command values remain portable (`reel2md`, `ffmpeg`) when they already resolve through `PATH`; the UI may also show the detected executable path.

## 5. Configure network behavior

### Authenticated fallback

**Authenticated browser fallback** is off by default. The Browser field is shown only when fallback is enabled.

If anonymous Instagram access fails and fallback is enabled, Reel2MD asks `yt-dlp` to use the selected browser session. Reel2MD does not copy those cookies into the vault or generated notes.

### Proxy modes

Reel2MD provides three proxy modes:

- **Inherit system proxy**
- **No proxy**
- **Manual HTTP/HTTPS proxy**

The Proxy URL field is shown only in Manual mode.

Manual mode applies the configured URL to:

```text
HTTP_PROXY
HTTPS_PROXY
http_proxy
https_proxy
```

and removes:

```text
ALL_PROXY
all_proxy
```

The plugin UI does not currently support manual SOCKS proxy URLs.

Proxy values are stored in the plugin's local settings. Avoid embedding sensitive credentials unless you accept that storage model.

### Hugging Face Xet

**Disable Hugging Face Xet** is enabled by default and sets:

```text
HF_HUB_DISABLE_XET=1
```

for Reel2MD child processes.

This can improve compatibility on networks where Hugging Face Xet/CAS downloads fail.

### Test network

**Test network** is located at the end of the Network & access section.

It uses the first supported Instagram URL in the queue and checks:

- Instagram metadata access;
- Instagram media URL access;
- Hugging Face model access.

It does not create a Markdown note or save media. Network tests are not run automatically when the settings page opens.

## 6. Configure request spacing

The minimum spacing is a system value fixed at **2 seconds**.

Choose **Maximum spacing** from a dropdown containing values from **2 to 60 seconds**.

Between jobs, Reel2MD randomly chooses a wait time between 2 seconds and the configured maximum. For example, a maximum of 15 means each inter-job delay is randomly selected from 2–15 seconds.

The CLI applies the same limits even when used directly.

## 7. Validate the installation

Run **Test setup** first.

It validates:

- queue note resolution, including paths entered without `.md`;
- Reel2MD CLI and Python dependency status;
- `ffmpeg`;
- proxy configuration;
- media-retention settings;
- request-spacing settings.

A successful result reports:

```text
Reel2MD setup OK: queue note, CLI dependencies, ffmpeg, and local settings validated.
```

Then run **Test network**.

A successful result reports a summary similar to:

```text
Reel2MD network OK: instagram_metadata=anonymous instagram_media=anonymous huggingface=ok
```

## 8. Process the queue

Use the Reel2MD ribbon command or Command Palette action:

```text
Process Instagram Reel queue
```

Generated Markdown notes are written to the configured output folder.

The filename remains tied to the Instagram source ID, while the human-readable title is also written to the Obsidian `aliases` property.

If **Show live job output** is enabled, an Obsidian window displays progress such as:

```text
Found: 2 unique Instagram URL(s)
[1/2] ABC123
OK
WAIT 8.4 seconds
[2/2] XYZ789
OK
SUMMARY created=2 skipped=0 failed=0
```

## Troubleshooting

If **Test setup** fails, use the local dependency status and hint shown under **Local tools** first.

If **Test network** fails, inspect the reported Instagram or Hugging Face error and verify the selected proxy mode.

If a `/p/` URL is a photo-only Instagram post, Reel2MD reports that the post does not contain video that it can process.

For reproducible debugging, run the regression suite from the repository root:

```bash
PYTHONPATH=cli python3 -m unittest discover -s tests -v
```
