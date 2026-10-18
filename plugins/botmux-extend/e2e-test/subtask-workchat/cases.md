# 子任务与工作群

覆盖命令：`add`、`split`、`children`、`show`。根任务的子任务直接建在根群下；子任务要继续拆分时，先 `split` 新建工作群。

注意：`split` 会把上级群里的 bot 拉进新群。来源群里有其他 bot 时，它们会被拉进测试新建的群。

| 编号 | 场景 | 步骤 | 预期 |
| --- | --- | --- | --- |
| S1 | 在根任务下建子任务 | `init` 建根任务，再 `add <根任务>` | 成功，返回的 `chat_id` 是来源群（根群），不建群 |
| S2 | 再建一个子任务 | `add <根任务> --priority 低` | 成功，`chat_id` 仍是来源群 |
| S3 | 子任务的初始字段 | `show <子任务>` | 状态待分配，负责人为空，父任务是根任务，没有工作群；默认优先级"中"，传了 `--priority 低` 的为"低" |
| S4 | 列出子任务 | `children <根任务>`，加 `--status 待分配`、`--status 已完成` | 分别返回 2、2、0 条 |
| S5 | 子任务计数 | `show <根任务>` | `children.total` 为 2，`children.done` 为 0 |
| S6 | 子任务未 split 就建下级 | `add <子任务A>` | 返回 `no_work_chat` |
| S7 | split 子任务 | `split <子任务A>` | 成功，`chat_created` 为 true；子任务A 的工作群等于返回的 `chat_id`；群名为"<根任务标题> - 子任务A"；群描述为 `muxboard task=<子任务A> upper=<来源群>`；群里有说明消息 |
| S8 | split 拉入上级群的 bot | 对比来源群和新群的 bot | 来源群里的 bot 都在新群里 |
| S9 | split 拉入上级群的人 | 对比来源群和新群的人 | 来源群里的人（最多 50 个）都在新群里；来源群里没有人时跳过 |
| S10 | 重复 split | 再次 `split <子任务A>` | 成功，`chat_created` 为 false，`chat_id` 与 S7 相同 |
| S11 | split 后建下级 | `add <子任务A>` | 成功，返回的 `chat_id` 是 S7 新建的群 |
