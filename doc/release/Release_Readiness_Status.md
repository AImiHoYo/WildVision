# 发布验证状态

## v1.1.5 组合轨道与双语标签悬停提示（2026-10-23）

新增动物—行为唯一组合轨道（同一 `(animal, action)` 合并为单条可见轨道，重叠或相接区间取时间并集）与离线中英文标签悬停对照索引（覆盖 140 项行为、899 项动物名称中的 718 项已核对译名，181 项保留待核对状态）。标注存储与导出仍保持原始英文标签及既有 JSON 兼容结构。具体规则与范围见 [组合轨道说明](../Pair_Track_Annotations.md)、[标签中文对照说明](../Label_Translations.md) 与 [待核对动物名称](../Animal_Translation_Pending.md)。

本地前端构建、23 项前端测试与 62 项后端单元测试通过。双平台安装包由 GitHub Actions 原生构建并核验。既有 Windows 实机完整运行、跨系统实际声音听验、最低系统版本及第三方分发材料缺项保持原状态，未改记为通过。

## v1.1.4 行为洞察排版优化（2026-10-23）

重排“行为洞察”筛选栏、统计卡片与活跃度图，支持玫瑰图自适应放大、折线图随容器宽度绘制、窄窗口纵向滚动及分析提示默认收起。具体验证与限制见 [行为洞察排版验证](Insights_Layout_Validation.md)。

## v1.1.3 启动引导热修复（2026-10-22，同版本覆盖修订）

本次覆盖修订明确先选择软件文件夹，数据集稍后导入，并醒目显示选错的完整路径和原因。修复 v1.1.2 在部分 Mac 下载后因路径隔离直接退出的问题。窗口先打开，必要时引导选择当前版本解压文件夹并记住位置；数据仍在便携目录 datasets/runtime。取消、选错和不可写可重试。具体行为、验证步骤和限制见 [启动引导热修复](Startup_Guide_Hotfix.md)。

按维护者要求替换 v1.1.3 同名附件，并将 v1.1.3 标签对齐此次源码；旧提交保留在 main 历史。原生 Windows 完整运行、听验及第三方材料缺项保持原状态。旧修订已在本机实际下载版的系统隔离路径中通过目录选择并进入样本库，不能代替本次覆盖修订的重新验证。

## v1.1.2 便携目录更新（2026-10-22）

桌面 ZIP 改为程序、公开源码、datasets、runtime 同目录。导入不再写入隐藏用户目录；工作区搬家后更新索引位置，自动保存可随便携数据集重定位；样本库增加实际路径与打开目录按钮。旧数据保持原位，README 说明复制迁移和升级备份。

本地针对性与完整测试、原生 macOS 构建和最终 ZIP 校验分开记录，具体流程及限制见 [便携目录验证](Portable_Layout_Validation.md)。已发布版本的附件和标签不重写，新修订使用 v1.1.2。既有原生运行/声音和第三方材料缺项保持原状态。

## v1.1.1 更新（2026-10-22）

新增六档预设及自定义播放倍速，画面和分离音轨同步变速；当前会话切换视频时保留选择，标注仍使用源时间。README 补充用户反馈的 macOS “Apple 无法验证”弹窗图片与“隐私与安全性 → 仍要打开”的具体步骤。

本地 TypeScript/Vite 构建、14 项前端测试、47 项后端测试和隔离 macOS arm64 打包已通过。GPT-6.1-Sol 完成独立针对性复核；主代理在真实后端的本地界面中完成预设、自定义、异常值、实际音画时钟、切换保留及源时间不变验证。具体范围及重复步骤见 [倍速验证](Playback_Speed_Validation.md)。

未将本地 Chrome 界面验证扩大为 Windows 原生或所有 macOS WebView 的验收结论。自签名方案保持，既有声音听验、干净系统安装及第三方材料缺项保持原状态。

## v1.0.1 当前状态（2026-10-22）

源码已上传到公开仓库 [AImiHoYo/WildVision](https://github.com/AImiHoYo/WildVision)，包括 GPL-3.0-only 许可证、标注界面前后视频切换、右键更换行为以及重写后的完整操作流程。107 个公开文件通过基础扫描，未发现被忽略但仍受 Git 跟踪的文件；本地数据集、视频、凭据、依赖与原始测试记录未纳入提交。

本地隔离构建的 47 项后端测试、11 项前端测试通过；两个新增功能的回归及真实 Python 后端下的浏览器交互已验证，范围见 [功能更新验证](Annotation_Workflow_Validation.md)。[GitHub Actions 双平台重跑](https://github.com/AImiHoYo/WildVision/actions/runs/39723829890)已通过，每个平台均完成 47 项后端测试、11 项前端测试、原生构建与 ZIP 打包。Windows 首次运行时的中文构建日志编码错误已修复。两份 CI ZIP 均已下载并核对 CRC/SHA-256；Windows PE x64、内嵌界面/FFmpeg/离线 WebView2 组件已检查；macOS 解压后的 arm64、版本和严格签名完整性已检查。这些检查不等同实际窗口和声音验收。

用户已确认 macOS 使用本地 ad-hoc 自签名分发，Developer ID 与公证不作为本次预发布的必需项。该候选已在本机启动原生窗口；首次从下载渠道打开时仍可能需要用户在系统设置中确认，README 已补操作步骤。

Windows 验证先采用用户提供的 CrossOver 26.3。已新建独立 Windows 10 / win64 容器，未改动现有应用容器。首轮 EXE 在 Wine Mono 加载 `System.Windows.Forms.dll` 时失败，正在专用容器补充官方 .NET Framework 后重试。用户最初看到的窗口已确认是 macOS 版，因此不能据此记录 Windows 主界面通过。CrossOver 的结果按兼容层验证记录，真实 Windows 验收仍单独标注。

**维护者已明确要求停止追加测试，直接发布现有构建。v1.0.1 以预发布形式提供 Windows x64、macOS arm64 ZIP、应用源码 ZIP 及其 SHA-256 文件。** 发布不将下列未完成项目改记为通过：实际 FFmpeg 二进制及其链接组件的完整对应源码与分发材料尚未收齐，双平台干净机器首次运行、扬声器听验、macOS 下载后的系统放行也未完成。已有二进制配置和许可证输出不能替代这些材料；源码 ZIP 只包含 WildVision 应用源码。macOS 采用维护者已确认的 ad-hoc 自签名方案，没有 Developer ID 签名和公证。

CrossOver 中的 .NET 安装窗口已由用户完成，但按停止测试的要求未再启动 EXE；补装后的界面、声音与标注流程均为 not_run。首轮 Wine Mono 错误的记录保留，不冒充复测通过。

6.1 Sol 已完成新增功能回归验证；本次追加的分发材料复核因模型额度限制未运行，不能记作通过。

## 以下为历史记录

历史基线：v1.0.0；新版本 v1.0.1 功能验证见 [功能更新验证](Annotation_Workflow_Validation.md)。以下结论保留其历史范围。

更新：2026-10-22（Asia/Macau）。结论：**本地候选已准备，正式发布仍 blocked**。本文件是脱敏摘要；原始日志保存在默认被 Git 忽略的 `doc/release/validation/`。

## 已完成与证据范围

| 项目 | 状态 | 已验证范围 |
|---|---|---|
| 项目许可证 | pass | 用户选择 GPL v3，根 LICENSE 与说明采用 GPL-3.0-only；不替代第三方授权 |
| 保存与恢复修复 | pass（针对性） | 临时文件写入/fsync/替换故障注入、索引失败缓存隔离、自动保存身份与恢复 dirty 状态；不宣称真实断电测试或多文件事务 |
| 导入与本地上传 | pass（针对性） | 重复导入不覆盖、归档路径及保留名拒绝、上传会话令牌/来源/长度校验；不等同完整安全审计 |
| 媒体 | pass（自动化） | 合成视频带声裁剪、边界和失败保护、24/30/60 fps、空 PATH 下包内 FFmpeg；未听验真实扬声器 |
| 回归测试 | pass | 隔离源码构建执行 38 个后端测试、11 个前端测试；无本机私有样例依赖 |
| macOS arm64 候选 | pass（包装） | v1.0.0 元数据、arm64、ad-hoc 签名完整性、ZIP CRC/SHA-256、解压后权限/链接/文件一致性和签名 |
| 公开源码范围 | pass（基础检查） | 实际 Git ignore 语义枚举、敏感文本基础规则、白名单打包；无数据集、私有视频、依赖目录或原始验证日志；无 Git 历史可查 |
| Windows | blocked | 只有构建工作流、图标/元数据与离线 WebView2 准备代码；模拟分支验证不等于原生 EXE 或实机安装成功 |

GPT-6.1-Sol 的第二批原始结果为 25 项：24 pass、1 fail。其中失败命令的 `-ss .2` 被 FFmpeg 拒绝，未运行到裁剪阶段。主代理保留原记录，改用 `-ss 0.2` 和 `-t 0.8` 在同一候选包的 FFmpeg 上重跑：空 PATH 下成功输出 0.8 秒、含音轨且完整解码通过。此复核由主代理执行，不算作 6.1-Sol 的复测。6.1-Sol 因额度限制未完成最终报告汇总。

## 候选产物

本地 `release/archives/`：

- `WildVision-v1.0.0-macOS-arm64.zip` 和同名 `.zip.sha256`：供本地候选验收，Apple Silicon 专用。
- `WildVision-v1.0.0-Source.zip` 和同名 `.zip.sha256`：按公开候选白名单生成的应用源码；不是新手安装包，也不代表所有第三方对应源码已齐备。

包内包含 GPL 文本和第三方记录。演示视频为构建时生成的测试图案与音调，不含本机真实动物视频。原有 `release/WildVision.app`、`dist/` 应用未替换；应使用上述新 ZIP 验收，不能混用旧包结果。

## 发布前还必须完成

1. **Windows x64 原生构建与验收**：在 Windows 构建者环境执行 `npm ci`、前端测试、安装固定 Python 构建依赖、`scripts/fetch_windows_runtime.ps1`、`build_desktop_app.py`、`scripts/package_release.py --expect-arch x64`。记录 EXE 嵌入版本、PE 架构、包内运行组件、ZIP 哈希。再在没有 Python/Node/FFmpeg、且未安装 WebView2 的干净 Windows 用户环境测试首次运行、运行时安装提示、标注/保存/重开/有声播放/裁剪。拒绝安装和安装失败也需有明确提示。步骤见 Runbook R15-N。
2. **macOS 分发与新手验收**：确定实际支持的最低系统版本，完成分发签名/公证方案；从真实下载渠道取得最终 ZIP，在干净用户环境解压并从 Applications 打开。记录 Gatekeeper 行为，执行标注/保存/重开、有声播放、拖动与裁剪。当前 ad-hoc 完整性验证不能替代上述验收，不能据此承诺下载即用。
3. **第三方与素材材料**：逐平台核对实际 FFmpeg 构建及链接组件的对应源码、构建信息和许可证；核对 Python/原生桥接/WebView2、字体、图标与示例材料。具体缺口见 `THIRD_PARTY_NOTICES.md`。当前应用 Source ZIP 不覆盖这些缺口。
4. **GitHub 发布身份与最终内容**：尚无 Git 仓库/提交/tag/远程地址。确定目标仓库后，对实际暂存文件和待推送 refs 再检查；记录最终源版本与二进制哈希。补齐支持系统、架构、解压方式、限制和校验值的 Release 正文。只有在验收与材料齐备后，才进行获准的推送、上传与发布。

完整操作规程见 [Release_Validation_Runbook.md](Release_Validation_Runbook.md)、[ZIP_Release_Procedure.md](ZIP_Release_Procedure.md) 和 [Repository_Publication_Audit.md](Repository_Publication_Audit.md)。任何新运行时修改均须重新构建、更新哈希并执行受影响验证；仅文档更新须重新生成源码候选。
