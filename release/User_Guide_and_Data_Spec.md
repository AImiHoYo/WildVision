> v1.1.2 桌面包采用便携目录：请保留整个解压文件夹，双击其中的程序。导入数据在同级 `datasets`，视频位于数据集的 `videos`，标注位于 `annotations`。自动保存和日志在 `runtime`。升级先备份，再复制数据到新版本；不要用空目录覆盖旧数据。旧版隐藏目录数据迁移方法见根目录 README。

# `ak-ar-annotator` (WildVision Studio) — Animal Kingdom 数据预处理规范与预制 JSON 格式说明

> **核心设计理念**：在分发数据集压缩包前，先将原始表格中的三列核心元数据（`video_id`、`list_animal_action`、`list_animal`）预处理为规范的 JSON 文件随视频一起打包。软件导入数据集时**不再盲目新建空白结构**，而是直接读取预制 JSON 进行初始化、校验 `video_id` 与视频文件名是否匹配，并在标注过程中**仅更新 JSON 中的 `"annotations"` 字段**。

---

## 一、原始三列元数据解析与软件界面映射关系

以 Animal Kingdom 数据集的典型样本为例：

| `video_id` | `list_animal_action` | `list_animal` |
| :--- | :--- | :--- |
| `AAACXZTV` | `[('Common Crane', 'Attending'), ('Common Crane', 'Eating')]` | `['Common Crane', 'Common Crane']` |
| `AABCQPTK` | `[('Singing Nightingale', 'Attending'), ('Singing Nightingale', 'Chirping')]` | `['Singing Nightingale', 'Singing Nightingale']` |

### 这三列信息在软件中的精确作用：
1. **`video_id`（视频唯一标识）**：
   - 初始化时，软件自动校验 `video_id`（如 `AAACXZTV`）与视频文件名（如 `AAACXZTV.mp4` 的主文件名）是否一致，并在卡片上显示匹配状态（`✓ 视频已匹配` 或 `⚠ 缺少对应视频`）。
2. **`list_animal`（动物种类及个体个数列表）**：
   - **在卡片集界面**：提取不重复的物种名（如 `Common Crane`、`Singing Nightingale`），生成顶部的**物种分类筛选器**，并在每张卡片上清晰展示该视频包含的物种与个体数量（如 `Common Crane × 2`）。
   - **在单视频标注界面（下方时间轴）**：`list_animal` 有几个元素，下方时间轴就生成几条**动物个体轨道（Animal Tracks）**。例如 `['Common Crane', 'Common Crane']` 会生成两条写着 `Common Crane #1` 和 `Common Crane #2` 的时间轴轨道，分别代表画面中的第 1 只和第 2 只灰鹤。
3. **`list_animal_action`（动物—行为键值对列表）**：
   - **在单视频标注界面（右侧行为栏）**：提取该视频涉及的行为（如 `Attending`、`Eating`），为每个行为分配**独立且固定的专属颜色**（例如 `Attending` 为经典蓝 `#2563EB`、`Eating` 为松石青 `#0D9488`、`Chirping` 为靛紫 `#7C3AED`）。
   - **标注联动逻辑**：当用户在右侧点选某个行为（如 `Eating`），即可在下方选择某一条 `Common Crane` 的时间轴轨道进行打点或拖拽标注；**标出的时间条颜色与右侧所选行为的颜色严格一致**，且同一条动物轨道上可以在不同时间段标注多个不同颜色的行为（如先 `Attending` 再 `Eating`）。

---

## 二、规范化的预制 JSON 格式定义（解决同名动物键冲突问题）

### ⚠️ 为什么草稿中的写法需要微调？
在你的设计构想中，希望把同一只动物在不同时间做的不同行为归拢在该动物名下：
```text
// ❌ 草稿伪代码（存在两个问题：1. 连续两个冒号语法非法；2. 同一个对象里有两个相同的键 "Common Crane" 会导致前一只被覆盖）
{
  "animal": "Common Crane": [ ... ],
  "animal": "Common Crane": [ ... ]
}
```
在标准 JSON（RFC 8259）语法中，同一个 `{}` 对象内不能出现重复的 Key。因此，最规范、最易被 Python / Pandas / PyTorch 读取的做法是将 `"annotations"` 定义为**与 `list_animal` 顺序严格一一对应的动物轨道数组**，每个元素通过 `"animal"` 记录物种名，通过 `"actions"` 数组存放该个体在不同时间段的所有行为：

### ✅ 标准预制与存储 JSON 格式 (`<video_id>.json` 或 `dataset_manifest.json`)

#### 1. 预处理初始化时的 JSON（分发给标注员前，`actions` 为空数组 `[]`）：
```json
{
  "video_id": "AAACXZTV",
  "video": "AAACXZTV.mp4",
  "fps": 25,
  "list_animal": [
    "Common Crane",
    "Common Crane"
  ],
  "list_animal_action": [
    ["Common Crane", "Attending"],
    ["Common Crane", "Eating"]
  ],
  "annotations": [
    {
      "animal": "Common Crane",
      "actions": []
    },
    {
      "animal": "Common Crane",
      "actions": []
    }
  ]
}
```

#### 2. 标注员完成标注保存后的 JSON（**仅更新 `"annotations"` 关键字**）：
```json
{
  "video_id": "AAACXZTV",
  "video": "AAACXZTV.mp4",
  "fps": 25,
  "list_animal": [
    "Common Crane",
    "Common Crane"
  ],
  "list_animal_action": [
    ["Common Crane", "Attending"],
    ["Common Crane", "Eating"]
  ],
  "annotations": [
    {
      "animal": "Common Crane",
      "actions": [
        {
          "action": "Attending",
          "start": 0.0,
          "end": 0.907,
          "start_frame": 0,
          "end_frame": 23
        },
        {
          "action": "Eating",
          "start": 1.1,
          "end": 1.6,
          "start_frame": 28,
          "end_frame": 40
        }
      ]
    },
    {
      "animal": "Common Crane",
      "actions": [
        {
          "action": "Eating",
          "start": 0.0,
          "end": 0.666,
          "start_frame": 0,
          "end_frame": 17
        }
      ]
    }
  ]
}
```

### 字段单位与格式统一规范：
* **`start` 与 `end`**：统一使用**秒（Seconds，`float` 浮点数，四舍五入保留 3 位小数，如 `0.0`、`0.907`、`1.1`）**，且必须满足 `0.0 <= start < end`。
* **`start_frame` 与 `end_frame`**：统一使用**整数帧号（Frame Index，`int`，按 `round(seconds * fps)` 计算，如 25 fps 下 `0.907 * 25 -> 23`）**。
* **多视频单文件预制模式兼容**：除了支持“一视频一预制 `<video_id>.json`”外，软件也支持在压缩包根目录放一个总预制文件 `dataset_preprocessed.json`（数组形式 `[ { "video_id": "AAACXZTV", ... }, { "video_id": "AABCQPTK", ... } ]`）或直接放含 `video_id | list_animal_action | list_animal` 三列的 CSV/TSV 表，软件导入时会自动按 `video_id` 校验视频并初始化卡片！

---

## 三、数据预处理指南：如何把三列表格一键转为预制 JSON？

我们在仓库根目录提供了开箱即用的预处理脚本 `preprocess_ak_dataset.py`。

### 1. 准备输入表格（支持 CSV / TSV / 竖线 `|` 分隔文本）
例如保存为 `raw_metadata.txt` 或 `raw_metadata.csv`：
```text
video_id|list_animal_action|list_animal
AAACXZTV|[('Common Crane', 'Attending'), ('Common Crane', 'Eating')]|['Common Crane', 'Common Crane']
AABCQPTK|[('Singing Nightingale', 'Attending'), ('Singing Nightingale', 'Chirping')]|['Singing Nightingale', 'Singing Nightingale']
```

### 2. 运行预处理脚本生成预制 JSON 与分发压缩包
```bash
python3 preprocess_ak_dataset.py --input raw_metadata.txt --videos-dir ./raw_videos --output-dir ./prepared_dataset --zip
```
该命令会自动完成：
1. 用 `ast.literal_eval` 安全解析 Python 格式的 `list_animal_action`（元组列表）和 `list_animal`（字符串列表），自动容错中英文弯引号（如 `’` 替换为 `'`）；
2. 检查 `--videos-dir` 下是否存在对应的 `<video_id>.mp4`；
3. 为每个 `video_id` 生成上述标准格式的 `<video_id>.json`（预置好与 `list_animal` 等长的空 `"annotations"` 轨道数组）；
4. 打包成可直接发给小组成员导入的 `.zip` 数据集压缩包！
