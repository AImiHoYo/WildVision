# `ak-ar-annotator` — 全局数据契约与物种动作分类字典规范 (Data Contract & Schema)

> **核心用途**：在让 Grok 升级前端 UI（`pyqt_app/window.py`、`timeline.py` 或单文件离线版 `public/ak_annotator_studio.html`）以及编写 Python AI 推理与数学质检脚本前，**必须强制所有模块 100% 兼容仓库 `pyqt_app` 现有的 JSON 导出格式**。这样现有单元测试（`test_labels.py`, `test_window.py`）与 `examples/` 下的所有样例均可无缝复用！

---

## 1. Stage 1 标准标注文件契约（100% 兼容 `pyqt_app` 现有导出格式）

`pyqt_app` 及离线网页版导出的单视频标注 JSON 必须严格保持以下字段结构（以 25 fps 下 0–1 秒为例）：

```json
{
  "video": "ak_000123.mp4",
  "source_labels": [
    ["Mallard Duck", "Sensing"],
    ["Common Snipe", "Flapping"]
  ],
  "annotations": [
    {
      "animal": "Mallard Duck",
      "action": "Sensing",
      "start": 0.0,
      "end": 1.0,
      "start_frame": 0,
      "end_frame": 25
    },
    {
      "animal": "Common Snipe",
      "action": "Flapping",
      "start": 2.4,
      "end": 5.2,
      "start_frame": 60,
      "end_frame": 130
    }
  ]
}
```

### 字段与防呆计算规则：
* **`video`**：仅保存视频文件名（如 `"ak_000123.mp4"`；试用示例 `public/sample_ak.mp4` 导出时自动写为 `"ak_000123.mp4"`），不保存操作系统的绝对路径，确保 macOS 与 Windows 跨机互传零报错。
* **`source_labels`**：二维数组 `[["Animal", "Action"], ...]`，支持从 JSON、CSV 或形如 `('Common Snipe', 'Flapping')` 的文本解析导入。
* **`start` / `end`**：浮点数秒（单位 `s`），保证 `end > start`。
* **`start_frame` / `end_frame`**：根据当前视频 FPS（默认读取视频真实帧率，读不到时回退为 `25`，支持手动切换 `24 / 25 / 30 / 60`）通过 `round(sec * fps)` 换算得到的整数帧号。
* **自然语言查询自动派生规则（供 Extra Bonus 时序定位使用）**：无需标注员手写句子，由算法模块根据 `animal` 与 `action` 自动生成标准查询句：
  `nl_query = f"A {animal} is {action.lower()}."`（例如 `"A Mallard Duck is sensing."` 或 `"A Goat is walking."`）。

---

## 2. Stage 1 双人标注数学鲁棒性质检报告契约 (`qc_robustness_report.json`)

用于 `pyqt_app/qc_metrics.py` 输出及前端【双人质检看板】渲染，直接提供 COMP6116 Final Report 第一部分（Dataset Annotation 25% — *"verified to be robust through mathematical analysis"*）所需的数学验证数据：

```json
{
  "video": "ak_000123.mp4",
  "annotator_pair": ["Annotator_A", "Annotator_B"],
  "overall_metrics": {
    "mean_temporal_iou": 0.842,
    "std_temporal_iou": 0.068,
    "cohens_kappa_frame_level": 0.891,
    "krippendorffs_alpha": 0.876,
    "mean_start_boundary_error_sec": 0.12,
    "mean_end_boundary_error_sec": 0.15,
    "mean_start_boundary_error_frames": 3.0,
    "mean_end_boundary_error_frames": 3.8,
    "robustness_verdict": "HIGH_QUALITY_ROBUST (Meets 18-25 pt Rubric Tier)"
  },
  "segment_comparisons": [
    {
      "label": ["Mallard Duck", "Sensing"],
      "annotator_a": { "start": 0.0, "end": 1.0, "start_frame": 0, "end_frame": 25 },
      "annotator_b": { "start": 0.08, "end": 1.04, "start_frame": 2, "end_frame": 26 },
      "temporal_iou": 0.885,
      "status": "VERIFIED"
    },
    {
      "label": ["Common Snipe", "Flapping"],
      "annotator_a": { "start": 2.4, "end": 5.2, "start_frame": 60, "end_frame": 130 },
      "annotator_b": { "start": 3.1, "end": 5.0, "start_frame": 78, "end_frame": 125 },
      "temporal_iou": 0.679,
      "status": "NEEDS_ARBITRATION",
      "reason": "tIoU (0.679) < threshold (0.70)"
    }
  ]
}
```

---

## 3. Stage 2 动作识别与 Bonus 时序定位推理接口契约 (`inference_contract.json`)

无论是 `pyqt_app/ai_worker.py` 本地 GPU/CPU 推理，还是课堂演示离线缓存模式（Offline Demo Cache），统一输出以下 JSON 结构：

```json
{
  "stage2_action_recognition": {
    "input": {
      "video": "ak_000123.mp4",
      "clip_start": 0.0,
      "clip_end": 1.0,
      "ground_truth_action": "Sensing",
      "model_name": "VideoMAE-ViT-B"
    },
    "output": {
      "predicted_action": "Sensing",
      "top_k_predictions": [
        { "action": "Sensing", "probability": 0.934 },
        { "action": "Walking", "probability": 0.041 },
        { "action": "Flapping", "probability": 0.015 }
      ],
      "dataset_evaluation": {
        "accuracy": 0.885,
        "macro_f1": 0.872,
        "class_names": ["Sensing", "Flapping", "Walking", "Running", "Feeding", "Resting"],
        "confusion_matrix": [
          [45, 1, 2, 0, 1, 1],
          [1, 42, 0, 2, 0, 0],
          [2, 0, 48, 2, 1, 0],
          [0, 1, 2, 39, 0, 0],
          [1, 0, 1, 0, 44, 2],
          [0, 0, 0, 0, 1, 41]
        ]
      }
    }
  },
  "bonus_temporal_grounding": {
    "input": {
      "video": "ak_000123.mp4",
      "nl_query": "A Mallard Duck is Sensing.",
      "model_name": "Moment-DETR"
    },
    "output": {
      "predicted_intervals": [
        { "start": 0.04, "end": 1.02, "confidence": 0.92, "iou_with_gt": 0.941 }
      ],
      "dataset_evaluation": {
        "mIoU": 0.684,
        "R1_iou_05": 0.792,
        "R1_iou_07": 0.615
      }
    }
  }
}
```
