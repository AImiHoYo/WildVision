"""Extract display-only label keys; never rewrite the metadata workbook.

Existing translations and review notes are retained when the catalog is refreshed.
"""

from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def extract_labels(workbook: Path) -> tuple[set[str], set[str]]:
    animals: set[str] = set()
    actions: set[str] = set()
    with ZipFile(workbook) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(item.itertext()) for item in ET.fromstring(
                archive.read("xl/sharedStrings.xml")
            ).findall("m:si", NS)]

        def values(row: ET.Element) -> dict[str, str]:
            result = {}
            for cell in row.findall("m:c", NS):
                column = "".join(c for c in cell.attrib["r"] if c.isalpha())
                value = cell.find("m:v", NS)
                text = value.text or "" if value is not None else ""
                if cell.get("t") == "s":
                    text = strings[int(text)]
                elif cell.get("t") == "inlineStr":
                    inline = cell.find("m:is", NS)
                    text = "".join(inline.itertext()) if inline is not None else ""
                result[column] = text
            return result

        found = False
        for name in archive.namelist():
            if not (name.startswith("xl/worksheets/sheet") and name.endswith(".xml")):
                continue
            rows = ET.fromstring(archive.read(name)).findall("m:sheetData/m:row", NS)
            if not rows:
                continue
            columns = {v: k for k, v in values(rows[0]).items()}
            if not {"list_animal", "list_animal_action"} <= columns.keys():
                continue
            found = True

            def action_pairs(value: object):
                # Some cells wrap a serialized list in another list of strings.
                if isinstance(value, str):
                    yield from action_pairs(ast.literal_eval(value))
                elif isinstance(value, (list, tuple)):
                    if (isinstance(value, tuple) and len(value) == 2
                            and all(isinstance(x, str) for x in value)):
                        yield value
                    else:
                        for item in value:
                            yield from action_pairs(item)
                else:
                    raise ValueError(f"Unexpected action entry: {value!r}")

            for row in rows[1:]:
                record = values(row)
                for animal in ast.literal_eval(record.get(columns["list_animal"]) or "[]"):
                    if not isinstance(animal, str):
                        raise ValueError(f"Non-text animal at row {row.get('r')}")
                    animals.add(animal)
                raw = record.get(columns["list_animal_action"]) or "[]"
                for _, action in action_pairs(ast.literal_eval(raw)):
                    actions.add(action)
        if not found:
            raise ValueError("Workbook has no list_animal / list_animal_action columns")
    return animals, actions


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    animals, actions = extract_labels(args.workbook)
    catalog = json.loads(args.output.read_text()) if args.output.exists() else {}
    catalog["schemaVersion"] = 1
    catalog["source"] = {"dataset": "Animal Kingdom", "sheet": "AR",
                         "animalColumn": "list_animal", "actionColumn": "list_animal_action"}
    for group, labels in (("animals", animals), ("actions", actions)):
        previous = catalog.get(group, {})
        catalog[group] = {label: previous.get(label, {
            "zh": "", "status": "needs_review" if "\ufffd" in label else "pending",
        }) for label in sorted(labels)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
    print(f"Extracted {len(actions)} actions and {len(animals)} animal labels")


if __name__ == "__main__":
    main()
