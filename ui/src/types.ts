import type { CSSProperties } from "react";

export type ThemeMode = "light" | "dark";

export type LabelItem = {
  animal: string;
  action: string;
  key: string;
};

export type SegmentItem = {
  id: string;
  animal: string;
  action: string;
  start: number;
  end: number;
  track_index?: number;
};

export type Span = {
  start: number;
  end: number;
  start_frame: number;
  end_frame: number;
};

export type CompareRow = {
  label: [string, string];
  annotator_a: Span | null;
  annotator_b: Span | null;
  temporal_iou: number;
  status: string;
  reason?: string;
};

export type QcReport = {
  video: string;
  annotator_pair: string[];
  overall_metrics: {
    mean_temporal_iou: number;
    std_temporal_iou: number;
    cohens_kappa_frame_level: number;
    krippendorffs_alpha: number;
    mean_start_boundary_error_sec: number;
    mean_end_boundary_error_sec: number;
    std_start_boundary_error_sec: number;
    std_end_boundary_error_sec: number;
    robustness_verdict: string;
  };
  segment_comparisons: CompareRow[];
};

export type ActionPayload = {
  stage2_action_recognition: {
    input: { model_name: string; ground_truth_action: string };
    output: {
      predicted_action: string;
      top_k_predictions: { action: string; probability: number }[];
      dataset_evaluation: {
        accuracy: number;
        macro_f1: number;
        class_names: string[];
        confusion_matrix: number[][];
      };
    };
  };
};

export type GroundingPayload = {
  bonus_temporal_grounding: {
    input: { nl_query: string; model_name: string };
    output: {
      predicted_intervals: { start: number; end: number; confidence: number; iou_with_gt: number }[];
      dataset_evaluation: {
        mIoU: number;
        R1_iou_05: number;
        R1_iou_07: number;
      };
    };
  };
};

export type DatasetWorkspaceOption = {
  folder_name: string;
  dataset_name: string;
  workspace_dir: string;
  video_count: number;
  completed_count: number;
  updated_at?: string;
};

export type DatasetCardItem = {
  video_id: string;
  video_name: string;
  video_relpath: string;
  annotation_relpath: string;
  video_matched?: boolean;
  fps: number;
  list_animal?: string[];
  list_animal_action?: [string, string][];
  segments?: SegmentItem[];
  label_count: number;
  done_count: number;
  segment_count: number;
  status: "unstarted" | "in_progress" | "completed" | string;
  updated_at?: string;
};

export type DesktopState = {
  mode: "annotate" | "evaluate";
  view_mode?: "cards" | "studio";
  video_id?: string;
  video_name: string;
  video_matched?: boolean;
  video_url: string;
  media_base_url?: string;
  fps: number;
  list_animal?: string[];
  list_animal_action?: [string, string][];
  available_actions?: string[];
  labels: LabelItem[];
  segments: SegmentItem[];
  selected_key: string | null;
  selected_track_index?: number;
  selected_action?: string | null;
  pending_time: number | null;
  pending_key: string | null;
  pending_track_index?: number | null;
  pending_action?: string | null;
  active_segment_id: string | null;
  selected_segment_ids?: string[];
  done_count: number;
  label_count: number;
  status_message: string;
  qc_report: QcReport | null;
  action_result: ActionPayload | null;
  grounding_result: GroundingPayload | null;
  arbitrated_ids: string[];
  compare_name: string;
  workspace_dir?: string;
  datasets_root?: string;
  dataset_name?: string;
  available_datasets?: DatasetWorkspaceOption[];
  dataset_total?: number;
  dataset_items?: DatasetCardItem[];
  active_card_id?: string | null;
  active_card_position?: number;
  active_card_patch?: DatasetCardItem | null;
  is_dirty?: boolean;
  can_undo?: boolean;
  can_redo?: boolean;
  clipboard_count?: number;
};

export type ApiResult = Partial<DesktopState> & {
  ok: boolean;
  message?: string;
  needs_confirm?: "demo" | "empty_labels" | "replace_project" | "merge_or_replace" | "leave_dirty_card";
  pending_text?: string;
  seek_to?: number;
  found?: boolean;
  path?: string;
  name?: string;
  exported_path?: string;
};

export function isFullState(result: ApiResult): result is DesktopState & ApiResult {
  return Array.isArray(result.labels) && Array.isArray(result.segments);
}

export type ActionColorSet = {
  bg: string;
  border: string;
  text: string;
  softBg: string;
  softBorder: string;
  darkText: string;
  darkSoftBg: string;
  darkSoftBorder: string;
};

export const ACTION_COLOR_PALETTE: ActionColorSet[] = [
  {
    bg: "#3B82F6",
    border: "#2563EB",
    text: "#1D4ED8",
    softBg: "#EFF6FF",
    softBorder: "#BFDBFE",
    darkText: "#93C5FD",
    darkSoftBg: "rgba(59, 130, 246, 0.16)",
    darkSoftBorder: "rgba(59, 130, 246, 0.36)",
  },
  {
    bg: "#10B981",
    border: "#059669",
    text: "#047857",
    softBg: "#ECFDF5",
    softBorder: "#A7F3D0",
    darkText: "#6EE7B7",
    darkSoftBg: "rgba(16, 185, 129, 0.16)",
    darkSoftBorder: "rgba(16, 185, 129, 0.36)",
  },
  {
    bg: "#F59E0B",
    border: "#D97706",
    text: "#B45309",
    softBg: "#FFFBEB",
    softBorder: "#FDE68A",
    darkText: "#FCD34D",
    darkSoftBg: "rgba(245, 158, 11, 0.16)",
    darkSoftBorder: "rgba(245, 158, 11, 0.36)",
  },
  {
    bg: "#8B5CF6",
    border: "#7C3AED",
    text: "#6D28D9",
    softBg: "#F5F3FF",
    softBorder: "#DDD6FE",
    darkText: "#C4B5FD",
    darkSoftBg: "rgba(139, 92, 246, 0.16)",
    darkSoftBorder: "rgba(139, 92, 246, 0.36)",
  },
  {
    bg: "#EC4899",
    border: "#DB2777",
    text: "#BE185D",
    softBg: "#FDF2F8",
    softBorder: "#FBCFE8",
    darkText: "#F9A8D4",
    darkSoftBg: "rgba(236, 72, 153, 0.16)",
    darkSoftBorder: "rgba(236, 72, 153, 0.36)",
  },
  {
    bg: "#06B6D4",
    border: "#0891B2",
    text: "#0E7490",
    softBg: "#ECFEFF",
    softBorder: "#A5F3FC",
    darkText: "#67E8F9",
    darkSoftBg: "rgba(6, 182, 212, 0.16)",
    darkSoftBorder: "rgba(6, 182, 212, 0.36)",
  },
  {
    bg: "#F97316",
    border: "#EA580C",
    text: "#C2410C",
    softBg: "#FFF7ED",
    softBorder: "#FED7AA",
    darkText: "#FDBA74",
    darkSoftBg: "rgba(249, 115, 22, 0.16)",
    darkSoftBorder: "rgba(249, 115, 22, 0.36)",
  },
  {
    bg: "#6366F1",
    border: "#4F46E5",
    text: "#4338CA",
    softBg: "#EEF2FF",
    softBorder: "#C7D2FE",
    darkText: "#A5B4FC",
    darkSoftBg: "rgba(99, 102, 241, 0.16)",
    darkSoftBorder: "rgba(99, 102, 241, 0.36)",
  },
];

export function getActionColor(action: string, orderedActions: string[] = []): ActionColorSet {
  const index = orderedActions.indexOf(action);
  if (index >= 0) {
    return ACTION_COLOR_PALETTE[index % ACTION_COLOR_PALETTE.length];
  }
  let hash = 0;
  for (let i = 0; i < action.length; i += 1) {
    hash = (hash * 31 + action.charCodeAt(i)) >>> 0;
  }
  return ACTION_COLOR_PALETTE[hash % ACTION_COLOR_PALETTE.length];
}

export function actionColorVars(color: ActionColorSet): CSSProperties {
  return {
    "--act-bg": color.bg,
    "--act-border": color.border,
    "--act-text-light": color.text,
    "--act-soft-bg-light": color.softBg,
    "--act-soft-border-light": color.softBorder,
    "--act-text-dark": color.darkText,
    "--act-soft-bg-dark": color.darkSoftBg,
    "--act-soft-border-dark": color.darkSoftBorder,
  } as CSSProperties;
}

export const EMPTY_STATE: DesktopState = {
  mode: "annotate",
  view_mode: "cards",
  video_id: "",
  video_name: "",
  video_matched: true,
  video_url: "",
  media_base_url: "",
  fps: 25,
  list_animal: [],
  list_animal_action: [],
  available_actions: [],
  labels: [],
  segments: [],
  selected_key: null,
  selected_track_index: 0,
  selected_action: null,
  pending_time: null,
  pending_key: null,
  pending_track_index: null,
  pending_action: null,
  active_segment_id: null,
  selected_segment_ids: [],
  done_count: 0,
  label_count: 0,
  status_message: "就绪",
  qc_report: null,
  action_result: null,
  grounding_result: null,
  arbitrated_ids: [],
  compare_name: "",
  workspace_dir: "",
  dataset_name: "",
  dataset_total: 0,
  dataset_items: [],
  active_card_id: null,
  active_card_patch: null,
  is_dirty: false,
  can_undo: false,
  can_redo: false,
  clipboard_count: 0,
};
