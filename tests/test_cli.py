from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from reel2md.cli import BatchConfig, extract_urls, fetch_json, render_note


def make_config() -> BatchConfig:
    return BatchConfig(
        input_file=Path("/tmp/input.md"),
        output_dir=Path("/tmp/output"),
        media_dir=None,
        ffmpeg="ffmpeg",
        model="small.en",
        browser="firefox",
        auth_fallback=False,
        include_caption=True,
        include_transcript=True,
        keep_video=False,
        keep_audio=False,
        include_creator=True,
        include_creator_id=True,
        include_published_at=True,
        include_captured_at=True,
        include_access=True,
        include_transcript_meta=True,
        delay_min=3.0,
        delay_max=15.0,
    )


class ExtractUrlsTests(unittest.TestCase):
    def test_reel_url(self) -> None:
        self.assertEqual(
            extract_urls("https://www.instagram.com/reel/ABC123xyz/"),
            [("ABC123xyz", "https://www.instagram.com/reel/ABC123xyz/")],
        )

    def test_reels_url_is_canonicalized_to_reel(self) -> None:
        self.assertEqual(
            extract_urls("https://www.instagram.com/reels/ABC123xyz/"),
            [("ABC123xyz", "https://www.instagram.com/reel/ABC123xyz/")],
        )

    def test_post_url(self) -> None:
        self.assertEqual(
            extract_urls("https://www.instagram.com/p/POST123abc/"),
            [("POST123abc", "https://www.instagram.com/p/POST123abc/")],
        )

    def test_tv_url(self) -> None:
        self.assertEqual(
            extract_urls("https://www.instagram.com/tv/TV123abc/"),
            [("TV123abc", "https://www.instagram.com/tv/TV123abc/")],
        )

    def test_tracking_query_is_removed(self) -> None:
        self.assertEqual(
            extract_urls(
                "https://www.instagram.com/reel/ABC123xyz/?igsh=abc123&utm_source=test"
            ),
            [("ABC123xyz", "https://www.instagram.com/reel/ABC123xyz/")],
        )

    def test_duplicate_shortcode_is_processed_once(self) -> None:
        text = """
        https://www.instagram.com/reel/SAME123/
        https://www.instagram.com/reels/SAME123/?igsh=test
        https://www.instagram.com/reel/OTHER456/
        """
        self.assertEqual(
            extract_urls(text),
            [
                ("SAME123", "https://www.instagram.com/reel/SAME123/"),
                ("OTHER456", "https://www.instagram.com/reel/OTHER456/"),
            ],
        )

    def test_unrelated_instagram_urls_are_ignored(self) -> None:
        self.assertEqual(
            extract_urls(
                "https://www.instagram.com/example_user/ "
                "https://www.instagram.com/stories/example/123/"
            ),
            [],
        )


class NonVideoPostTests(unittest.TestCase):
    @patch("reel2md.cli.run")
    def test_non_video_post_error_from_ytdlp_is_user_facing(self, mocked_run) -> None:
        mocked_run.return_value = subprocess.CompletedProcess(
            args=["yt-dlp"],
            returncode=1,
            stdout="",
            stderr="ERROR: [Instagram] There is no video in this post",
        )

        with self.assertRaisesRegex(
            RuntimeError,
            r"Unsupported Instagram post: this /p/ URL does not contain a video",
        ):
            fetch_json(
                "https://www.instagram.com/p/PHOTO123/",
                "firefox",
                False,
            )

    @patch("reel2md.cli.run")
    def test_image_metadata_from_post_is_rejected_cleanly(self, mocked_run) -> None:
        mocked_run.return_value = subprocess.CompletedProcess(
            args=["yt-dlp"],
            returncode=0,
            stdout=json.dumps(
                {
                    "id": "PHOTO123",
                    "ext": "jpg",
                    "title": "A photo post",
                }
            ),
            stderr="",
        )

        with self.assertRaisesRegex(
            RuntimeError,
            r"Unsupported Instagram post: this /p/ URL does not contain a video",
        ):
            fetch_json(
                "https://www.instagram.com/p/PHOTO123/",
                "firefox",
                False,
            )


class RenderNoteTests(unittest.TestCase):
    def test_title_is_written_as_obsidian_alias(self) -> None:
        note = render_note(
            config=make_config(),
            metadata={
                "title": "A Useful Reel Title",
                "uploader": "example_creator",
                "uploader_id": "creator123",
            },
            source_id="ABC123xyz",
            canonical_url="https://www.instagram.com/reel/ABC123xyz/",
            metadata_access="anonymous",
            media_access="anonymous",
            caption="A caption",
            transcript="A transcript",
            transcript_language="en",
            transcript_probability=0.99,
        )

        self.assertIn('aliases:\n  - "A Useful Reel Title"', note)
        self.assertIn("# A Useful Reel Title", note)

    def test_caption_first_line_becomes_alias_when_title_missing(self) -> None:
        note = render_note(
            config=make_config(),
            metadata={},
            source_id="ABC123xyz",
            canonical_url="https://www.instagram.com/reel/ABC123xyz/",
            metadata_access="anonymous",
            media_access="anonymous",
            caption="Fallback title from caption\nSecond caption line",
            transcript="A transcript",
            transcript_language="en",
            transcript_probability=0.99,
        )

        self.assertIn('aliases:\n  - "Fallback title from caption"', note)
        self.assertIn("# Fallback title from caption", note)


if __name__ == "__main__":
    unittest.main()
