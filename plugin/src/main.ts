import { App, FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { spawn } from "child_process";
import * as os from "os";
import * as path from "path";

interface Reel2MDSettings {
  queuePath: string;
  outputFolder: string;
  mediaFolder: string;
  executable: string;
  ffmpeg: string;
  model: string;
  authFallback: boolean;
  browser: string;
  includeCaption: boolean;
  includeTranscript: boolean;
  keepVideo: boolean;
  keepAudio: boolean;
  includeCreator: boolean;
  includeCreatorId: boolean;
  includePublishedAt: boolean;
  includeCapturedAt: boolean;
  includeAccessMeta: boolean;
  includeTranscriptMeta: boolean;
  delayMin: number;
  delayMax: number;
}

const DEFAULT_SETTINGS: Reel2MDSettings = {
  queuePath: "Sources/Media/Instagram Queue.md",
  outputFolder: "Sources/Media/Instagram",
  mediaFolder: "",
  executable: "reel2md",
  ffmpeg: "ffmpeg",
  model: "small.en",
  authFallback: false,
  browser: "firefox",
  includeCaption: true,
  includeTranscript: true,
  keepVideo: false,
  keepAudio: false,
  includeCreator: true,
  includeCreatorId: true,
  includePublishedAt: true,
  includeCapturedAt: true,
  includeAccessMeta: true,
  includeTranscriptMeta: true,
  delayMin: 3,
  delayMax: 15
};

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export default class Reel2MDPlugin extends Plugin {
  settings: Reel2MDSettings = DEFAULT_SETTINGS;
  private running = false;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.addCommand({
      id: "process-queue",
      name: "Process Instagram Reel queue",
      callback: () => void this.processQueue()
    });

    this.addRibbonIcon("clapperboard", "Process Reel2MD queue", () => void this.processQueue());
    this.addSettingTab(new Reel2MDSettingTab(this.app, this));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private absoluteVaultPath(relativePath: string): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Reel2MD requires a desktop filesystem vault.");
    }
    return path.resolve(adapter.getBasePath(), relativePath);
  }

  private boolArg(name: string, enabled: boolean): string {
    return enabled ? `--${name}` : `--no-${name}`;
  }

  private async processQueue(): Promise<void> {
    if (this.running) {
      new Notice("Reel2MD is already running.");
      return;
    }

    let input: string;
    let output: string;
    try {
      input = this.absoluteVaultPath(this.settings.queuePath);
      output = this.absoluteVaultPath(this.settings.outputFolder);
    } catch (error) {
      new Notice(String(error));
      return;
    }

    const executable = expandHome(this.settings.executable);
    const args = [
      "batch",
      "--input", input,
      "--output", output,
      "--ffmpeg", expandHome(this.settings.ffmpeg),
      "--model", this.settings.model,
      "--browser", this.settings.browser,
      this.boolArg("auth-fallback", this.settings.authFallback),
      this.boolArg("caption", this.settings.includeCaption),
      this.boolArg("transcript", this.settings.includeTranscript),
      this.boolArg("keep-video", this.settings.keepVideo),
      this.boolArg("keep-audio", this.settings.keepAudio),
      this.boolArg("creator", this.settings.includeCreator),
      this.boolArg("creator-id", this.settings.includeCreatorId),
      this.boolArg("published-at", this.settings.includePublishedAt),
      this.boolArg("captured-at", this.settings.includeCapturedAt),
      this.boolArg("access-meta", this.settings.includeAccessMeta),
      this.boolArg("transcript-meta", this.settings.includeTranscriptMeta),
      "--delay-min", String(this.settings.delayMin),
      "--delay-max", String(this.settings.delayMax)
    ];

    if (this.settings.mediaFolder.trim()) {
      args.push("--media-dir", expandHome(this.settings.mediaFolder.trim()));
    }

    this.running = true;
    new Notice("Reel2MD started. Processing the queue in the background.");

    const child = spawn(executable, args, {
      cwd: path.dirname(input),
      env: { ...process.env, HF_HUB_DISABLE_XET: process.env.HF_HUB_DISABLE_XET ?? "1" },
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 12000) stdout = stdout.slice(-12000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    child.on("error", (error) => {
      this.running = false;
      new Notice(`Reel2MD could not start: ${error.message}`, 10000);
    });

    child.on("close", (code) => {
      this.running = false;
      if (code === 0) {
        const summary = stdout.split("\n").reverse().find((line) => line.startsWith("SUMMARY"));
        new Notice(summary ? `Reel2MD finished. ${summary}` : "Reel2MD finished.", 8000);
      } else {
        const detail = stderr.trim().split("\n").slice(-3).join(" ") || `exit code ${code}`;
        new Notice(`Reel2MD failed: ${detail}`, 12000);
      }
    });
  }
}

class Reel2MDSettingTab extends PluginSettingTab {
  plugin: Reel2MDPlugin;

  constructor(app: App, plugin: Reel2MDPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Reel2MD" });
    containerEl.createEl("p", {
      text: "Reel2MD calls a local CLI. It does not store Instagram cookies or credentials in your vault."
    });

    this.textSetting("Queue note", "Vault-relative file containing Reel URLs.", "queuePath");
    this.textSetting("Output folder", "Vault-relative folder for generated Markdown notes.", "outputFolder");
    this.textSetting("Media folder", "Optional absolute folder for retained video/audio. Leave blank if media is temporary.", "mediaFolder");
    this.textSetting("Reel2MD executable", "Executable path or command name.", "executable");
    this.textSetting("ffmpeg", "ffmpeg executable path or command name.", "ffmpeg");
    this.textSetting("Whisper model", "Example: small.en", "model");
    this.textSetting("Browser", "Browser used only for authenticated fallback, e.g. firefox.", "browser");

    this.toggleSetting("Authenticated browser fallback", "Retry with the selected browser session if anonymous access fails.", "authFallback");
    this.toggleSetting("Include caption", "Write the Instagram caption into the Markdown note.", "includeCaption");
    this.toggleSetting("Include transcript", "Create a local faster-whisper transcript.", "includeTranscript");
    this.toggleSetting("Keep video", "Keep an MP4 copy in the media folder.", "keepVideo");
    this.toggleSetting("Keep audio", "Keep the 16 kHz mono WAV used for transcription.", "keepAudio");

    containerEl.createEl("h3", { text: "Metadata" });
    this.toggleSetting("Creator", "Include creator name.", "includeCreator");
    this.toggleSetting("Creator ID", "Include creator/channel ID when available.", "includeCreatorId");
    this.toggleSetting("Published time", "Include source publication date/time when available.", "includePublishedAt");
    this.toggleSetting("Captured time", "Include ingestion timestamp.", "includeCapturedAt");
    this.toggleSetting("Access provenance", "Include anonymous/authenticated access fields.", "includeAccessMeta");
    this.toggleSetting("Transcript metadata", "Include model, detected language, and confidence.", "includeTranscriptMeta");

    containerEl.createEl("h3", { text: "Request spacing" });
    this.numberSetting("Minimum delay (seconds)", "Minimum pause between Reel jobs.", "delayMin");
    this.numberSetting("Maximum delay (seconds)", "Maximum pause between Reel jobs.", "delayMax");
  }

  private textSetting(name: string, desc: string, key: keyof Reel2MDSettings): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => text
        .setValue(String(this.plugin.settings[key]))
        .onChange(async (value) => {
          (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
          await this.plugin.saveSettings();
        }));
  }

  private toggleSetting(name: string, desc: string, key: keyof Reel2MDSettings): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addToggle((toggle) => toggle
        .setValue(Boolean(this.plugin.settings[key]))
        .onChange(async (value) => {
          (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
          await this.plugin.saveSettings();
        }));
  }

  private numberSetting(name: string, desc: string, key: "delayMin" | "delayMax"): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => text
        .setValue(String(this.plugin.settings[key]))
        .onChange(async (value) => {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed >= 0) {
            this.plugin.settings[key] = parsed;
            await this.plugin.saveSettings();
          }
        }));
  }
}
