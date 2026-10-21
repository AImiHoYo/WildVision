# WildVision 前端维护说明

2026-10-16 界面收尾整理。

## 文件职责

- `ui/src/App.tsx`：桌面 API 调用、业务状态、播放与标注命令、页面组合。不在这里维护重复的行为条目或工具栏按钮模板。
- `ui/src/components/studio/`：工作台的行为检查器、播放工具栏、区间列表、时间轴及顶部操作。
- `ui/src/components/dataset/`：数据集卡片与导入管理界面。
- `ui/src/components/evaluation/`：质检、动作识别和语言定位界面。
- `ui/src/components/ui/`：跨区域共用的 Tabs、分段筛选和可拖动分隔器。
- `ui/src/lib/`：类名合并和键盘焦点等无业务含义的工具。
- `ui/src/styles/theme.css`：全局颜色变量和字体声明。
- `ui/src/styles/workspace.css`：工作台的容器、留白、标题、输入与工具栏样式。
- `ui/src/index.css`：全局入口、Tailwind、基础焦点与减少动态效果规则。
- `ui/public/fonts/`：本地字体、来源说明与许可证。构建后随桌面应用发布。

## 视觉与业务边界

全局采用 Azure Pro 的白／冷灰底色与蓝色主色。语义颜色通过 Tailwind 配置映射到 CSS 变量。由于站内完整主题 CSS 导出需要登录，本次没有声称完整复制全部主题 Token；已采用页面公开的主要配色、Inter 和 JetBrains Mono，以及原项目已有的中性文字颜色。

Inter 用于界面文字，中文使用系统回退；JetBrains Mono 用于时间、帧号和快捷键。本地 WOFF2 保证这些字体无需运行时访问字体服务。字体包版本及许可见 `ui/public/fonts/README.md`。

行为色仍由 `types.ts` 中的 `getActionColor` 决定，卡片、区间徽标与时间轴片段统一调用它。不能把不同类别全部涂成主题蓝色。质检与 AI 图表的语义配色独立保留。

区间列表使用两行结构，避免侧栏中名称、数字和按钮争抢同一行。视频按 contain 显示。分隔线继续调整左右宽度、时间轴高度、右侧上下高度；窄屏上下布局的高度与桌面侧栏宽度分别保存。

## 运行与交付

常规开发：在 `ui/` 执行 `npm run dev`。普通浏览器没有原生桌面桥接时只能展示空入口，不能据此声称桌面业务已验证。

前端构建：在 `ui/` 执行 `npm run build`，生成 `ui/dist/`。开发版桌面从项目根目录执行 `.venv/bin/python desktop_main.py`。

`release/WildVision.app` 内嵌独立前端文件。仅修改源码或重建 `ui/dist/` 不会自动更新已有 `.app`。现有 `build_desktop_app.py` 会重建并替换 release 中的应用；运行前需确认旧版本已妥善保留。本次新版应用单独输出，不覆盖已有 release。

## 本次检查方式

真实 Python BackendAPI + 构建后的前端，在 127.0.0.1 的验收预览中联调。使用复制的 sample_dataset，新增、修改、保存等操作只作用于测试副本。预览桥接脚本放在本次聊天的 work 目录，没有接入生产 bridge.ts，也没有开放到外网。

2026-10-17 已补充真正 macOS WKWebView 应用验收。`bridge.ts` 等待具体 API 方法就绪，避免冷启动时 API 对象已出现而 `get_state` 尚未注册的竞态。`lib/playback.ts` 将播放定位限制到已加载视频时长；它不改动标注区间和帧换算规则。

在 `ui/` 执行 `node --test tests/bridge.test.cjs tests/playback.test.cjs`，覆盖桥接就绪、超时与调用次数，以及播放定位的两端边界；无需增加测试依赖。

最终测试结果、实际窗口尺寸与打包验证见本次交付的验收记录；本说明本身不替代运行证据。
