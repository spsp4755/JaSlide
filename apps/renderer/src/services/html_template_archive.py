import io
import json
from pathlib import PurePosixPath
import zipfile


MAX_ARCHIVE_ENTRIES = 500
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 100 * 1024 * 1024


def extract_html_template_archive(content: bytes) -> dict:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            names = {entry.filename for entry in entries if not entry.is_dir()}
            if len(entries) > MAX_ARCHIVE_ENTRIES or sum(entry.file_size for entry in entries) > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
                raise ValueError("Archive is too large")
            if any(not _safe_path(name) for name in names):
                raise ValueError("Unsafe archive path")

            manifests = [name for name in names if name.startswith("deck/") and name.endswith("/manifest.json")]
            if len(manifests) != 1:
                raise ValueError("Archive must contain one deck manifest")

            manifest_path = manifests[0]
            manifest = _read_json(archive, manifest_path)
            if manifest.get("format") != "html" or not isinstance(manifest.get("playlist"), list) or not manifest["playlist"]:
                raise ValueError("Invalid HTML template manifest")

            root = manifest_path.rsplit("/", 1)[0]
            slides = [_resolve_slide(name, root, names) for name in manifest["playlist"]]
            html_template = _read_text(archive, slides[0])
            css = "\n".join(_read_text(archive, name) for name in names if name.lower().endswith(".css"))
            if css:
                html_template = f"<style>{css}</style>{html_template}"
            metadata = manifest.get("metadata") if isinstance(manifest.get("metadata"), dict) else {}
            canvas = manifest.get("canvas") if isinstance(manifest.get("canvas"), dict) else {}

            return {
                "title": metadata.get("title") if isinstance(metadata.get("title"), str) else "",
                "description": metadata.get("description") if isinstance(metadata.get("description"), str) else "",
                "htmlTemplate": html_template,
                "archive": {
                    "manifestPath": manifest_path,
                    "canvas": canvas,
                    "slides": slides,
                    "thumbnailPath": next((name for name in names if name.startswith(("previews/", "thumbnails/")) and name.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))), None),
                },
            }
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, zipfile.BadZipFile, zipfile.LargeZipFile) as error:
        raise ValueError("Invalid HTML template archive") from error


def _safe_path(name: str) -> bool:
    path = PurePosixPath(name)
    return bool(name) and "\\" not in name and not path.is_absolute() and ".." not in path.parts


def _read_json(archive: zipfile.ZipFile, name: str) -> dict:
    value = json.loads(_read_text(archive, name))
    if not isinstance(value, dict):
        raise ValueError("Invalid HTML template manifest")
    return value


def _read_text(archive: zipfile.ZipFile, name: str) -> str:
    return archive.read(name).decode("utf-8")


def _resolve_slide(value: object, root: str, names: set[str]) -> str:
    if not isinstance(value, str) or not value.lower().endswith(".html") or not _safe_path(value):
        raise ValueError("Invalid HTML template playlist")
    for candidate in (f"{root}/{value}", f"{root}/slides/{value}"):
        if candidate in names:
            return candidate
    raise ValueError("HTML template slide is missing")
