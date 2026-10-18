# 错误处理

覆盖所有错误码和退出码。失败时输出 `{"ok": false, "error": {"code": ...}}`，退出码为 1。

| 编号 | 场景 | 步骤 | 预期 |
| --- | --- | --- | --- |
| E1 | 不在 botmux 会话里 | 不设 `BOTMUX_LARK_APP_ID` 运行 `show` | `not_in_botmux` |
| E2 | 不在普通群里创建根任务 | 不设 `BOTMUX_CHAT_ID` 运行 `init`；会话类型为 `p2p` 时运行 `init` | 分别为 `not_in_botmux`、`not_group_chat` |
| E3 | 参数不合法 | 未知命令；`init` 缺 `--criteria`；`--priority 极高`；参数缺取值；`assign` 缺 `--bot`；`output` 缺内容；`split` 根任务 | 都是 `invalid_args` |
| E4 | 任务不存在 | `show`、`start`、`children`、`output`、`status`、`assign`、`add`、`split` 传不存在的 ID | 都是 `not_found` |
| E5 | 状态不合法 | `status <ID> 待分配`、`status <ID> abc`、`children <ID> --status abc` | 都是 `invalid_status` |
| E6 | 缺少说明 | `status <ID> 阻塞`、`status <ID> 已完成` 不带 `--note` | 都是 `note_required` |
| E7 | 分派没有父任务的任务 | `assign <根任务>` | `no_work_chat` |
| E8 | 分派给不存在的 bot | `assign <子任务> --bot cli_notexist000` | `bot_unresolved`；子任务负责人没有被改 |

以下错误无法通过 CLI 构造出前置数据，由单元测试覆盖：

- 话题群、话题模式群里 `init` 返回 `not_group_chat`（需要真实的话题群；`test/commands-basic.test.js`）。
- 父任务没有工作群时 `split` 返回 `no_work_chat`（`init` 总会写入根群，CLI 造不出这种数据；`test/commands-flow.test.js`）。
- 子任务没有 split 时 `add` 返回 `no_work_chat` 由 `subtask-workchat/` 的 S6 覆盖。
