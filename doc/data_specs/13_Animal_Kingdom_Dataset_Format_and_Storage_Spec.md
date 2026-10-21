# `ak-ar-annotator` (WildVision Studio) — Animal Kingdom 数据集格式对齐、目录结构与字段命名规范

> **设计依据**：参考 CVPR 2022 官方开源数据集 **[Animal Kingdom (`sutdcv/Animal-Kingdom`)](https://github.com/sutdcv/Animal-Kingdom)**（[官方目录说明 README](https://github.com/sutdcv/Animal-Kingdom/blob/master/Animal_Kingdom/README.md) / [项目主页](https://sutdcv.github.io/Animal-Kingdom/)）在 **Action Recognition（动作识别）** 与 **Video Grounding（时序视频定位）** 两大任务中的官方组织形式，结合 COMP6116 课程要求，制定本项目的文件夹层级、文件名规范与数据表列名标准。

---

## 一、官方 Animal Kingdom (CVPR 2022) 数据集结构解析

在官方 [Animal Kingdom 数据集说明](https://github.com/sutdcv/Animal-Kingdom/blob/master/Animal_Kingdom/README.md) 中，整个数据集按任务划分为三大核心子目录（本项目涉及前两项）：

1. **`action_recognition/`（对应本项目 Stage 2 动物动作识别）**：
   - `action_recognition/dataset/video.tar.gz`：存放裁剪或原始视频片段（命名采用统一的短编码 ID，如 `AAKVD01.mp4` 或本项目示例中的 `ak_000123.mp4`）。
   - `action_recognition/annotation/`：存放动作类别字典（`df_action.xlsx` / `action_list.csv`）及训练/验证标注表（`train.csv`、`val.csv`、`train_light.csv`），核心字段包括视频标识 `video_id`、起止帧 `start_frame / end_frame`、物种 `animal`、动作名称 `action` 及动作类别编号 `action_id / labels`。
2. **`video_grounding/`（对应本项目 Extra Bonus 自然语言时序定位）**：
   - `video_grounding/dataset.tar.gz`：存放未裁剪的野外长视频（Untrimmed Videos）。
   - `video_grounding/annotation/`：采用标准 Charades-STA / VSLNet 文本与 JSON 格式（如 `ak_vg_train.txt`、`ak_vg_test.txt`），每行格式为：
     `<video_id> <start_sec> <end_sec>##<sentence>`
     例如：`ak_000123 0.00 1.00##A Mallard Duck is sensing.`

---

## 二、本项目数据集工作区文件夹结构与命名规范 (Workspace Folder Layout)

当小组长或组员在软件中点击 **「📦 导入数据集压缩包 (.zip / .tar.gz)」** 时，程序自动将其解压到项目下的 `datasets/<数据集名称>/`（或用户指定的目标文件夹），并自动建立以下标准化目录结构：

```text
datasets/<dataset_name>/
├── dataset_index.json                      # 【自动维护】顶层工作区索引（供卡片墙毫秒级读取各视频标注进度）
├── videos/                                 # 【自动归档】解压出的所有视频文件（统一按原名存放，如 ak_000123.mp4）
│   ├── ak_000123.mp4
│   ├── ak_000124.mp4
│   └── ak_000125.mp4
├── labels/                                 # 【自动识别】压缩包中附带的预设标签清单（全局或单视频同名标签）
│   └── labels.json                         # 如 [["Mallard Duck", "Sensing"], ["Common Snipe", "Flapping"]]
├── annotations/                            # 【核心存储：一视频一文件】每个视频自动生成的独立标注 JSON
│   ├── ak_000123.ar.json                   # 点进卡片按 Ctrl+S 保存时自动覆写此文件
│   ├── ak_000124.ar.json
│   └── ak_000125.ar.json
└── exports/                                # 【批量导出目录】在卡片墙多选/全选导出时自动生成的全套标准文件
    ├── selected_annotations_bundle.zip     # 包含所选视频的独立 .ar.json + 下方 4 份汇总表（一键发群里或交作业）
    ├── merged_annotations.json             # 多视频合并总 JSON（方便 Python 一次性 json.load 读取）
    ├── ak_action_recognition.csv           # 标准 CSV 宽表（可直接用 pandas.read_csv 读取）
    ├── mmaction2_annotations.txt           # Stage 2 MMAction2 标准训练列表格式
    └── ak_vg_grounding.txt                 # Extra Bonus VSLNet / Moment-DETR 标准自然语言定位格式
```

---

## 三、标准文件名与数据列名规范（方便 Python / Pandas / PyTorch 直接读取）

### 1. 单视频底层存储文件：`annotations/<video_stem>.ar.json`
保持与现有 `labels.py` 和 `qc_metrics.py` 100% 兼容的三字段结构：

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
    }
  ]
}
```

### 2. 批量导出宽表：`exports/ak_action_recognition.csv` 列名规范
为了方便后续用 `pandas.read_csv("ak_action_recognition.csv")` 或 Excel 直接统计分析，CSV 表头固定为以下 **12 个标准英文列名**：

| 列名 (Column Name) | 类型 | 示例值 | 说明与读取用途 |
| :--- | :---: | :--- | :--- |
| `video_id` | `str` | `ak_000123` | 去掉扩展名的视频唯一 ID（对齐 Animal Kingdom 官方 `video_id`） |
| `video` | `str` | `ak_000123.mp4` | 视频完整文件名 |
| `segment_index` | `int` | `0` | 该视频内的片段序号（从 0 开始，用于拼接裁剪短片名 `ak_000123_s000.mp4`） |
| `animal` | `str` | `Mallard Duck` | 动物物种英文名称 |
| `action` | `str` | `Sensing` | 动物行为英文名称 |
| `action_id` | `int` | `0` | 自动按动作字典排序生成的整数类别编号（供 Stage 2 交叉熵分类训练直接使用） |
| `start` | `float` | `0.0` | 行为开始时间戳（单位：秒） |
| `end` | `float` | `1.0` | 行为结束时间戳（单位：秒） |
| `duration` | `float` | `1.0` | 行为持续时长 `end - start`（单位：秒，方便做数据集时长分布直方图） |
| `start_frame` | `int` | `0` | 行为开始帧号 `round(start * fps)` |
| `end_frame` | `int` | `25` | 行为结束帧号 `round(end * fps)` |
| `fps` | `float` | `25` | 标注时使用的帧率 |
| `sentence` | `str` | `A Mallard Duck is sensing.` | 自动生成的自然语言描述句（供 Bonus 时序定位任务直接使用） |

### 3. Stage 2 & Bonus 专用训练文件格式（批量导出时自动附带）
- **`mmaction2_annotations.txt`**（对齐 [MMAction2](https://github.com/open-mmlab/mmaction2) VideoDataset 格式）：
  ```text
  clips/ak_000123_s000_Mallard_Duck_Sensing.mp4 0
  clips/ak_000123_s001_Common_Snipe_Flapping.mp4 1
  ```
- **`ak_vg_grounding.txt`**（对齐 [Animal Kingdom Video Grounding](https://github.com/sutdcv/Animal-Kingdom) & [VSLNet](https://github.com/26hzhang/VSLNet) Charades-STA 格式）：
  ```text
  ak_000123 0.00 1.00##A Mallard Duck is sensing.
  ak_000123 2.40 5.20##A Common Snipe is flapping.
  ```
