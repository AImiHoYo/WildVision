# `ak-ar-annotator` (WildVision Studio) — 数据集压缩包导入、卡片式标注工作台与存储架构设计规范

> **核心目标**：解决小组被分配多个视频时的批量标注流转问题，实现 **“导入数据集压缩包 (`.zip`) ➔ 自动解压并初始化存储 ➔ 卡片墙展示进度与点选标注 ➔ 智能脏数据检测（手动保存过则退出不弹窗，未保存则提示）➔ 多选/全选卡片一键批量导出”** 的完整闭环。

---

## 一、核心架构决策：一个视频对应一个数据文件，还是多个视频对应一个数据文件？

### 🏆 结论：采用【底层存储“一视频一文件 (Sidecar JSON)” + 批量导出“支持打包 ZIP 或合并单文件”】的混合架构！

这是工业界视频标注工具（如 CVAT、Label Studio 本地模式、Vatic）最成熟的做法。为什么**在标注过程中绝对不能把所有视频塞进同一个 JSON 文件**，而必须采用 **“一视频一独立 `.ar.json` 文件 + 一个轻量级进度索引 `dataset_index.json`”**？原因如下：

| 对比维度 | ❌ 方案 A：所有视频塞进同一个大 JSON 文件 | ✅ 方案 B（推荐）：底层“一视频一独立 `.ar.json`” + 批量导出可选合并 |
| :--- | :--- | :--- |
| **1. 数据防丢与崩溃隔离（最关键）** | 50 个视频共用一个文件，如果在标第 49 个视频时电脑断电或误关软件导致文件写入中断，前 48 个视频的标注可能全部损坏归零 | 每个视频独立保存在 `workspace/annotations/<video_stem>.ar.json`（仅约 1 KB），标完 1 个锁死 1 个，任何意外绝不波及其它已标视频 |
| **2. 与现有代码 100% 零成本兼容** | 需要推翻重写 `labels.py`、`qc_metrics.py` 和全部 27 个单元测试的顶层 schema | **100% 兼容现有 `labels.py` 与 `qc_metrics.py`**：每个卡片点进去时，底层依然是标准的 `{"video": "ak_000123.mp4", "source_labels": [...], "annotations": [...]}` |
| **3. 小组多人分工与双人质检** | 组员 A 标前 10 个，组员 B 标后 10 个，或者两人交叉标，合并大文件极易发生冲突覆盖 | 卡片列表支持**勾选（多选 / 全选）**：组员只勾选自己负责的 10 张卡片即可一键导出发群里，组长拖入就能直接按视频名一对一跑 `qc_metrics.py` 算 $tIoU$ 和 Cohen's $\kappa$ |
| **4. 卡片列表秒级加载性能** | 每次返回卡片列表都要解析包含几千条标注的巨型 JSON | 卡片列表直接读取轻量级 `dataset_index.json`（只记每个视频的 `done_count / label_count / status`），几百张卡片 1 毫秒瞬间渲染 |

---

## 二、自动解压与工作区目录结构设计 (Workspace Directory Layout)

当用户点击 **「📦 导入数据集压缩包 (.zip)」**（或选择解压目标文件夹）时，后端自动在指定目录（默认解压到 `<zip所在目录>/<zip文件名>_workspace/` 或用户自选目录）建立如下标准结构，**全程无需用户手动为每个视频创建或选择保存路径**：

```text
<Dataset_Workspace_Dir>/
├── raw_extracted/                 # 压缩包原始解压内容（自动递归扫描里面的所有 .mp4/.mov/.avi 及标签文件）
│   ├── ak_000123.mp4
│   ├── ak_000124.mp4
│   └── labels.json                # 压缩包自带的全局或单视频预设标签清单（可选）
├── annotations/                   # 【自动生成】每个视频专属的独立标注存储文件（一视频一文件）
│   ├── ak_000123.ar.json          # 打开或导入时自动初始化：{"video": "ak_000123.mp4", "source_labels": [...], "annotations": []}
│   └── ak_000124.ar.json
└── dataset_index.json             # 【自动维护】供卡片墙秒级读取的进度索引与元数据
```

### `dataset_index.json` 数据契约：
```json
{
  "dataset_name": "COMP6116_Group3_Batch1",
  "workspace_dir": "/path/to/datasets/COMP6116_Group3_Batch1",
  "created_at": "2026-10-15T03:00:00Z",
  "items": [
    {
      "video_id": "ak_000123",
      "video_name": "ak_000123.mp4",
      "video_relpath": "raw_extracted/ak_000123.mp4",
      "annotation_relpath": "annotations/ak_000123.ar.json",
      "fps": 25,
      "label_count": 3,
      "done_count": 3,
      "segment_count": 5,
      "status": "completed",
      "updated_at": "2026-10-15T03:12:40Z"
    },
    {
      "video_id": "ak_000124",
      "video_name": "ak_000124.mp4",
      "video_relpath": "raw_extracted/ak_000124.mp4",
      "annotation_relpath": "annotations/ak_000124.ar.json",
      "fps": 25,
      "label_count": 3,
      "done_count": 1,
      "segment_count": 1,
      "status": "in_progress",
      "updated_at": "2026-10-15T03:15:10Z"
    }
  ]
}
```

### 智能标签自动匹配规则（解压时自动初始化每个视频的 `.ar.json`）：
解压压缩包后，程序扫描所有视频文件，并按以下优先级自动为每个视频初始化 `source_labels`：
1. **同名专属标签文件优先**：若压缩包内存在与 `ak_000123.mp4` 同名的 `ak_000123.json / .csv / .txt`，则读取该文件作为该视频的初始标签；
2. **全局标签文件次之**：若压缩包内存在 `labels.json / labels.csv / labels.txt`（或 `manifest.json` 映射表），则自动分发给对应视频；
3. **随时补充**：点进卡片后，依然可以在右侧栏随时粘贴或载入补充标签，保存时自动写回该视频对应的 `annotations/<video_stem>.ar.json`。

---

## 三、卡片式工作台与“点进/退出保存”交互流程设计

### 1. 视图一：数据集卡片墙视图 (`Dataset Grid View`)
- **顶部操作栏**：
  - 左侧：显示当前数据集名称、总进度条（如 `已完成 8 / 20 个视频 · 共 42 段标注`）、按钮 **`[📦 导入数据集压缩包 (.zip)]`**、**`[📂 打开已有工作区文件夹]`**。
  - 中间状态筛选器：`[全部 (20)]`、`[未开始 (7)]`、`[标注中 (5)]`、`[已完成 (8)]`。
  - 右侧批量选择与导出区：**`[☑ 全选]`**、**`[☐ 仅选已完成]`**、**`[📤 导出选中标注 (已选 X 项) ▾]`**。
- **视频卡片 (`VideoCard`) 设计（延续浅灰白底 `#FFFFFF` + 系统蓝 `#2563EB` 风格）**：
  - 左上角：**多选复选框 (`Checkbox`)**（点击复选框仅勾选/取消勾选，不进入详情；点击卡片主体进入该视频标注工作台）。
  - 右上角：**状态徽章（Badge）**：
    - `未开始 (0/3)`：浅灰底 `#F1F5F9` + 灰字 `#64748B`
    - `标注中 (1/3)`：浅蓝底 `#EFF6FF` + 蓝字 `#2563EB`
    - `已完成 (3/3)`：浅翠绿底 `#ECFDF5` + 绿字 `#059669`
  - 卡片中部：视频文件名（如 `ak_000123.mp4`）、已标片段总数（`5 段区间`）、微型进度条（`Progress Bar`：`done_count / label_count`）。
  - 卡片底部：最后保存时间 + `[进入标注 →]` 提示。

### 2. 视图二：单视频标注工作台 + “脏状态（Dirty State）”智能保存判断
当用户点击某张卡片（如 `ak_000123.mp4`）进入标注工作台时：
- **顶栏左侧新增**：**`[← 返回卡片列表]`** 按钮，旁边显示当前卡片序号（如 `视频 1 / 20 · ak_000123.mp4`）以及醒目的 **`[💾 保存 (⌘S / Ctrl+S)]`** 按钮（带状态指示：`已保存` vs `● 有未保存修改`）。
- **核心防呆逻辑 —— 退出卡片时的智能保存提示 (`is_dirty` 标志位)**：
  - 后端 `BackendAPI` 与前端共同维护布尔状态 `is_dirty: boolean`：
    1. **刚点进卡片加载完成时**：`is_dirty = false`。
    2. **发生任何修改时**（调用了 `mark_end`、拖拽创建/微调了区间 `update_segment`、删除了区间 `delete_segment`、解析了新标签 `parse_text`、执行了撤销 `undo`）：自动置为 `is_dirty = true`。
    3. **用户手动按下 `Ctrl+S / ⌘S` 或点击顶栏 `[💾 保存]` 按钮时**：程序立即将当前标注写入 `annotations/<video_stem>.ar.json` 并同步更新 `dataset_index.json` 的卡片进度，同时将 **`is_dirty` 重置为 `false`**，顶栏显示 `✓ 已保存`。
    4. **用户点击 `[← 返回卡片列表]`（或切换上/下一个视频）时**：
       - **若 `is_dirty === false`（即未做修改，或修改后已经手动按了保存）**：**绝不弹窗打扰**，直接秒回卡片列表！
       - **若 `is_dirty === true`（有未保存的修改）**：弹出清爽的三选一确认框：
         - **标题**：`当前视频有未保存的标注修改`
         - **按钮**：`[取消]` / `[不保存直接退出]`（丢弃本次未保存改动返回卡片墙） / **`[保存并返回]`**（主蓝色按钮，自动写入该视频 `.ar.json` 并返回卡片墙）。

### 3. 多选 / 全选卡片批量导出功能 (`Batch Export`)
在卡片墙视图勾选 1 个或多个视频卡片（或点「全选」）后，点击 **`[📤 导出选中标注]`** 提供两种一键导出格式：
1. **导出为标准标注压缩包 (`Export as .zip Bundle`)**：
   - 将所有勾选卡片对应的 `<video_stem>.ar.json` 打包成一个干净的 `.zip` 文件（如 `annotations_selected_20videos.zip`），方便直接发给队友或助教。
2. **导出为合并汇总 JSON (`Export as Merged JSON`)**：
   - 将所有勾选卡片的标注合并为一个总 JSON 文件（包含 `{"dataset_name": "...", "video_count": X, "videos": [ {...}, {...} ]}`），方便 Stage 2 / Bonus 模型训练脚本直接一次读取。

---

## 四、直接复制给 Cursor 的一键实现指令

你可以直接将下面这段指令粘贴给 Cursor，让它基于现有代码快速完成这套“数据集压缩包导入 + 卡片墙进度管理 + 脏状态智能保存 + 多选批量导出”升级：

```markdown
请读取 @doc/12_Dataset_Archive_and_Card_Workspace_Spec.md，在不破坏现有单视频标注、质检与 AI 评测功能的前提下，为 WildVision Studio 新增【数据集压缩包批量导入 + 卡片式标注工作台 + 智能退出保存 + 多选批量导出】功能：

1. **后端新增数据集工作区与 Per-Video 自动存储管理器 (`pyqt_app/dataset_manager.py` & `desktop/api.py`)**：
   - 采用“底层一视频一独立 `annotations/<video_stem>.ar.json` + 顶层 `dataset_index.json`”架构。
   - 新增接口 `import_dataset_zip(zip_path, extract_dir)`：支持选择 `.zip` 压缩包并自动解压到指定文件夹，递归扫描所有视频文件（`.mp4/.mov/.avi/.mkv/.webm`）与标签文件（支持同名标签文件或全局 `labels.json/.csv/.txt`），自动为每个视频初始化 `annotations/<video_stem>.ar.json` 与 `dataset_index.json`。
   - 新增接口 `open_dataset_folder(folder_path)`：直接打开已有的数据集工作区文件夹。
   - 新增接口 `open_card(video_id)`、`save_current_card()`：打开某张卡片时自动加载对应的视频与 `.ar.json`，并在 `BackendAPI` 中维护 `is_dirty: bool` 状态（任何增删改标注置为 `True`，手动调用 `save_current_card()` 或 `Ctrl+S` 后将 `is_dirty` 置为 `False` 并更新 `dataset_index.json` 中的 `done_count / label_count / segment_count / status`）。
   - 新增批量导出接口 `export_selected_cards(video_ids: list[str], mode: "zip" | "merged_json", dest_path: str)`：支持将勾选的多个或全部视频卡片导出为 `.zip` 标注包或合并后的单个汇总 `.json` 文件。

2. **前端新增卡片式数据集工作台视图 (`ui/src/components/DatasetCards.tsx` & `App.tsx`)**：
   - 保持现有的浅灰白底（`#F8FAFC` / `#FFFFFF`）+ 系统蓝（`#2563EB`）清爽设计风格。
   - 支持在【数据集卡片列表视图】与【单视频标注工作台视图】之间无缝切换：
     - **卡片列表视图**：顶部提供 `[导入数据集压缩包 (.zip)]`、`[打开工作区文件夹]`、状态筛选（`全部 / 未开始 / 标注中 / 已完成`）、`[全选 / 取消全选]`、`[仅选已完成]`，以及 `[导出选中标注 (.zip 包)]` 和 `[导出合并 JSON]` 按钮；每张视频卡片展示左上角多选复选框、视频名、状态徽章（未开始/标注中/已完成）、`已标 X / Y 个标签（共 Z 段）` 进度条，点击卡片主体即进入该视频标注页。
     - **单视频标注页返回与保存逻辑**：当处于数据集模式下时，顶栏显示 `[← 返回卡片列表]` 与 `[💾 保存 (⌘S)]`（实时显示 `已保存` 或 `● 未保存修改`）；点击 `[← 返回卡片列表]` 时，若 `state.is_dirty === false`（已手动保存过或未修改）则直接返回卡片列表不弹窗；若 `state.is_dirty === true` 则弹出确认框（提供 `[取消]`、`[不保存直接退出]`、`[保存并返回]` 三个按钮）。

3. **单元测试与打包同步**：
   - 新增 `pyqt_app/test_dataset_manager.py` 验证压缩包自动解压、每视频 `.ar.json` 初始化、`is_dirty` 标志流转及多选导出（ZIP 与合并 JSON），重新执行 `npm run build` 并同步更新 `dist/WildVision.app`。
```
