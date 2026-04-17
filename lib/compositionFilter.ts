import type { FileCategory } from "@/lib/fileUtils";

export const COMPOSITION_CATEGORIES: readonly FileCategory[] = [
  "video",
  "audio",
  "archive",
  "app",
  "document",
  "image",
  "other",
] as const;

/** URL / API param names (underscore). */
export const COMPOSITION_PARAM_KEYS: Record<FileCategory, string> = {
  video: "comp_video",
  audio: "comp_audio",
  archive: "comp_archive",
  app: "comp_app",
  document: "comp_document",
  image: "comp_image",
  other: "comp_other",
};

export type CompositionMode = "inactive" | "include" | "exclude";
export type CompositionMetric = "size" | "count";

export type CompositionRule = {
  mode: CompositionMode;
  /** 0–100, step 5; meaningful when mode is `include` */
  percent: number;
  metric: CompositionMetric;
};

export const DEFAULT_COMPOSITION_RULE: CompositionRule = {
  mode: "inactive",
  percent: 0,
  metric: "size",
};

/**
 * Parses `exclude` | `include` | `include:<percent>:<metric>` where metric is `size` | `count`.
 * Percent is an integer 0–100 (snapped to 5% steps), e.g. `include:30:size` → include, 30, size.
 */
export function parseCompositionParam(
  raw: string | undefined | null,
): CompositionRule {
  if (raw == null || !String(raw).trim()) {
    return DEFAULT_COMPOSITION_RULE;
  }
  const s = String(raw).trim().toLowerCase();
  if (s === "exclude") {
    return { mode: "exclude", percent: 0, metric: "size" };
  }
  const m = /^include(?::(\d+))?(?::(size|count))?$/i.exec(s);
  if (m) {
    const pctRaw = m[1] != null ? parseInt(m[1], 10) : 0;
    const pct = Number.isFinite(pctRaw)
      ? Math.min(100, Math.max(0, Math.round(pctRaw / 5) * 5))
      : 0;
    const metric = m[2] === "count" ? "count" : "size";
    return { mode: "include", percent: pct, metric };
  }
  return DEFAULT_COMPOSITION_RULE;
}

export function serializeCompositionRule(rule: CompositionRule): string {
  if (rule.mode === "inactive") {
    return "";
  }
  if (rule.mode === "exclude") {
    return "exclude";
  }
  if (rule.percent <= 0) {
    return "include";
  }
  return `include:${rule.percent}:${rule.metric}`;
}

export function isCompositionRuleActive(rule: CompositionRule): boolean {
  return rule.mode !== "inactive";
}

export type CompositionFacetFields = {
  comp_video: string;
  comp_audio: string;
  comp_archive: string;
  comp_app: string;
  comp_document: string;
  comp_image: string;
  comp_other: string;
};

export const EMPTY_COMPOSITION_FACET: CompositionFacetFields = {
  comp_video: "",
  comp_audio: "",
  comp_archive: "",
  comp_app: "",
  comp_document: "",
  comp_image: "",
  comp_other: "",
};

export function hasActiveCompositionFilters(
  s: CompositionFacetFields,
): boolean {
  for (const cat of COMPOSITION_CATEGORIES) {
    const key = COMPOSITION_PARAM_KEYS[cat] as keyof CompositionFacetFields;
    const raw = s[key];
    if (typeof raw === "string" && isCompositionRuleActive(parseCompositionParam(raw))) {
      return true;
    }
  }
  return false;
}

export function compositionFacetFromParams(
  get: (k: string) => string,
): CompositionFacetFields {
  const out: CompositionFacetFields = { ...EMPTY_COMPOSITION_FACET };
  for (const cat of COMPOSITION_CATEGORIES) {
    const k = COMPOSITION_PARAM_KEYS[cat] as keyof CompositionFacetFields;
    out[k] = get(k);
  }
  return out;
}

/** Maps `comp_*` URL params to category keys (`comp_image` → `image`). Used for `SearchOption.composition`. */
export function compositionFacetToCategoryMap(
  f: CompositionFacetFields,
): Partial<Record<FileCategory, string>> {
  const out: Partial<Record<FileCategory, string>> = {};
  for (const cat of COMPOSITION_CATEGORIES) {
    const pk = COMPOSITION_PARAM_KEYS[cat] as keyof CompositionFacetFields;
    const v = f[pk];
    if (typeof v === "string" && v.trim() !== "") {
      out[cat] = v.trim();
    }
  }
  return out;
}
