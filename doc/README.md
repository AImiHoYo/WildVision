# 文档入口

当前前端目录、职责和维护方式见 [UI_Maintenance.md](architecture/UI_Maintenance.md)。最终验收范围与限制见 [UI_Acceptance_2026-10-16.md](architecture/UI_Acceptance_2026-10-16.md)。这是本次界面整理后的实现说明；旧视觉提案不代表当前页面已经采用的规则。

- `architecture/`：当前实现与维护指南。
- `data_specs/`：数据契约、预处理 JSON、多动物轨道及数据集存储协议。
- [组合轨道规则](Pair_Track_Annotations.md)：一个动物—行为组合一条可见轨道，重复时段与旧格式兼容说明。
- [悬停名称与中文对照](Label_Translations.md)：离线索引、译名来源和待核对条目的维护方法。
- `release/`：GitHub 发布清单、详细验证规程、GPT-6.1-Sol 执行交接。入口见 [GitHub_PreRelease_Checklist.md](release/GitHub_PreRelease_Checklist.md)。

课程材料、历史开发计划与提示词、本机验证原始证据保留本地，不默认提交 Git。范围见 [Repository_Publication_Audit.md](release/Repository_Publication_Audit.md)；普通用户双平台验收见 [Beginner_Desktop_Release_Requirements.md](release/Beginner_Desktop_Release_Requirements.md)。

数据格式和评测定义仍以数据契约、真实解析代码及测试为准。界面主题迭代不改变它们。
