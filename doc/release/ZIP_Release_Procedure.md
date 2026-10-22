# ZIP 发布规程与当前准入状态

2026-10-22 更新。用户已确认：GitHub Releases 使用 ZIP，区分 Windows/macOS，在附件名和说明中写明系统架构；macOS 使用本地 ad-hoc 自签名，Windows 先在 CrossOver 中验证并注明兼容层范围。普通用户无需安装开发环境的要求继续有效。

## 附件命名与打开方式

| 附件命名模板 | 系统架构 | 用户操作 |
|---|---|---|
| `WildVision-v<VERSION>-Windows-x64.zip` | Windows，Intel/AMD 64 位 | 完整解压，双击 WildVision.exe |
| `WildVision-v<VERSION>-macOS-arm64.zip` | macOS，Apple Silicon | 保留完整便携文件夹，双击其中的 WildVision.app |
| `WildVision-v<VERSION>-macOS-x86_64.zip` | macOS，Intel | 仅在实际构建和验收后提供；当前未准备 |

上述是命名模板。v1.0.1 的 Windows x64 和 macOS arm64 原生 CI 构建、ZIP 与校验文件已生成并下载复核，按维护者停止追加测试并直接发布的要求，现提供为预发布附件。分发材料和运行验收的缺项继续记录，未改记为通过。当前 CI 只配置 Windows x64 和 macOS arm64，不宣称 Intel Mac、Windows ARM64 或 universal2 已支持。最低系统版本必须通过目标机实测后填写，不能以“macOS/Windows 最新版”替代支持说明。

每个 ZIP 配套同名 `.zip.sha256`。发布正文再次写出版本、支持的系统版本、架构、解压打开方式、已知限制和校验值。GitHub 自动生成的 Source code ZIP 不属于普通用户安装包。禁止给同一二进制换名字冒充另一架构。

## 构建者的操作步骤

1. 从审核过的源码在对应系统构建，安装开发工具是构建者的工作，不能出现在普通用户使用流程中。
2. 先修复准入阻断并统一 UI、应用元数据、Git tag 和附件版本。`build_desktop_app.py` 已从 UI 版本生成两平台元数据，并在 macOS 元数据完成后对新构建签名；包装脚本继续独立校验，不修改旧包来掩盖不一致。
3. 构建得到 `release/WildVision.app` 或 `release/WildVision.exe` 后运行：macOS `python scripts/package_release.py --expect-arch arm64`；Windows `python scripts/package_release.py --expect-arch x64`。当前窗口应用在原生平台构建，不能在 macOS 上生成一个 ZIP 就视为 Windows 程序。
4. 脚本从 `ui/package.json` 读取版本；macOS 对照 Info.plist、用 lipo 校验实际架构、验证代码签名；Windows 读取实际 PE Machine 校验架构。Windows 嵌入版本与系统运行依赖还需单独验收，PE 检查不替代它们。
5. v1.1.2 起，脚本装入已提交 Git revision 的源码目录、指定应用、README、BUILD 元数据、公开用户指南、LICENSE、THIRD_PARTY_NOTICES.md，以及初始 datasets/runtime 说明文件。只从 git archive 取得源码；有未提交的跟踪文件时拒绝打包，并拒绝源码中出现 datasets/runtime、依赖或本地验证记录。不会整个压缩 release 目录或携带真实数据。macOS 用 ditto 保留包权限/符号链接；输出在 `release/archives/`，检查 ZIP CRC 并生成 SHA-256。已有同名候选时拒绝覆盖。
6. 当前 Windows 封装输入为 PyInstaller 单文件 EXE；如果后续增加包外 WebView2/FFmpeg 等运行组件，必须同步扩展**明确批准的包装文件清单**并验收，不能把现有仅含 EXE 的 ZIP 当成依赖齐全。macOS 的依赖应进入 .app。当前构建已计划将 WebView2 离线安装器和 FFmpeg 放入 EXE 内，必须在 Windows 实际构建后核对；源码中有收集规则不等于二进制已经具备。许可证文件缺失时包装直接失败。
7. 对最终 ZIP 解压验证，再执行 R15-N 双平台新手验收。比对权限、链接、签名、架构、版本和校验值；确认无开发工具仍能标注、保存、重开、播放有声视频和裁剪。
8. `.github/workflows/release-desktop.yml` 已改为上传 ZIP 和校验文件，缺产物即失败，不再直接上传 .app 目录。Actions artifact 是构建传输载体；未来发布时提取其中明确命名的 ZIP 作为 Release 附件，避免将 Actions 的外层下载压缩包误当成正式附件。
9. 核对待上传附件及哈希，再按维护者的明确发布授权上传/发布。v1.0.1 提供桌面 ZIP、应用源码 ZIP 和各自校验文件，并在正文记录尚未完成的验收与分发材料。

ZIP 是交付格式，不提供缺失的运行环境，也不修复业务缺陷。签名完整性检查不代表 Developer ID、公证、Windows 信誉检查或真实下载启动验收通过。

## 修复前基线（历史记录）

以下为修复开始前的实时复核，不能作为修复后源码/新包的状态。整体仍须等待修复后验证与外部验收：

- 本地只有 macOS arm64 应用；Windows EXE 和双平台正式候选 ZIP 均未齐备。
- macOS 包为 0.0.0，UI 为 1.0.0；当前包会被新增 ZIP 包装的版本校验拒绝。
- 数据保存、恢复、重导入和媒体相关的 4 个关键源码文件与首轮验证哈希相同；没有修复提交或新证据消除之前的阻断。此结论是当前文件对照，未冒充重新执行全部故障测试。
- 根 LICENSE、包内裁剪依赖、双平台干净机器/真实声音/下载启动证据仍未齐备；本地目录也尚无 Git 追溯。
- `.gitignore` 规则与公开候选基础扫描已经验证，但不代表许可证、素材权利或整个软件已可发布。

原始当前复核与隔离包装实验保存在本地 `doc/release/validation/20261021-204015-zip-readiness/`，默认不提交。隔离副本的包装成功只能证明 ZIP 流程，不是正式候选版验收。

## 当前修复与准入

已实施保存原子替换、缓存失败隔离、自动保存身份/恢复dirty、无覆盖导入、归档路径保护、上传会话授权、精确带声裁剪、包内FFmpeg、两平台版本/图标、Windows离线运行时准备及GPL v3。GPT-6.1-Sol 已执行隔离验证和 macOS 候选构建，在最终汇总前因额度中断；主代理核对落盘证据，纠正一条验证命令并补充运行。执行者、结果及限制详见 [发布验证状态](Release_Readiness_Status.md)。

当前原生构建、公开源码与 Git 追溯已完成，macOS ad-hoc 自签名方案已由用户确认。待完成的运行范围为 macOS 下载后的首次打开与出声，以及 Windows 在 CrossOver 中的启动和操作；真实 Windows 未做时须明确标注。第三方对应源码/版权材料仍须补齐。无需用户安装开发环境的要求保持不变。
