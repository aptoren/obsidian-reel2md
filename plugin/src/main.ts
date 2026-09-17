import { App, FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { spawn } from "child_process";
import * as os from "os";
import * as path from "path";

type ProxyMode = "inherit" | "none" | "manual";

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
  proxyMode: ProxyMode;
  proxyUrl: string;
  disableHfXet: boolean;
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
  delayMax: 15,
  proxyMode: "inherit",
  proxyUrl: "",
  disableHfXet: true
};

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function deleteProxyVariables(env: NodeJS.ProcessEnv): void {
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.ALL_PROXY;
  delete env.http_proxy;
  delete env.https_proxy;
  delete env.all_proxy;
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

    this.addCommand({
      id: "test-setup",
      name: "Test setup",
      callback: () => void this.testSetup()
    });

    this.addCommand({
      id: "test-network",
      name: "Test network",
      callback: () => void this.testNetwork()
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

  private buildChildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };

    if (this.settings.disableHfXet) {
      env.HF_HUB_DISABLE_XET = "1";
    } else {
      delete env.HF_HUB_DISABLE_XET;
    }

    if (this.settings.proxyMode === "none") {
      deleteProxyVariables(env);
      return env;
    }

    if (this.settings.proxyMode === "manual") {
      const proxyUrl = this.settings.proxyUrl.trim();
      if (!proxyUrl) {
        throw new Error("Manual proxy mode requires a Proxy URL.");
      }

      let parsed: URL;
      try {
        parsed = new URL(proxyUrl);
      } catch {
        throw new Error("Proxy URL is invalid.");
      }

      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Manual proxy mode currently supports only http:// and https:// proxy URLs.");
      }

      env.HTTP_PROXY = proxyUrl;
      env.HTTPS_PROXY = proxyUrl;
      env.http_proxy = proxyUrl;
      env.https_proxy = proxyUrl;
      delete env.ALL_PROXY;
      delete env.all_proxy;
    }

    return env;
  }

  private validateSettings(): { input: string; output: string; childEnv: NodeJS.ProcessEnv } {
    const input = this.absoluteVaultPath(this.settings.queuePath);
    const output = this.absoluteVaultPath(this.settings.outputFolder);
    const childEnv = this.buildChildEnv();

    if ((this.settings.keepVideo || this.settings.keepAudio) && !this.settings.mediaFolder.trim()) {
      throw new Error("Set a Media folder when Keep video or Keep audio is enabled.");
    }

    if (this.settings.delayMin < 0 || this.settings.delayMax < 0) {
      throw new Error("Request spacing values cannot be negative.");
    }

    if (this.settings.delayMax < this.settings.delayMin) {
      throw new Error("Maximum delay must be greater than or equal to minimum delay.");
    }

    return { input, output, childEnv };
  }

  private runCheck(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.length > 8000) stdout = stdout.slice(-8000);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 8000) stderr = stderr.slice(-8000);
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
          return;
        }

        const detail = (stderr.trim() || stdout.trim() || `exit code ${code}`)
          .split("\n")
          .slice(-4)
          .join(" ");

        reject(new Error(detail));
      });
    });
  }

  async testSetup(): Promise<void> {
    let input: string;
    let childEnv: NodeJS.ProcessEnv;

    try {
      ({ input, childEnv } = this.validateSettings());
    } catch (error) {
      new Notice(`Reel2MD setup check failed: ${String(error)}`, 10000);
      return;
    }

    const queueFile = this.app.vault.getAbstractFileByPath(this.settings.queuePath);
    if (!queueFile) {
      new Notice(`Reel2MD setup check failed: queue note not found: ${this.settings.queuePath}`, 10000);
      return;
    }

    const executable = expandHome(this.settings.executable);
    const ffmpeg = expandHome(this.settings.ffmpeg);
    const cwd = path.dirname(input);

    new Notice("Reel2MD setup check started.");

    try {
      await this.runCheck(executable, ["--help"], cwd, childEnv);
    } catch (error) {
      new Notice(`Reel2MD setup check failed: CLI: ${String(error)}`, 12000);
      return;
    }

    try {
      await this.runCheck(ffmpeg, ["-version"], cwd, childEnv);
    } catch (error) {
      new Notice(`Reel2MD setup check failed: ffmpeg: ${String(error)}`, 12000);
      return;
    }

    new Notice("Reel2MD setup OK: queue note, CLI, ffmpeg, and local settings validated.", 10000);
  }

  async testNetwork(): Promise<void> {
    let input: string;
    let childEnv: NodeJS.ProcessEnv;

    try {
      ({ input, childEnv } = this.validateSettings());
    } catch (error) {
      new Notice(`Reel2MD network check failed: ${String(error)}`, 10000);
      return;
    }

    const executable = expandHome(this.settings.executable);
    const cwd = path.dirname(input);

    const args = [
      "doctor",
      "--input", input,
      "--model", this.settings.model,
      "--browser", this.settings.browser,
      this.boolArg("auth-fallback", this.settings.authFallback)
    ];

    new Notice("Reel2MD network check started.");

    try {
      const output = await this.runCheck(executable, args, cwd, childEnv);
      const summary = output
        .split("\n")
        .reverse()
        .find((line) => line.startsWith("NETWORK_OK"));

      new Notice(
        summary
          ? `Reel2MD network OK: ${summary.replace(/^NETWORK_OK\s*/, "")}`
          : "Reel2MD network OK.",
        12000
      );
    } catch (error) {
      new Notice(`Reel2MD network check failed: ${String(error)}`, 15000);
    }
  }

  private async processQueue(): Promise<void> {
    if (this.running) {
      new Notice("Reel2MD is already running.");
      return;
    }

    let input: string;
    let output: string;
    let childEnv: NodeJS.ProcessEnv;

    try {
      ({ input, output, childEnv } = this.validateSettings());
    } catch (error) {
      new Notice(`Reel2MD configuration error: ${String(error)}`, 10000);
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
      env: childEnv,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let spawnFailed = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 12000) stdout = stdout.slice(-12000);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    child.on("error", (error) => {
      spawnFailed = true;
      this.running = false;
      new Notice(`Reel2MD could not start: ${error.message}`, 10000);
    });

    child.on("close", (code) => {
      if (spawnFailed) return;

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

    this.textSetting("Queue note", "Vault-relative file containing Instagram video URLs.", "queuePath");
    this.textSetting("Output folder", "Vault-relative folder for generated Markdown notes.", "outputFolder");
    this.textSetting("Media folder", "Optional absolute folder for retained video/audio. Leave blank if media is temporary.", "mediaFolder");
    this.textSetting("Reel2MD executable", "Executable path or command name.", "executable");
    this.textSetting("ffmpeg", "ffmpeg executable path or command name.", "ffmpeg");
    this.textSetting("Whisper model", "Example: small.en", "model");
    this.textSetting("Browser", "Browser used only for authenticated fallback, e.g. firefox.", "browser");

    new Setting(containerEl)
      .setName("Test setup")
      .setDesc("Validate the queue note, Reel2MD CLI, ffmpeg, proxy configuration, and local settings without processing any Instagram source.")
      .addButton((button) => button
        .setButtonText("Test setup")
        .setCta()
        .onClick(() => void this.plugin.testSetup()));

    new Setting(containerEl)
      .setName("Test network")
      .setDesc("Use the first Instagram URL in the queue to test Instagram metadata/media access and Hugging Face access without creating a note or saving media.")
      .addButton((button) => button
        .setButtonText("Test network")
        .onClick(() => void this.plugin.testNetwork()));

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

    containerEl.createEl("h3", { text: "Network" });

    new Setting(containerEl)
      .setName("Proxy mode")
      .setDesc("Inherit the system proxy, disable proxy use for Reel2MD, or provide a manual HTTP/HTTPS proxy.")
      .addDropdown((dropdown) => dropdown
        .addOption("inherit", "Inherit system proxy")
        .addOption("none", "No proxy")
        .addOption("manual", "Manual HTTP/HTTPS proxy")
        .setValue(this.plugin.settings.proxyMode)
        .onChange(async (value) => {
          this.plugin.settings.proxyMode = value as ProxyMode;
          await this.plugin.saveSettings();
        }));

    this.textSetting(
      "Proxy URL",
      "Used only in Manual mode. Example: http://192.168.159.1:10808. Avoid embedding credentials unless you accept that the value is stored in plugin settings.",
      "proxyUrl"
    );

    this.toggleSetting(
      "Disable Hugging Face Xet",
      "Set HF_HUB_DISABLE_XET=1 for Reel2MD child processes. Useful on networks or proxies where Hugging Face Xet/CAS downloads fail.",
      "disableHfXet"
    );

    containerEl.createEl("h3", { text: "Request spacing" });
    this.numberSetting("Minimum delay (seconds)", "Minimum pause between Instagram jobs.", "delayMin");
    this.numberSetting("Maximum delay (seconds)", "Maximum pause between Instagram jobs.", "delayMax");
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
