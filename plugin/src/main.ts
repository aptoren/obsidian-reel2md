import { App, FileSystemAdapter, Modal, Notice, Plugin, PluginSettingTab, normalizePath } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

type ProxyMode = "inherit" | "none" | "manual";
type TranscriptionModel = "small.en" | "small";
type DependencyState = "ok" | "missing" | "outdated" | "unknown";

interface Reel2MDSettings {
  queuePath: string;
  outputFolder: string;
  mediaFolder: string;
  executable: string;
  ffmpeg: string;
  model: TranscriptionModel;
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
  delayMax: number;
  proxyMode: ProxyMode;
  proxyUrl: string;
  disableHfXet: boolean;
  showJobOutput: boolean;
}

interface DependencyItem {
  state: DependencyState;
  detail: string;
  hint?: string;
}

interface LocalDependencyReport {
  executablePath: string | null;
  ffmpegPath: string | null;
  reel2md: DependencyItem;
  ffmpeg: DependencyItem;
  ytDlp: DependencyItem;
  fasterWhisper: DependencyItem;
  huggingfaceHub: DependencyItem;
}

interface DependencyPayloadItem {
  status?: string;
  version?: string | null;
}

interface DependencyPayload {
  reel2md?: DependencyPayloadItem;
  "yt-dlp"?: DependencyPayloadItem;
  "faster-whisper"?: DependencyPayloadItem;
  "huggingface-hub"?: DependencyPayloadItem;
}

const SYSTEM_MIN_DELAY_SECONDS = 2;
const DEFAULT_MAX_DELAY_SECONDS = 15;
const MAX_DELAY_SECONDS = 60;

const DEFAULT_SETTINGS: Reel2MDSettings = {
  queuePath: "Sources/Media/Instagram Queue.md",
  outputFolder: "Sources/Media/Instagram",
  mediaFolder: "",
  executable: "reel2md",
  ffmpeg: "ffmpeg",
  model: "small",
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
  delayMax: DEFAULT_MAX_DELAY_SECONDS,
  proxyMode: "inherit",
  proxyUrl: "",
  disableHfXet: true,
  showJobOutput: false
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

function clampMaximumDelay(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_DELAY_SECONDS;
  return Math.min(MAX_DELAY_SECONDS, Math.max(SYSTEM_MIN_DELAY_SECONDS, Math.round(parsed)));
}

function normalizeTranscriptionModel(value: unknown): TranscriptionModel {
  return value === "small.en" ? "small.en" : "small";
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function resolveExecutablePath(command: string): string | null {
  const expanded = expandHome(command.trim());
  if (!expanded) return null;

  const containsSeparator = expanded.includes("/") || expanded.includes("\\");
  if (path.isAbsolute(expanded) || containsSeparator) {
    return fs.existsSync(expanded) ? path.resolve(expanded) : null;
  }

  const pathValue = process.env.PATH ?? "";
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];

  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, process.platform === "win32" ? `${expanded}${extension}` : expanded);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Continue searching PATH.
      }
    }
  }

  return null;
}

function ffmpegInstallHint(): string {
  if (process.platform === "win32") {
    return "Install ffmpeg, for example with: winget install Gyan.FFmpeg";
  }
  if (process.platform === "darwin") {
    return "Install ffmpeg, for example with: brew install ffmpeg";
  }
  return "Install ffmpeg with your package manager, for example on Ubuntu/Debian: sudo apt install ffmpeg";
}

function pythonDependencyItem(payload: DependencyPayloadItem | undefined, packageName: string): DependencyItem {
  if (!payload) {
    return {
      state: "unknown",
      detail: "Could not read dependency status.",
      hint: `Reinstall or repair the Reel2MD CLI environment to restore ${packageName}.`
    };
  }

  if (payload.status === "ok") {
    return {
      state: "ok",
      detail: payload.version ? `Version ${payload.version}` : "Installed"
    };
  }

  return {
    state: "missing",
    detail: "Not installed in the Reel2MD CLI environment.",
    hint: `Reinstall or repair the Reel2MD CLI environment to install ${packageName}.`
  };
}

class JobOutputModal extends Modal {
  private outputEl: HTMLElement | null = null;
  private buffer = "";

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Reel2MD job output" });
    contentEl.createEl("p", {
      text: "Live output from the local Reel2MD process. You can close this window without stopping the job."
    });
    this.outputEl = contentEl.createEl("pre", { cls: "reel2md-job-output" });
    this.renderBuffer();
  }

  onClose(): void {
    this.outputEl = null;
  }

  append(text: string): void {
    this.buffer += text;
    if (this.buffer.length > 100000) {
      this.buffer = this.buffer.slice(-100000);
    }
    this.renderBuffer();
  }

  private renderBuffer(): void {
    if (!this.outputEl) return;
    this.outputEl.textContent = this.buffer;
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }
}

export default class Reel2MDPlugin extends Plugin {
  settings: Reel2MDSettings = DEFAULT_SETTINGS;
  private running = false;
  private unloading = false;
  private childProcesses = new Set<ChildProcessWithoutNullStreams>();

  async onload(): Promise<void> {
    const loaded = await this.loadData() as Partial<Reel2MDSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
    this.settings.model = normalizeTranscriptionModel(this.settings.model);
    this.settings.delayMax = clampMaximumDelay(this.settings.delayMax);

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

  onunload(): void {
    this.unloading = true;
    for (const child of this.childProcesses) {
      if (!child.killed) {
        child.kill();
      }
    }
    this.childProcesses.clear();
    this.running = false;
  }

  private trackChild(child: ChildProcessWithoutNullStreams): void {
    this.childProcesses.add(child);
    const cleanup = () => this.childProcesses.delete(child);
    child.once("close", cleanup);
    child.once("error", cleanup);
  }

  async saveSettings(): Promise<void> {
    this.settings.delayMax = clampMaximumDelay(this.settings.delayMax);
    await this.saveData(this.settings);
  }

  private vaultRoot(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Reel2MD requires a desktop filesystem vault.");
    }
    return adapter.getBasePath();
  }

  private absoluteVaultPath(relativePath: string): string {
    return path.resolve(this.vaultRoot(), relativePath);
  }

  private queuePathCandidates(): string[] {
    const input = this.settings.queuePath.trim();
    if (!input) return [];

    const raw = normalizePath(input).replace(/^\/+/, "");
    if (!raw) return [];

    const candidates = [raw];
    if (!raw.toLowerCase().endsWith(".md")) {
      candidates.push(`${raw}.md`);
    }
    return candidates;
  }

  private resolveQueuePath(): string {
    const candidates = this.queuePathCandidates();
    if (candidates.length === 0) {
      throw new Error("Set a Queue note.");
    }

    for (const candidate of candidates) {
      if (this.app.vault.getAbstractFileByPath(candidate)) {
        return candidate;
      }
    }

    return candidates[candidates.length - 1];
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

  private validateSettings(): {
    queueRelativePath: string;
    input: string;
    output: string;
    childEnv: NodeJS.ProcessEnv;
  } {
    const queueRelativePath = this.resolveQueuePath();
    const input = this.absoluteVaultPath(queueRelativePath);
    const outputFolderInput = this.settings.outputFolder.trim();
    const outputFolder = outputFolderInput
      ? normalizePath(outputFolderInput).replace(/^\/+/, "")
      : "";

    if (!outputFolder) {
      throw new Error("Set an Output folder.");
    }

    const output = this.absoluteVaultPath(outputFolder);
    const childEnv = this.buildChildEnv();

    if ((this.settings.keepVideo || this.settings.keepAudio) && !this.settings.mediaFolder.trim()) {
      throw new Error("Set a Media folder when Keep video or Keep audio is enabled.");
    }

    if (
      this.settings.delayMax < SYSTEM_MIN_DELAY_SECONDS ||
      this.settings.delayMax > MAX_DELAY_SECONDS
    ) {
      throw new Error(`Maximum spacing must be between ${SYSTEM_MIN_DELAY_SECONDS} and ${MAX_DELAY_SECONDS} seconds.`);
    }

    return { queueRelativePath, input, output, childEnv };
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
      this.trackChild(child);

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
        reject(toError(error));
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

  private parseDependencyPayload(output: string): DependencyPayload {
    const jsonLine = output
      .split("\n")
      .reverse()
      .find((line) => line.trim().startsWith("{"));

    if (!jsonLine) {
      throw new Error("Reel2MD dependency report was not valid JSON.");
    }

    return JSON.parse(jsonLine) as DependencyPayload;
  }

  async inspectLocalDependencies(): Promise<LocalDependencyReport> {
    const cwd = this.vaultRoot();
    const env: NodeJS.ProcessEnv = { ...process.env };
    const executable = expandHome(this.settings.executable);
    const ffmpeg = expandHome(this.settings.ffmpeg);
    const executablePath = resolveExecutablePath(executable);
    const ffmpegPath = resolveExecutablePath(ffmpeg);

    let reel2md: DependencyItem;
    let ytDlp: DependencyItem;
    let fasterWhisper: DependencyItem;
    let huggingfaceHub: DependencyItem;

    try {
      const output = await this.runCheck(executable, ["deps"], cwd, env);
      const payload = this.parseDependencyPayload(output);
      reel2md = pythonDependencyItem(payload.reel2md, "Reel2MD");
      ytDlp = pythonDependencyItem(payload["yt-dlp"], "yt-dlp");
      fasterWhisper = pythonDependencyItem(payload["faster-whisper"], "faster-whisper");
      huggingfaceHub = pythonDependencyItem(payload["huggingface-hub"], "huggingface-hub");
    } catch (error) {
      const detail = String(error);
      const depsUnsupported = executablePath !== null
        && /invalid choice.*deps|deps.*invalid choice/i.test(detail);

      if (depsUnsupported) {
        reel2md = {
          state: "outdated",
          detail: "Installed CLI does not support dependency reporting.",
          hint: "Update Reel2MD to version 0.1.1 or later, then reopen settings."
        };
      } else {
        reel2md = {
          state: "missing",
          detail: executablePath
            ? "The configured Reel2MD executable could not complete the local dependency check."
            : "The configured Reel2MD executable was not found.",
          hint: "Install or repair the Reel2MD CLI in a Python virtual environment, then set the Reel2MD executable field to that environment's reel2md command. See docs/INSTALL.md."
        };
      }

      const unavailable: DependencyItem = {
        state: "unknown",
        detail: depsUnsupported
          ? "Dependency reporting requires Reel2MD 0.1.1 or later."
          : "Unavailable until the Reel2MD CLI can run its local dependency check.",
        hint: "These Python dependencies are installed with the Reel2MD CLI."
      };
      ytDlp = { ...unavailable };
      fasterWhisper = { ...unavailable };
      huggingfaceHub = { ...unavailable };
    }

    let ffmpegItem: DependencyItem;
    try {
      const output = await this.runCheck(ffmpeg, ["-version"], cwd, env);
      const firstLine = output.split("\n")[0]?.trim() || "ffmpeg detected";
      ffmpegItem = {
        state: "ok",
        detail: firstLine
      };
    } catch (error) {
      ffmpegItem = {
        state: "missing",
        detail: `ffmpeg check failed: ${String(error)}`,
        hint: ffmpegInstallHint()
      };
    }

    return {
      executablePath,
      ffmpegPath,
      reel2md,
      ffmpeg: ffmpegItem,
      ytDlp,
      fasterWhisper,
      huggingfaceHub
    };
  }

  async testSetup(): Promise<void> {
    let queueRelativePath: string;
    let input: string;
    let childEnv: NodeJS.ProcessEnv;

    try {
      ({ queueRelativePath, input, childEnv } = this.validateSettings());
    } catch (error) {
      new Notice(`Reel2MD setup check failed: ${String(error)}`, 10000);
      return;
    }

    const queueFile = this.app.vault.getAbstractFileByPath(queueRelativePath);
    if (!queueFile) {
      new Notice(`Reel2MD setup check failed: queue note not found: ${queueRelativePath}`, 10000);
      return;
    }

    const executable = expandHome(this.settings.executable);
    const ffmpeg = expandHome(this.settings.ffmpeg);
    const cwd = path.dirname(input);

    new Notice("Reel2MD setup check started.");

    try {
      const output = await this.runCheck(executable, ["deps"], cwd, childEnv);
      const payload = this.parseDependencyPayload(output);
      const missing = ["reel2md", "yt-dlp", "faster-whisper", "huggingface-hub"]
        .filter((name) => payload[name as keyof DependencyPayload]?.status !== "ok");

      if (missing.length > 0) {
        throw new Error(`Missing Python dependencies: ${missing.join(", ")}`);
      }
    } catch (error) {
      new Notice(`Reel2MD setup check failed: CLI/dependencies: ${String(error)}`, 12000);
      return;
    }

    try {
      await this.runCheck(ffmpeg, ["-version"], cwd, childEnv);
    } catch (error) {
      new Notice(`Reel2MD setup check failed: ffmpeg: ${String(error)}`, 12000);
      return;
    }

    new Notice("Reel2MD setup OK: queue note, CLI dependencies, ffmpeg, and local settings validated.", 10000);
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
      "--delay-max", String(this.settings.delayMax)
    ];

    if (this.settings.mediaFolder.trim()) {
      args.push("--media-dir", expandHome(this.settings.mediaFolder.trim()));
    }

    this.running = true;
    new Notice("Reel2MD started. Processing the queue in the background.");

    const outputModal = this.settings.showJobOutput
      ? new JobOutputModal(this.app)
      : null;

    if (outputModal) {
      outputModal.open();
      outputModal.append("Reel2MD job started.\n\n");
    }

    const child = spawn(executable, args, {
      cwd: path.dirname(input),
      env: childEnv,
      windowsHide: true
    });
    this.trackChild(child);

    let stdout = "";
    let stderr = "";
    let spawnFailed = false;

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (stdout.length > 12000) stdout = stdout.slice(-12000);
      outputModal?.append(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
      outputModal?.append(text);
    });

    child.on("error", (error) => {
      spawnFailed = true;
      this.running = false;
      if (this.unloading) return;
      outputModal?.append(`\nCould not start Reel2MD: ${error.message}\n`);
      new Notice(`Reel2MD could not start: ${error.message}`, 10000);
    });

    child.on("close", (code) => {
      if (spawnFailed) return;

      this.running = false;
      if (this.unloading) return;
      outputModal?.append(`\nProcess finished with exit code ${code ?? "unknown"}.\n`);

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

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const nextValue = key === "model" ? normalizeTranscriptionModel(value) : value;
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = nextValue;
    await this.plugin.saveSettings();

    if (
      key === "includeTranscript" ||
      key === "keepVideo" ||
      key === "keepAudio" ||
      key === "authFallback" ||
      key === "proxyMode"
    ) {
      this.update();
    }
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const spacingOptions: Record<string, string> = {};
    for (let value = SYSTEM_MIN_DELAY_SECONDS; value <= MAX_DELAY_SECONDS; value += 1) {
      spacingOptions[String(value)] = `${value} seconds`;
    }

    return [
      {
        name: "Reel2MD overview",
        searchable: false,
        render: (setting) => {
          setting.settingEl.empty();
          setting.settingEl.createEl("p", {
            text: "Reel2MD converts supported Instagram video posts into structured Markdown using a local CLI. Transcription runs locally, and Reel2MD does not copy Instagram cookies or credentials into your vault."
          });
          const identityEl = setting.settingEl.createEl("p");
          identityEl.createEl("a", {
            text: "A RichDir project",
            href: "https://richdir.com"
          });
        }
      },
      {
        type: "group",
        heading: "Source & output",
        items: [
          {
            name: "Queue note",
            desc: "Vault-relative path to the note containing Instagram video URLs. The .md extension is optional. Example: Sources/Media/Instagram-Queue.md",
            control: { type: "text", key: "queuePath" }
          },
          {
            name: "Output folder",
            desc: "Vault-relative folder where generated Markdown notes are written.",
            control: { type: "text", key: "outputFolder" }
          }
        ]
      },
      {
        type: "group",
        heading: "Processing",
        items: [
          {
            name: "Include caption",
            desc: "Write the Instagram caption into the Markdown note.",
            control: { type: "toggle", key: "includeCaption" }
          },
          {
            name: "Include transcript",
            desc: "Create a local faster-whisper transcript.",
            control: { type: "toggle", key: "includeTranscript" }
          },
          {
            name: "Transcription model",
            desc: "Choose English only for English speech, or Multilingual when Reels may contain other spoken languages. Multilingual lets Whisper detect the spoken language automatically. The selected model downloads on first transcription if it is not already cached.",
            visible: () => this.plugin.settings.includeTranscript,
            control: {
              type: "dropdown",
              key: "model",
              options: {
                "small.en": "English only (small.en)",
                small: "Multilingual / auto-detect (small)"
              }
            }
          },
          {
            name: "Show live job output",
            desc: "Open an Obsidian window showing live Reel2MD stdout/stderr while a queue job runs. Closing the window does not stop the job.",
            control: { type: "toggle", key: "showJobOutput" }
          }
        ]
      },
      {
        type: "group",
        heading: "Metadata",
        items: [
          {
            name: "Creator",
            desc: "Include creator name.",
            control: { type: "toggle", key: "includeCreator" }
          },
          {
            name: "Creator ID",
            desc: "Include creator/channel ID when available.",
            control: { type: "toggle", key: "includeCreatorId" }
          },
          {
            name: "Published time",
            desc: "Include source publication date/time when available.",
            control: { type: "toggle", key: "includePublishedAt" }
          },
          {
            name: "Captured time",
            desc: "Include ingestion timestamp.",
            control: { type: "toggle", key: "includeCapturedAt" }
          },
          {
            name: "Access provenance",
            desc: "Include anonymous/authenticated access fields.",
            control: { type: "toggle", key: "includeAccessMeta" }
          },
          {
            name: "Transcript metadata",
            desc: "Include model, detected language, and confidence.",
            control: { type: "toggle", key: "includeTranscriptMeta" }
          }
        ]
      },
      {
        type: "group",
        heading: "Media retention",
        items: [
          {
            name: "Keep video",
            desc: "Keep an MP4 copy instead of treating video as temporary processing media.",
            control: { type: "toggle", key: "keepVideo" }
          },
          {
            name: "Keep audio",
            desc: "Keep the 16 kHz mono WAV used for transcription.",
            control: { type: "toggle", key: "keepAudio" }
          },
          {
            name: "Media folder",
            desc: "Required while media retention is enabled. Use an absolute folder path for retained video/audio.",
            visible: () => this.plugin.settings.keepVideo || this.plugin.settings.keepAudio,
            control: { type: "text", key: "mediaFolder" }
          }
        ]
      },
      {
        type: "group",
        heading: "Local tools",
        items: [
          {
            name: "Reel2MD executable",
            desc: "Executable path or command name. Default: reel2md.",
            control: { type: "text", key: "executable" }
          },
          {
            name: "ffmpeg",
            desc: "ffmpeg executable path or command name. Default: ffmpeg.",
            control: { type: "text", key: "ffmpeg" }
          },
          {
            name: "Detected local dependencies",
            searchable: false,
            render: (setting) => {
              setting.settingEl.empty();
              const statusEl = setting.settingEl.createDiv({
                cls: "reel2md-dependency-status"
              });
              statusEl.setText("Checking local dependencies…");
              void this.refreshDependencyStatus(statusEl);
            }
          },
          {
            name: "Test setup",
            desc: "Validate the queue note, Reel2MD CLI and Python dependencies, ffmpeg, proxy configuration, retention settings, and request spacing without processing Instagram media.",
            render: (setting) => {
              setting.addButton((button) => button
                .setButtonText("Test setup")
                .onClick(() => void this.plugin.testSetup()));
            }
          }
        ]
      },
      {
        type: "group",
        heading: "Network & access",
        items: [
          {
            name: "Authenticated browser fallback",
            desc: "Retry with the selected browser session only if anonymous Instagram access fails.",
            control: { type: "toggle", key: "authFallback" }
          },
          {
            name: "Browser",
            desc: "Browser whose existing logged-in session may be used for fallback. Example: firefox.",
            visible: () => this.plugin.settings.authFallback,
            control: { type: "text", key: "browser" }
          },
          {
            name: "Proxy mode",
            desc: "Inherit the system proxy, disable proxy use for Reel2MD, or provide a manual HTTP/HTTPS proxy.",
            control: {
              type: "dropdown",
              key: "proxyMode",
              options: {
                inherit: "Inherit system proxy",
                none: "No proxy",
                manual: "Manual HTTP/HTTPS proxy"
              }
            }
          },
          {
            name: "Proxy URL",
            desc: "Used only in Manual mode. Example: http://192.168.159.1:10808. Avoid embedding credentials unless you accept that the value is stored in plugin settings.",
            visible: () => this.plugin.settings.proxyMode === "manual",
            control: { type: "text", key: "proxyUrl" }
          },
          {
            name: "Disable Hugging Face Xet",
            desc: "Set HF_HUB_DISABLE_XET=1 for Reel2MD child processes. Useful on networks or proxies where Hugging Face Xet/CAS downloads fail.",
            control: { type: "toggle", key: "disableHfXet" }
          },
          {
            name: "Test network",
            desc: "Use the first supported Instagram URL in the queue to test Instagram metadata/media access and Hugging Face model access without creating a note or saving media.",
            render: (setting) => {
              setting.addButton((button) => button
                .setButtonText("Test network")
                .onClick(() => void this.plugin.testNetwork()));
            }
          }
        ]
      },
      {
        type: "group",
        heading: "Request spacing",
        items: [
          {
            name: "Maximum spacing",
            desc: `Reel2MD waits a random number of seconds between jobs. The minimum is always ${SYSTEM_MIN_DELAY_SECONDS} seconds; the maximum is the value you choose here.`,
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                for (const [value, label] of Object.entries(spacingOptions)) {
                  dropdown.addOption(value, label);
                }
                dropdown
                  .setValue(String(clampMaximumDelay(this.plugin.settings.delayMax)))
                  .onChange(async (value) => {
                    this.plugin.settings.delayMax = clampMaximumDelay(value);
                    await this.plugin.saveSettings();
                  });
              });
            }
          }
        ]
      }
    ];
  }

  private async refreshDependencyStatus(statusEl: HTMLElement): Promise<void> {
    const report = await this.plugin.inspectLocalDependencies();
    if (!statusEl.isConnected) return;

    statusEl.empty();
    statusEl.createDiv({
      cls: "reel2md-dependency-heading",
      text: "Detected local dependencies"
    });

    const list = statusEl.createEl("ul");
    this.renderDependencyItem(
      list,
      "Reel2MD CLI",
      report.reel2md,
      report.executablePath ? `Detected executable: ${report.executablePath}` : undefined
    );
    this.renderDependencyItem(
      list,
      "ffmpeg",
      report.ffmpeg,
      report.ffmpegPath ? `Detected executable: ${report.ffmpegPath}` : undefined
    );
    this.renderDependencyItem(list, "yt-dlp", report.ytDlp);
    this.renderDependencyItem(list, "faster-whisper", report.fasterWhisper);
    this.renderDependencyItem(list, "huggingface-hub", report.huggingfaceHub);
  }

  private renderDependencyItem(
    list: HTMLElement,
    name: string,
    item: DependencyItem,
    detectedPath?: string
  ): void {
    const row = list.createEl("li", { cls: "reel2md-dependency-item" });
    const state = row.createSpan({
      cls: `reel2md-dependency-${item.state}`,
      text: item.state === "ok"
        ? "OK"
        : item.state === "missing"
          ? "Missing"
          : item.state === "outdated"
            ? "Outdated"
            : "Unknown"
    });
    state.setAttr("aria-label", `${name} status: ${state.textContent ?? item.state}`);

    row.createSpan({ text: ` — ${name}: ${item.detail}` });

    if (detectedPath) {
      row.createDiv({ cls: "reel2md-dependency-detail", text: detectedPath });
    }

    if (item.hint) {
      row.createDiv({ cls: "reel2md-dependency-hint", text: item.hint });
    }
  }
}
