from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

from faster_whisper import WhisperModel

REEL_PATTERN = re.compile(
    r"https?://(?:www\.)?instagram\.com/reel/"
    r"(?P<code>[A-Za-z0-9_-]+)"
    r"/?(?:\?[^\s<>\"']*)?"
)

RATE_LIMIT_MARKERS = (
    "429",
    "too many requests",
    "please wait a few minutes",
    "rate limit",
)


@dataclass
class AccessResult:
    value: str
    access: str


@dataclass
class BatchConfig:
    input_file: Path
    output_dir: Path
    media_dir: Path | None
    ffmpeg: str
    model: str
    browser: str
    auth_fallback: bool
    include_caption: bool
    include_transcript: bool
    keep_video: bool
    keep_audio: bool
    include_creator: bool
    include_creator_id: bool
    include_published_at: bool
    include_captured_at: bool
    include_access: bool
    include_transcript_meta: bool
    delay_min: float
    delay_max: float


def yt_dlp_base() -> list[str]:
    return [sys.executable, "-m", "yt_dlp"]


def run(command: list[str], *, timeout: int = 300) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def yaml_string(value: str | None) -> str:
    return json.dumps(value or "", ensure_ascii=False)


def extract_urls(text: str) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    seen: set[str] = set()
    for match in REEL_PATTERN.finditer(text):
        code = match.group("code")
        if code in seen:
            continue
        seen.add(code)
        items.append((code, f"https://www.instagram.com/reel/{code}/"))
    return items


def fetch_json(url: str, browser: str, auth_fallback: bool) -> tuple[dict, str]:
    anonymous = run(
        yt_dlp_base()
        + ["--skip-download", "--no-playlist", "--no-warnings", "--dump-single-json", url]
    )
    if anonymous.returncode == 0 and anonymous.stdout.strip():
        try:
            return json.loads(anonymous.stdout), "anonymous"
        except json.JSONDecodeError:
            pass

    if not auth_fallback:
        raise RuntimeError(anonymous.stderr.strip() or "Anonymous metadata request failed")

    authenticated = run(
        yt_dlp_base()
        + [
            "--cookies-from-browser",
            browser,
            "--skip-download",
            "--no-playlist",
            "--no-warnings",
            "--dump-single-json",
            url,
        ]
    )
    if authenticated.returncode == 0 and authenticated.stdout.strip():
        try:
            return json.loads(authenticated.stdout), "authenticated-session"
        except json.JSONDecodeError:
            pass

    raise RuntimeError(
        "Metadata request failed.\n"
        f"Anonymous: {anonymous.stderr.strip()}\n"
        f"Authenticated: {authenticated.stderr.strip()}"
    )


def resolve_media_url(url: str, browser: str, auth_fallback: bool) -> AccessResult:
    anonymous = run(yt_dlp_base() + ["-f", "b", "-g", url])
    if anonymous.returncode == 0 and anonymous.stdout.strip():
        candidate = anonymous.stdout.strip().splitlines()[0].strip()
        if candidate.startswith("http"):
            return AccessResult(candidate, "anonymous")

    if not auth_fallback:
        raise RuntimeError(anonymous.stderr.strip() or "Anonymous media request failed")

    authenticated = run(
        yt_dlp_base()
        + ["--cookies-from-browser", browser, "-f", "b", "-g", url]
    )
    if authenticated.returncode == 0 and authenticated.stdout.strip():
        candidate = authenticated.stdout.strip().splitlines()[0].strip()
        if candidate.startswith("http"):
            return AccessResult(candidate, "authenticated-session")

    raise RuntimeError(
        "Media request failed.\n"
        f"Anonymous: {anonymous.stderr.strip()}\n"
        f"Authenticated: {authenticated.stderr.strip()}"
    )


def published_at_from_metadata(metadata: dict) -> str:
    timestamp = metadata.get("timestamp")
    if timestamp:
        try:
            return datetime.fromtimestamp(timestamp).astimezone().isoformat(timespec="seconds")
        except Exception:
            pass
    upload_date = str(metadata.get("upload_date") or "").strip()
    if len(upload_date) == 8 and upload_date.isdigit():
        return f"{upload_date[0:4]}-{upload_date[4:6]}-{upload_date[6:8]}"
    return ""


def detect_rate_limit(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in RATE_LIMIT_MARKERS)


def ffmpeg_extract_audio(ffmpeg: str, media_url: str, output: Path) -> None:
    result = run(
        [
            ffmpeg,
            "-y",
            "-loglevel",
            "error",
            "-i",
            media_url,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(output),
        ],
        timeout=900,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg audio extraction failed: {result.stderr.strip()}")


def ffmpeg_keep_video(ffmpeg: str, media_url: str, output: Path) -> None:
    result = run(
        [ffmpeg, "-y", "-loglevel", "error", "-i", media_url, "-c", "copy", str(output)],
        timeout=900,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg video copy failed: {result.stderr.strip()}")


def transcribe(audio_path: Path, model_name: str) -> tuple[str, str, float]:
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(audio_path), beam_size=5, vad_filter=True)
    parts = [segment.text.strip() for segment in segments if segment.text.strip()]
    transcript = "\n".join(parts).strip() or "[NO SPEECH DETECTED]"
    return transcript, str(info.language or ""), float(info.language_probability or 0)


def render_note(
    *,
    config: BatchConfig,
    metadata: dict,
    source_id: str,
    canonical_url: str,
    metadata_access: str,
    media_access: str,
    caption: str,
    transcript: str,
    transcript_language: str,
    transcript_probability: float,
) -> str:
    title = str(metadata.get("title") or "").strip()
    if not title:
        title = caption.splitlines()[0].strip() if caption else f"Instagram Reel {source_id}"

    creator = str(metadata.get("uploader") or metadata.get("channel") or metadata.get("creator") or "").strip()
    creator_id = str(metadata.get("uploader_id") or metadata.get("channel_id") or "").strip()
    published_at = published_at_from_metadata(metadata)
    captured_at = datetime.now().astimezone().isoformat(timespec="seconds")
    source_access = (
        "authenticated-session"
        if "authenticated-session" in {metadata_access, media_access}
        else "anonymous"
    )

    props: list[str] = [
        "---",
        "type: instagram-reel",
        "platform: instagram",
        f"source_url: {yaml_string(canonical_url)}",
        f"source_id: {yaml_string(source_id)}",
    ]
    if config.include_creator:
        props.append(f"creator: {yaml_string(creator)}")
    if config.include_creator_id:
        props.append(f"creator_id: {yaml_string(creator_id)}")
    if config.include_published_at:
        props.append(f"published_at: {yaml_string(published_at)}")
    if config.include_captured_at:
        props.append(f"captured_at: {yaml_string(captured_at)}")
    if config.include_access:
        props.extend(
            [
                f"source_access: {yaml_string(source_access)}",
                f"metadata_access: {yaml_string(metadata_access)}",
                f"media_access: {yaml_string(media_access)}",
            ]
        )
    props.append(f"caption_status: {'fetched' if config.include_caption else 'disabled'}")
    if config.include_caption:
        props.append("caption_method: yt-dlp")
    props.append(f"transcript_status: {'completed' if config.include_transcript else 'disabled'}")
    if config.include_transcript and config.include_transcript_meta:
        props.extend(
            [
                f"transcript_method: {yaml_string('faster-whisper-' + config.model)}",
                f"transcript_language: {yaml_string(transcript_language)}",
                f"transcript_language_probability: {transcript_probability:.3f}",
            ]
        )
    props.extend(["tags:", "  - source/instagram", "  - media/reel", "---", ""])

    sections = ["\n".join(props), f"# {title}", "", "## Source", "", canonical_url]
    if config.include_caption:
        sections.extend(["", "## Caption", "", caption or "[NO CAPTION]"])
    if config.include_transcript:
        sections.extend(["", "## Transcript", "", transcript])
    sections.extend(["", "## Notes", "", "", "## Derived Knowledge", ""])
    return "\n".join(sections).rstrip() + "\n"


def process_one(code: str, url: str, config: BatchConfig) -> str:
    destination = config.output_dir / f"{code}.md"
    if destination.exists():
        return "skipped"

    metadata, metadata_access = fetch_json(url, config.browser, config.auth_fallback)
    source_id = str(metadata.get("id") or code).strip() or code
    canonical_url = str(metadata.get("webpage_url") or metadata.get("original_url") or url)
    caption = str(metadata.get("description") or "").strip()

    needs_media = config.include_transcript or config.keep_audio or config.keep_video
    media_access = metadata_access
    media_url = ""
    if needs_media:
        media = resolve_media_url(url, config.browser, config.auth_fallback)
        media_url = media.value
        media_access = media.access

    config.output_dir.mkdir(parents=True, exist_ok=True)
    if config.media_dir:
        config.media_dir.mkdir(parents=True, exist_ok=True)

    transcript = ""
    language = ""
    probability = 0.0
    temp_audio: Path | None = None
    audio_path: Path | None = None

    try:
        if config.keep_video and config.media_dir:
            ffmpeg_keep_video(config.ffmpeg, media_url, config.media_dir / f"{source_id}.mp4")

        if config.include_transcript or config.keep_audio:
            if config.keep_audio and config.media_dir:
                audio_path = config.media_dir / f"{source_id}-speech.wav"
            else:
                handle = tempfile.NamedTemporaryFile(prefix=f"{source_id}-", suffix=".wav", delete=False)
                handle.close()
                temp_audio = Path(handle.name)
                audio_path = temp_audio
            ffmpeg_extract_audio(config.ffmpeg, media_url, audio_path)

        if config.include_transcript and audio_path:
            transcript, language, probability = transcribe(audio_path, config.model)

        note = render_note(
            config=config,
            metadata=metadata,
            source_id=source_id,
            canonical_url=canonical_url,
            metadata_access=metadata_access,
            media_access=media_access,
            caption=caption,
            transcript=transcript,
            transcript_language=language,
            transcript_probability=probability,
        )
        destination.write_text(note, encoding="utf-8")
        return "created"
    finally:
        if temp_audio and temp_audio.exists():
            temp_audio.unlink()


def process_batch(config: BatchConfig) -> int:
    if not config.input_file.is_file():
        raise SystemExit(f"Input file not found: {config.input_file}")
    if shutil.which(config.ffmpeg) is None and not Path(config.ffmpeg).is_file():
        raise SystemExit(f"ffmpeg not found: {config.ffmpeg}")

    items = extract_urls(config.input_file.read_text(encoding="utf-8"))
    if not items:
        raise SystemExit("No Instagram Reel URLs found in the input file.")

    print(f"Found: {len(items)} unique Instagram Reel URL(s)", flush=True)
    created = skipped = failed = 0

    for index, (code, url) in enumerate(items, start=1):
        print(f"[{index}/{len(items)}] {code}", flush=True)
        try:
            result = process_one(code, url, config)
            if result == "skipped":
                skipped += 1
                print("SKIP  Source note already exists", flush=True)
            else:
                created += 1
                print("OK", flush=True)
        except Exception as exc:
            failed += 1
            message = str(exc)
            print(f"FAIL  {message}", file=sys.stderr, flush=True)
            if detect_rate_limit(message):
                print("STOP  Rate limit detected; batch stopped.", file=sys.stderr, flush=True)
                break

        if index < len(items):
            delay = random.uniform(config.delay_min, config.delay_max)
            print(f"WAIT  {delay:.1f} seconds", flush=True)
            time.sleep(delay)

    print(f"SUMMARY created={created} skipped={skipped} failed={failed}", flush=True)
    return 0 if failed == 0 else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="reel2md")
    subparsers = parser.add_subparsers(dest="command", required=True)
    batch = subparsers.add_parser("batch", help="Process Reel URLs from a text or Markdown file")
    batch.add_argument("--input", required=True)
    batch.add_argument("--output", required=True)
    batch.add_argument("--media-dir")
    batch.add_argument("--ffmpeg", default="ffmpeg")
    batch.add_argument("--model", default="small.en")
    batch.add_argument("--browser", default="firefox")
    batch.add_argument("--auth-fallback", action=argparse.BooleanOptionalAction, default=False)
    batch.add_argument("--caption", action=argparse.BooleanOptionalAction, default=True)
    batch.add_argument("--transcript", action=argparse.BooleanOptionalAction, default=True)
    batch.add_argument("--keep-video", action=argparse.BooleanOptionalAction, default=False)
    batch.add_argument("--keep-audio", action=argparse.BooleanOptionalAction, default=False)
    batch.add_argument("--creator", action=argparse.BooleanOptionalAction, default=True)
    batch.add_argument("--creator-id", action=argparse.BooleanOptionalAction, default=True)
    batch.add_argument("--published-at", action=argparse.BooleanOptionalAction, default=True)
    batch.add_argument("--captured-at", action=argparse.BooleanOptionalAction, default=True)
    batch.add_argument("--access-meta", action=argparse.BooleanOptionalAction, default=True)
    batch.add_argument("--transcript-meta", action=argparse.BooleanOptionalAction, default=True)
    batch.add_argument("--delay-min", type=float, default=3.0)
    batch.add_argument("--delay-max", type=float, default=15.0)
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.command == "batch":
        delay_min = max(0.0, args.delay_min)
        delay_max = max(delay_min, args.delay_max)
        media_dir = Path(args.media_dir).expanduser().resolve() if args.media_dir else None
        config = BatchConfig(
            input_file=Path(args.input).expanduser().resolve(),
            output_dir=Path(args.output).expanduser().resolve(),
            media_dir=media_dir,
            ffmpeg=args.ffmpeg,
            model=args.model,
            browser=args.browser,
            auth_fallback=args.auth_fallback,
            include_caption=args.caption,
            include_transcript=args.transcript,
            keep_video=args.keep_video,
            keep_audio=args.keep_audio,
            include_creator=args.creator,
            include_creator_id=args.creator_id,
            include_published_at=args.published_at,
            include_captured_at=args.captured_at,
            include_access=args.access_meta,
            include_transcript_meta=args.transcript_meta,
            delay_min=delay_min,
            delay_max=delay_max,
        )
        return process_batch(config)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
