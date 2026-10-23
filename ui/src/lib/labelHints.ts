import { animals, actions } from "../data/labelCatalog.json";

export type LabelKind = "animal" | "action";
export type LabelReference = { kind: LabelKind; label: string };
type Translation = {
  zh: string;
  status: string;
  note?: string;
  scientificName?: string;
};
const catalog: Record<"animals" | "actions", Record<string, Translation>> = { animals, actions };

export function lookupLabel(kind: LabelKind, label: string): Translation | undefined {
  // Exact dataset keys only: no fuzzy species identification or guessed suffixes.
  const group = catalog[kind === "animal" ? "animals" : "actions"];
  return Object.prototype.hasOwnProperty.call(group, label) ? group[label] : undefined;
}

export function labelHint(kind: LabelKind, label: string) {
  return { "data-label-hint": JSON.stringify([{ kind, label }]) };
}

export function labelHints(labels: LabelReference[]) {
  return { "data-label-hint": JSON.stringify(labels) };
}

export function parseLabelHints(raw: string): LabelReference[] {
  try {
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    return items.filter((item): item is LabelReference =>
      item && (item.kind === "animal" || item.kind === "action") &&
      typeof item.label === "string" && item.label.length > 0,
    );
  } catch {
    return [];
  }
}
