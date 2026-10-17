# 分派与汇报

覆盖命令：`assign`、`start`、`status`，以及它们在群里发出的消息。分派目标默认是执行测试的 bot 自己（`E2E_ASSIGNEE`），所以 @ 的也是它自己。

| 编号 | 场景 | 步骤 | 预期 |
| --- | --- | --- | --- |
| A1 | 准备数据 | `init` 根任务，`add` 子任务 C、D | 成功；得到根任务工作群 W |
| A2 | 分派子任务 | `assign C --bot <分派目标>` | 成功，返回 `owner` 和 `message_id`；C 的负责人为分派目标，状态仍是待分配；W 里有 @ 消息"你有一个新任务，任务 ID：<C>" |
| A3 | 开始子任务 | `start C` | 状态改为进行中；当前进展为 `… 进行中：开始处理` |
| A4 | 二级拆分并分派 | `add C` 建孙任务 G，`assign G`，`start G` | 都成功；得到 C 的工作群 W2 |
| A5 | 有未完成下级时不能完成 | `status C 已完成 --note …` | 返回 `children_unfinished`；C 的状态仍是进行中 |
| A6 | 孙任务完成，向 C 汇报 | `status G 已完成 --note <说明>` | 成功，`notified` 为 true；W2 里有 @ 消息"任务「<G标题>」（<G>）已完成：<说明>" |
| A7 | 子任务完成，向根任务汇报 | `status C 已完成 --note <说明>` | 成功，`notified` 为 true；W 里有 @ 消息"任务「<C标题>」（<C>）已完成：<说明>" |
| A8 | 待分配的任务直接阻塞 | `assign D` 后不 start，`status D 阻塞 --note <原因>` | 成功，`notified` 为 true；W 里有 @ 消息"…（<D>）受阻：<原因>" |
| A9 | 阻塞后恢复并完成 | `status D 进行中`，`start D`，`status D 已完成 --note …` | 恢复进行中时 `notified` 为 false；`start` 不改状态；完成时 `notified` 为 true |
| A10 | 根任务完成，向来源群汇报 | `status <根任务> 已完成 --note <说明>` | 成功，`notified` 为 true；来源群里有消息"任务「<根任务标题>」（<根任务>）已完成：<说明>"；设置了派发人时这条消息 @ 了人 |
