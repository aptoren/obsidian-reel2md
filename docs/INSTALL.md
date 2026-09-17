# Installation

Reel2MD has two parts:

1. `reel2md` Python CLI — required.
2. Reel2MD Obsidian plugin — optional desktop UI/orchestration layer.

## 1. Install ffmpeg

Install `ffmpeg` using your operating-system package manager and verify:

```bash
ffmpeg -version
```

If `ffmpeg` is not on `PATH`, the plugin can be configured with its full executable path.

## 2. Install the CLI

Clone or download this repository first.

### Linux/macOS

```bash
python3 -m venv ~/.reel2md
~/.reel2md/bin/pip install --upgrade pip
~/.reel2md/bin/pip install -e ./cli
~/.reel2md/bin/reel2md --help
```

### Windows PowerShell

```powershell
py -m venv $HOME\.reel2md
& $HOME\.reel2md\Scripts\pip.exe install --upgrade pip
& $HOME\.reel2md\Scripts\pip.exe install -e .\cli
& $HOME\.reel2md\Scripts\reel2md.exe --help
```

The CLI installs `yt-dlp`, `faster-whisper`, and `huggingface-hub`.

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
.obsidian/plugins/reel2md/
```

Copy these files into it:

```text
manifest.json
main.js
styles.css
```

Restart Obsidian if necessary, then enable Reel2MD under Community Plugins.

## 4. Configure Reel2MD

Recommended first-pass settings:

- **Queue note** — vault-relative Markdown/text file containing Instagram URLs.
- **Output folder** — vault-relative folder for generated Markdown notes.
- **Reel2MD executable** — full path to the CLI executable if it is not already on `PATH`.
- **ffmpeg** — `ffmpeg` or its full executable path.
- **Whisper model** — `small.en` is the current default.
- **Browser** — browser used only if authenticated fallback is enabled.
- **Authenticated browser fallback** — off by default.
- **Include caption** — on by default.
- **Include transcript** — on by default.
- **Keep video / Keep audio** — off by default.
- **Media folder** — required only when retained media is enabled.

Supported Instagram URL paths are:

```text
/reel/<shortcode>
/reels/<shortcode>
/p/<shortcode>
/tv/<shortcode>
```

`/p/` sources must contain video media. Photo-only posts are not processed.

## 5. Configure network behavior

Reel2MD provides three proxy modes in plugin settings.

### Inherit system proxy

Uses the environment inherited by Obsidian/Reel2MD.

### No proxy

Removes these standard proxy variables for Reel2MD child processes:

```text
HTTP_PROXY
HTTPS_PROXY
ALL_PROXY
http_proxy
https_proxy
all_proxy
```

### Manual HTTP/HTTPS proxy

Provide one proxy URL, for example:

```text
http://127.0.0.1:8080
```

Reel2MD applies it to:

```text
HTTP_PROXY
HTTPS_PROXY
http_proxy
https_proxy
```

and removes `ALL_PROXY` / `all_proxy` so an inherited SOCKS proxy does not override the explicit HTTP/HTTPS configuration.

The plugin's manual proxy mode currently supports `http://` and `https://` proxy URLs, not SOCKS URLs.

Proxy values are stored in the plugin's local settings. Avoid embedding sensitive credentials unless you accept that they will be stored there.

### Hugging Face Xet

**Disable Hugging Face Xet** is enabled by default and sets:

```text
HF_HUB_DISABLE_XET=1
```

for Reel2MD child processes.

This can improve compatibility on networks where Hugging Face Xet/CAS downloads fail. It can be disabled when unnecessary.

## 6. Validate the installation

In Reel2MD settings, run **Test setup** first.

It validates:

- queue note existence;
- Reel2MD CLI execution;
- `ffmpeg`;
- proxy configuration;
- media-retention settings;
- request-spacing values.

A successful result reports:

```text
Reel2MD setup OK: queue note, CLI, ffmpeg, and local settings validated.
```

Then run **Test network**.

It uses the first supported Instagram URL in the queue and checks:

- Instagram metadata access;
- Instagram media URL access;
- Hugging Face model access.

It does not create a Markdown note or save media.

A successful result reports a summary similar to:

```text
Reel2MD network OK: instagram_metadata=anonymous instagram_media=anonymous huggingface=ok
```

## 7. Process the queue

Use the Reel2MD ribbon command or Command Palette action:

```text
Process Instagram Reel queue
```

Generated Markdown notes are written to the configured output folder.

The filename remains tied to the Instagram source ID, while the human-readable title is also written to the Obsidian `aliases` property.

## Authenticated fallback

If anonymous Instagram access fails and **Authenticated browser fallback** is enabled, Reel2MD asks `yt-dlp` to use the selected browser session.

Reel2MD does not copy those cookies into the vault or generated notes. This does not bypass access controls.

## Troubleshooting

If **Test setup** fails, fix the local executable/path/configuration error first.

If **Test network** fails, inspect the reported Instagram or Hugging Face error and verify the selected proxy mode.

If a `/p/` URL is a photo-only Instagram post, Reel2MD reports that the post does not contain video that it can process.

For reproducible debugging, run the regression suite from the repository root:

```bash
python -m unittest discover -s tests -v
```
