"""Loopback media server so the desktop window can play local videos, demux MP3-in-MP4 audio for WebKit, and extract 480p first-frame previews."""

from __future__ import annotations

import mimetypes
import struct
import threading
import uuid
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


def _iter_mp4_boxes(buf: bytes, start: int, end: int):
    pos = start
    while pos + 8 <= end:
        size, btype = struct.unpack(">I4s", buf[pos : pos + 8])
        hdr = 8
        if size == 1:
            if pos + 16 > end:
                break
            size = struct.unpack(">Q", buf[pos + 8 : pos + 16])[0]
            hdr = 16
        elif size == 0:
            size = end - pos
        if size < hdr or pos + size > end:
            break
        yield btype, pos + hdr, pos + size
        pos += size


def extract_mp3_from_mp4_bytes(buf: bytes) -> bytes | None:
    """Extract raw MPEG-1/2 Layer 3 (MP3, objectTypeIndication 0x6B/0x69) audio track from an MP4 container.

    macOS WKWebView / AVFoundation silently ignores MP3 audio tracks muxed inside MP4 (`mp4a` with esds 0x6B),
    which is used across the Animal Kingdom dataset. Demuxing the `soun` samples yields a standard `audio/mpeg`
    stream that WKWebView plays natively.
    """
    for btype, m_start, m_end in _iter_mp4_boxes(buf, 0, len(buf)):
        if btype != b"moov":
            continue
        for t_type, t_start, t_end in _iter_mp4_boxes(buf, m_start, m_end):
            if t_type != b"trak":
                continue
            for md_type, md_start, md_end in _iter_mp4_boxes(buf, t_start, t_end):
                if md_type != b"mdia":
                    continue
                is_soun = False
                stbl_range: tuple[int, int] | None = None
                for c_type, c_start, c_end in _iter_mp4_boxes(buf, md_start, md_end):
                    if c_type == b"hdlr" and c_start + 12 <= c_end:
                        if buf[c_start + 8 : c_start + 12] == b"soun":
                            is_soun = True
                    elif c_type == b"minf":
                        for mi_type, mi_start, mi_end in _iter_mp4_boxes(buf, c_start, c_end):
                            if mi_type == b"stbl":
                                stbl_range = (mi_start, mi_end)
                if not is_soun or stbl_range is None:
                    continue

                stsc_entries: list[tuple[int, int, int]] = []
                sample_sizes: list[int] = []
                chunk_offsets: list[int] = []
                for s_type, s_start, s_end in _iter_mp4_boxes(buf, stbl_range[0], stbl_range[1]):
                    if s_type == b"stsc" and s_start + 8 <= s_end:
                        cnt = struct.unpack(">I", buf[s_start + 4 : s_start + 8])[0]
                        p = s_start + 8
                        for _ in range(cnt):
                            if p + 12 <= s_end:
                                stsc_entries.append(struct.unpack(">III", buf[p : p + 12]))
                                p += 12
                    elif s_type == b"stsz" and s_start + 12 <= s_end:
                        fixed_sz, cnt = struct.unpack(">II", buf[s_start + 4 : s_start + 12])
                        if fixed_sz > 0:
                            sample_sizes = [fixed_sz] * cnt
                        else:
                            p = s_start + 12
                            sample_sizes = [
                                struct.unpack(">I", buf[p + i * 4 : p + (i + 1) * 4])[0]
                                for i in range(cnt)
                                if p + (i + 1) * 4 <= s_end
                            ]
                    elif s_type == b"stco" and s_start + 8 <= s_end:
                        cnt = struct.unpack(">I", buf[s_start + 4 : s_start + 8])[0]
                        p = s_start + 8
                        chunk_offsets = [
                            struct.unpack(">I", buf[p + i * 4 : p + (i + 1) * 4])[0]
                            for i in range(cnt)
                            if p + (i + 1) * 4 <= s_end
                        ]
                    elif s_type == b"co64" and s_start + 8 <= s_end:
                        cnt = struct.unpack(">I", buf[s_start + 4 : s_start + 8])[0]
                        p = s_start + 8
                        chunk_offsets = [
                            struct.unpack(">Q", buf[p + i * 8 : p + (i + 1) * 8])[0]
                            for i in range(cnt)
                            if p + (i + 1) * 8 <= s_end
                        ]

                if not stsc_entries or not sample_sizes or not chunk_offsets:
                    continue

                out = bytearray()
                sample_idx = 0
                for chunk_idx, offset in enumerate(chunk_offsets):
                    chunk_num = chunk_idx + 1
                    spc = stsc_entries[0][1]
                    for first_chunk, samples_per_chunk, _ in stsc_entries:
                        if chunk_num >= first_chunk:
                            spc = samples_per_chunk
                        else:
                            break
                    cur = offset
                    for _ in range(spc):
                        if sample_idx >= len(sample_sizes):
                            break
                        sz = sample_sizes[sample_idx]
                        if 0 <= cur and cur + sz <= len(buf):
                            out.extend(buf[cur : cur + sz])
                        cur += sz
                        sample_idx += 1

                if len(out) >= 4 and ((out[0] == 0xFF and (out[1] & 0xE0) == 0xE0) or out[:3] == b"ID3"):
                    return bytes(out)
    return None


class LocalMediaServer:
    def __init__(self) -> None:
        self._files: dict[str, Path] = {}
        self._tokens: dict[str, str] = {}
        self._audio_cache: dict[str, bytes | None] = {}
        self._workspace_dir: Path | None = None
        self._repo_root: Path | None = None
        self._httpd: ThreadingHTTPServer | None = None
        self._port = 0
        self._lock = threading.Lock()
        self.upload_token = secrets.token_urlsafe(32)

    @property
    def base_url(self) -> str:
        if self._httpd is not None and self._port > 0:
            return f"http://127.0.0.1:{self._port}"
        try:
            return self.start()
        except OSError:
            return ""

    def set_roots(self, workspace_dir: Path | None = None, repo_root: Path | None = None) -> None:
        with self._lock:
            if workspace_dir is not None:
                self._workspace_dir = workspace_dir.resolve()
            if repo_root is not None:
                self._repo_root = repo_root.resolve()

    def start(self) -> str:
        with self._lock:
            if self._httpd is not None:
                return f"http://127.0.0.1:{self._port}"
            handler = self._make_handler()
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            self._httpd = server
            self._port = int(server.server_address[1])
            thread = threading.Thread(target=server.serve_forever, name="wildvision-media", daemon=True)
            thread.start()
            return f"http://127.0.0.1:{self._port}"

    def publish(self, path: Path) -> str:
        try:
            base = self.start()
        except OSError:
            return path.resolve().as_uri()
        resolved = str(path.resolve())
        with self._lock:
            token = self._tokens.get(resolved)
            if token is None:
                token = uuid.uuid4().hex
                self._tokens[resolved] = token
                self._files[token] = path.resolve()
        return f"{base}/media/{token}"

    def _get_extracted_mp3(self, file_path: Path) -> bytes | None:
        key = str(file_path.resolve())
        with self._lock:
            if key in self._audio_cache:
                return self._audio_cache[key]
        try:
            raw = file_path.read_bytes()
            mp3_bytes = extract_mp3_from_mp4_bytes(raw)
        except OSError:
            mp3_bytes = None
        with self._lock:
            if len(self._audio_cache) >= 16:
                self._audio_cache.clear()
            self._audio_cache[key] = mp3_bytes
        return mp3_bytes

    def _resolve_video_query(self, query_string: str) -> Path | None:
        params = parse_qs(query_string, keep_blank_values=False)
        rel = unquote(params.get("rel", [""])[0]).strip()
        vid = unquote(params.get("id", [""])[0]).strip()
        use_sample = params.get("sample", ["0"])[0] == "1"
        allow_fallback = params.get("fallback", ["0"])[0] == "1"

        with self._lock:
            ws = self._workspace_dir
            root = self._repo_root

        if not use_sample and ws is not None:
            candidates: list[Path] = []
            if rel:
                candidates.append(ws / rel)
            if vid:
                candidates.append(ws / "videos" / f"{vid}.mp4")
            for cand in candidates:
                try:
                    resolved = cand.resolve()
                    if resolved.is_relative_to(ws) and resolved.is_file() and resolved.stat().st_size > 128:
                        return resolved
                except OSError:
                    continue

        if (use_sample or allow_fallback) and root is not None:
            sample = root / "public" / "sample_ak.mp4"
            if sample.is_file():
                return sample.resolve()
        return None

    def _make_handler(self):
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, format: str, *args) -> None:
                return

            def _send_cors_headers(self) -> None:
                origin = self.headers.get("Origin")
                if origin in ("null", owner.base_url):
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Range, Content-Type, X-File-Name")

            def do_OPTIONS(self) -> None:
                if self.headers.get("Origin") not in (None, "null", owner.base_url):
                    self.send_error(403, "Origin not allowed")
                    return
                self.send_response(204)
                self._send_cors_headers()
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_POST(self) -> None:
                parsed = urlparse(self.path)
                if parsed.path.rstrip("/") != "/upload":
                    self.send_response(404)
                    self._send_cors_headers()
                    self.end_headers()
                    return
                params = parse_qs(parsed.query, keep_blank_values=False)
                if (self.headers.get("Origin") not in (None, "null", owner.base_url)
                        or not secrets.compare_digest(params.get("token", [""])[0], owner.upload_token)):
                    self.send_error(403, "Upload authorization required")
                    return
                raw_name = unquote(params.get("name", ["dropped_bundle.zip"])[0]).strip()
                safe_name = Path(raw_name).name or "dropped_bundle.zip"
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    self.send_error(400, "Invalid content length")
                    return
                if length <= 0 or length > 20 * 1024**3:
                    self.send_error(413, "Upload size not allowed")
                    return
                self.connection.settimeout(30)
                with owner._lock:
                    base_dir = owner._workspace_dir.parent if owner._workspace_dir else Path.home() / ".wildvision" / "datasets"
                upload_dir = base_dir / ".dropped_uploads"
                upload_dir.mkdir(parents=True, exist_ok=True)
                dest = (upload_dir / f"{uuid.uuid4().hex}_{safe_name}").resolve()
                remaining = length
                try:
                    with dest.open("xb") as handle:
                        while remaining > 0:
                            chunk = self.rfile.read(min(1024 * 256, remaining))
                            if not chunk:
                                raise OSError("Incomplete upload")
                            handle.write(chunk)
                            remaining -= len(chunk)
                except OSError:
                    dest.unlink(missing_ok=True)
                    self.send_error(400, "Upload incomplete")
                    return
                import json as _json
                payload = _json.dumps({"ok": True, "path": str(dest)}, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_HEAD(self) -> None:
                self._serve(head_only=True)

            def do_GET(self) -> None:
                self._serve(head_only=False)

            def _serve_bytes(self, data: bytes, mime: str, head_only: bool) -> None:
                size = len(data)
                start, end = 0, max(0, size - 1)
                status = 200
                range_header = self.headers.get("Range")
                if range_header and range_header.startswith("bytes=") and size > 0:
                    spec = range_header.removeprefix("bytes=").split(",", 1)[0]
                    left, _, right = spec.partition("-")
                    try:
                        if left == "" and right:
                            start = max(0, size - int(right))
                            end = size - 1
                        elif left:
                            start = int(left)
                            end = int(right) if right else size - 1
                    except ValueError:
                        self.send_response(416)
                        self._send_cors_headers()
                        self.send_header("Content-Range", f"bytes */{size}")
                        self.end_headers()
                        return
                    if start < 0 or start >= size or end < start:
                        self.send_response(416)
                        self._send_cors_headers()
                        self.send_header("Content-Range", f"bytes */{size}")
                        self.end_headers()
                        return
                    end = min(end, size - 1)
                    status = 206
                length = end - start + 1 if size > 0 else 0
                try:
                    self.send_response(status)
                    self._send_cors_headers()
                    self.send_header("Content-Type", mime)
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Cache-Control", "public, max-age=3600")
                    self.send_header("Content-Length", str(length))
                    if status == 206:
                        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                    self.end_headers()
                    if not head_only and length > 0:
                        self.wfile.write(data[start : end + 1])
                except (BrokenPipeError, ConnectionResetError):
                    return

            def _serve(self, head_only: bool) -> None:
                parsed = urlparse(self.path)
                route = parsed.path.rstrip("/")
                file_path: Path | None = None
                is_audio_mp3 = False

                if route == "/video":
                    file_path = owner._resolve_video_query(parsed.query)
                else:
                    token = route.rsplit("/", 1)[-1]
                    if token.endswith(".mp3"):
                        is_audio_mp3 = True
                        token = token[:-4]
                    with owner._lock:
                        file_path = owner._files.get(token)

                if file_path is None or not file_path.is_file():
                    body = b"not found"
                    self.send_response(404)
                    self._send_cors_headers()
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    if not head_only:
                        self.wfile.write(body)
                    return

                if is_audio_mp3:
                    mp3_data = owner._get_extracted_mp3(file_path)
                    if mp3_data is None:
                        self.send_response(204)
                        self._send_cors_headers()
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                    self._serve_bytes(mp3_data, "audio/mpeg", head_only)
                    return

                size = file_path.stat().st_size
                mime = mimetypes.guess_type(file_path.name)[0] or "video/mp4"
                start, end = 0, max(0, size - 1)
                status = 200
                range_header = self.headers.get("Range")
                if range_header and range_header.startswith("bytes=") and size > 0:
                    spec = range_header.removeprefix("bytes=").split(",", 1)[0]
                    left, _, right = spec.partition("-")
                    try:
                        if left == "" and right:
                            start = max(0, size - int(right))
                            end = size - 1
                        elif left:
                            start = int(left)
                            end = int(right) if right else size - 1
                    except ValueError:
                        self.send_response(416)
                        self._send_cors_headers()
                        self.send_header("Content-Range", f"bytes */{size}")
                        self.end_headers()
                        return
                    if start < 0 or start >= size or end < start:
                        self.send_response(416)
                        self._send_cors_headers()
                        self.send_header("Content-Range", f"bytes */{size}")
                        self.end_headers()
                        return
                    end = min(end, size - 1)
                    status = 206
                length = end - start + 1
                try:
                    self.send_response(status)
                    self._send_cors_headers()
                    self.send_header("Content-Type", mime)
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Cache-Control", "public, max-age=3600")
                    self.send_header("Content-Length", str(length))
                    if status == 206:
                        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                    self.end_headers()
                    if head_only:
                        return
                    with file_path.open("rb") as handle:
                        handle.seek(start)
                        remaining = length
                        while remaining > 0:
                            chunk = handle.read(min(1024 * 256, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return

        return Handler
