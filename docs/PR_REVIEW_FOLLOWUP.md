# PR #5–#9 审阅意见处理

| PR | 意见 | 处理 |
| --- | --- | --- |
| #5 | 去除冻结进生图文字的模型/effort 宣称 | 接受，随 #4 引入 schema 3、独立图片参数；schema 2 的既有快照与重试语义保留 |
| #6 | API29 pending URI 删除疑点 | 未据推测改动。Android 10 MediaProvider 的 Downloads 单项分支已包含 pending 项，恢复集合查询也已有兼容。尚未进行 API29 设备验证 |
| #7 | 超分主流程管线概念偏重 | 接受，高级配置默认收起，保留明确入口与拼接选择 |
| #7 | 未选图时显示模板变量 | 接受，无真实图块时禁用实际拼接预览 |
| #7 | 日志 pending 无法复位、原 JSONL 难读 | 接受，先验证容器再设 pending，默认可读时间线，原始日志折叠 |
| #7 | 批选提示、长按时序与拖动角标 | 接受，跳转后收起动作、统一 420ms、排序角标实时更新 |
| #8 | 横屏键盘遮挡局部重绘 | 接受，按实际可用高度进入紧凑输入布局；真实 API35 IME 177px 可视区复验输入和提交均可见 |
| #8 | 桌面也匹配横屏工作区 | 有意保留。布局按可用空间组织，不仅对手机或 APK 生效 |
| #8 | 配置变化重建 Activity | 接受，增加 screenLayout 与 smallestScreenSize 的处理 |
| #9 | 调用协议文档跟随直连架构调整 | 接受，随 #4 更新新旧提示词、参数观测与显影说明 |

PR #7/#8 的修复独立提交并传播至后续堆叠；直连相关变化集中在 #4。没有合并 PR 或部署生产。

API29 分析依据：[AOSP Android 10 MediaProvider Downloads 查询分支](https://github.com/aosp-mirror/platform_packages_providers_mediaprovider/blob/android10-release/src/com/android/providers/media/MediaProvider.java#L3805-L3833)。源码结论不代表已覆盖厂商改动和真实设备故障。
