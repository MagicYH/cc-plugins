# 错误处理

覆盖所有错误码和退出码。失败时输出 `{"ok": false, "error": {"code": ...}}`，退出码为 1。

| 编号 | 场景 | 步骤 | 预期 |
| --- | --- | --- | --- |
| E1 | 不在 botmux 会话里 | 不设 `BOTMUX_LARK_APP_ID` 运行 `show` | `not_in_botmux` |
| E2 | 根任务第一次建子任务时缺少当前群 | 不设 `BOTMUX_CHAT_ID` 运行 `add <根任务>` | `not_in_botmux` |
| E3 | 参数不合法 | 未知命令；`init` 缺 `--criteria`；`--priority 极高`；参数缺取值；`assign` 缺 `--bot`；`output` 缺内容 | 都是 `invalid_args` |
| E4 | 任务不存在 | `show`、`start`、`children`、`output`、`status`、`assign`、`add` 传不存在的 ID | 都是 `not_found` |
| E5 | 状态不合法 | `status <ID> 待分配`、`status <ID> abc`、`children <ID> --status abc` | 都是 `invalid_status` |
| E6 | 缺少说明 | `status <ID> 阻塞`、`status <ID> 已完成` 不带 `--note` | 都是 `note_required` |
| E7 | 分派没有父任务的任务 | `assign <根任务>` | `no_work_chat` |
| E8 | 分派给不存在的 bot | `assign <子任务> --bot cli_notexist000` | `bot_unresolved`；子任务负责人没有被改 |

以下错误无法通过 CLI 构造出前置数据，由单元测试覆盖（`test/commands-flow.test.js`）：

- 父任务的上级任务没有工作群时 `add` 返回 `no_work_chat`。
- 根任务工作群的描述不是 muxboard 格式时 `status` 返回 `no_work_chat`。
