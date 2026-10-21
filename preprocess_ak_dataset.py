#!/usr/bin/env python3
"""Preprocess Animal Kingdom metadata (video_id | list_animal_action | list_animal) into standardized JSONs."""

from __future__ import annotations

import argparse
import ast
import csv
import json
import shutil
import zipfile
from pathlib import Path

SAMPLE_ROWS = [
    {
        "video_id": "AAACXZTV",
        "list_animal_action": "[('Common Crane', 'Attending'), ('Common Crane', 'Eating')]",
        "list_animal": "['Common Crane', 'Common Crane']",
    },
    {
        "video_id": "AABCQPTK",
        "list_animal_action": "[('Singing Nightingale', 'Attending'), ('Singing Nightingale', 'Chirping')]",
        "list_animal": "['Singing Nightingale', 'Singing Nightingale']",
    },
]


def _clean_quotes(raw: str) -> str:
    return (
        raw.strip()
        .replace("‘", "'")
        .replace("’", "'")
        .replace("“", '"')
        .replace("”", '"')
    )


def parse_list_animal(raw: str | list) -> list[str]:
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    cleaned = _clean_quotes(str(raw))
    if not cleaned:
        return []
    val = ast.literal_eval(cleaned)
    if isinstance(val, (list, tuple)):
        return [str(item).strip() for item in val if str(item).strip()]
    return [str(val).strip()]


def parse_list_animal_action(raw: str | list) -> list[list[str]]:
    if isinstance(raw, list):
        out: list[list[str]] = []
        for item in raw:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                out.append([str(item[0]).strip(), str(item[1]).strip()])
        return out
    cleaned = _clean_quotes(str(raw))
    if not cleaned:
        return []
    val = ast.literal_eval(cleaned)
    out = []
    if isinstance(val, (list, tuple)):
        for item in val:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                out.append([str(item[0]).strip(), str(item[1]).strip()])
    return out


def build_preprocessed_record(
    video_id: str,
    list_animal_action: str | list,
    list_animal: str | list,
    *,
    video_filename: str | None = None,
    fps: float = 25.0,
) -> dict:
    vid = video_id.strip()
    animals = parse_list_animal(list_animal)
    pairs = parse_list_animal_action(list_animal_action)
    if not animals and pairs:
        animals = sorted({pair[0] for pair in pairs})
    return {
        "video_id": vid,
        "video": video_filename or f"{vid}.mp4",
        "fps": int(fps) if float(fps).is_integer() else float(fps),
        "list_animal": animals,
        "list_animal_action": pairs,
        "annotations": [
            {
                "animal": animal_name,
                "actions": [],
            }
            for animal_name in animals
        ],
    }


def parse_metadata_table(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig").strip()
    if text.startswith("[") or text.startswith("{"):
        data = json.loads(text)
        rows = data if isinstance(data, list) else data.get("items") or data.get("videos") or [data]
        return [
            build_preprocessed_record(
                str(r.get("video_id") or Path(str(r.get("video", ""))).stem),
                r.get("list_animal_action") or r.get("source_labels") or [],
                r.get("list_animal") or [],
                video_filename=r.get("video"),
                fps=float(r.get("fps") or 25),
            )
            for r in rows
        ]

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return []
    delimiter = "｜" if "｜" in lines[0] else ("|" if "|" in lines[0] else ("\t" if "\t" in lines[0] else ","))
    records: list[dict] = []

    if delimiter in ("｜", "|"):
        for idx, line in enumerate(lines):
            parts = [p.strip() for p in line.replace("｜", "|").split("|")]
            if len(parts) < 3:
                continue
            if idx == 0 and parts[0].lower() == "video_id":
                continue
            records.append(build_preprocessed_record(parts[0], parts[1], parts[2]))
    else:
        reader = csv.DictReader(lines, delimiter=delimiter)
        for row in reader:
            vid = (row.get("video_id") or "").strip()
            if not vid:
                continue
            records.append(
                build_preprocessed_record(
                    vid,
                    row.get("list_animal_action") or "[]",
                    row.get("list_animal") or "[]",
                )
            )
    return records


def main() -> int:
    parser = argparse.ArgumentParser(description="Preprocess Animal Kingdom 3-column metadata into JSON dataset.")
    parser.add_argument("--input", type=Path, help="Input CSV/TSV/pipe table or JSON file")
    parser.add_argument("--videos-dir", type=Path, help="Folder containing source <video_id>.mp4 files")
    parser.add_argument("--output-dir", type=Path, default=Path("prepared_ak_dataset"), help="Output directory")
    parser.add_argument("--zip", action="store_true", help="Also package output directory as a .zip archive")
    args = parser.parse_args()

    records = (
        parse_metadata_table(args.input)
        if args.input and args.input.is_file()
        else [build_preprocessed_record(r["video_id"], r["list_animal_action"], r["list_animal"]) for r in SAMPLE_ROWS]
    )

    out_dir = args.output_dir.resolve()
    videos_out = out_dir / "videos"
    ann_out = out_dir / "annotations"
    videos_out.mkdir(parents=True, exist_ok=True)
    ann_out.mkdir(parents=True, exist_ok=True)

    for rec in records:
        vid = rec["video_id"]
        if args.videos_dir and args.videos_dir.is_dir():
            for ext in (".mp4", ".mov", ".avi", ".mkv", ".webm"):
                cand = args.videos_dir / f"{vid}{ext}"
                if cand.is_file():
                    rec["video"] = cand.name
                    shutil.copy2(cand, videos_out / cand.name)
                    break
        ann_file = ann_out / f"{vid}.json"
        ann_file.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    manifest_file = out_dir / "dataset_preprocessed.json"
    manifest_file.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.zip:
        zip_path = out_dir.with_suffix(".zip")
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for file_path in sorted(out_dir.rglob("*")):
                if file_path.is_file():
                    zf.write(file_path, arcname=str(file_path.relative_to(out_dir)))
        print(f"Created preprocessed dataset archive: {zip_path}")
    else:
        print(f"Created preprocessed dataset folder: {out_dir} ({len(records)} videos)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
