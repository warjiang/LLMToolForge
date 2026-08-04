# 总结旁展示 HTML 报告入口

## Goal

让用户关闭 HTML 报告预览或重新打开历史会话后，仍能从该轮最终文字总结旁快速再次打开报告。

## Requirements

- 在同一用户轮次的最后一条有效 assistant 文字总结旁展示 HTML 报告入口。
- 入口文案为“打开报告”，点击后复用现有 artifact 预览注册与打开流程。
- 从该轮成功的 HTML artifact 工具调用中派生报告，不依赖模型在正文中生成 URL。
- 支持 `html_artifact_create`、`html_artifact_block`、`data_report_html` 以及通过 `write` 生成的 HTML。
- 同一报告被多个 block 工具调用重复返回时，按实际产物路径去重。
- 历史会话从持久化的消息和工具调用记录中重新派生入口，不增加数据库字段或迁移。

## Acceptance Criteria

- [ ] 当前轮生成一份 HTML 报告后，最终文字总结旁展示可点击的“打开报告”入口。
- [ ] 点击入口可在内置预览中打开对应报告。
- [ ] 关闭预览后可通过该入口再次打开。
- [ ] 重新进入历史会话后入口仍然存在并可打开。
- [ ] 同一 `outputDir` 的多次 `html_artifact_block` 调用只展示一个入口。
- [ ] 同一轮生成多份不同报告时分别展示入口。
- [ ] 失败的工具调用、非 HTML 媒体和没有最终文字总结的轮次不展示入口。
- [ ] 现有工具历史中的 artifact 打开入口保持不变。

## Out Of Scope

- 不把临时 localhost URL 写入 Markdown 正文。
- 不修改 artifact 文件格式、预览服务或数据库结构。
- 不调整 Agent 提示词来依赖模型主动输出链接。
