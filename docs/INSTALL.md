# Installation

Reel2MD has two parts:

1. `reel2md` Python CLI — required.
2. Reel2MD Obsidian plugin — optional UI/orchestration layer.

## 1. System prerequisite: ffmpeg

Install `ffmpeg` using your operating system package manager and verify:

```bash
ffmpeg -version
```

## 2. Install the CLI

Linux/macOS example:

```bash
python3 -m venv ~/.reel2md
~/.reel2md/bin/pip install --upgrade pip
~/.reel2md/bin/pip install -e ./cli
~/.reel2md/bin/reel2md --help
```

Windows PowerShell example:

```powershell
py -m venv $HOME\.reel2md
& $HOME\.reel2md\Scripts\pip.exe install --upgrade pip
& $HOME\.reel2md\Scripts\pip.exe install -e .\cli
& $HOME\.reel2md\Scripts\reel2md.exe --help
```

The first transcription downloads the configured faster-whisper model if it is not already cached.

## 3. Build the Obsidian plugin

```bash
cd plugin
npm install
npm run build
```

Create a folder named `reel2md` under your vault's plugin directory and copy:

- `manifest.json`
- `main.js`
- `styles.css`

Enable Reel2MD in Obsidian Community Plugins.

## 4. Configure

In Reel2MD settings, set:

- Queue note path.
- Output folder.
- Reel2MD executable path.
- ffmpeg path if it is not on `PATH`.
- Whisper model.
- Optional browser-session fallback.
- Metadata and media retention preferences.

## Proxy note

Reel2MD does not rewrite system proxy settings. If your environment requires a proxy, configure Python, yt-dlp, and Hugging Face according to your local network. `HF_HUB_DISABLE_XET=1` can be useful on networks where Hugging Face Xet/CAS does not work correctly.
