# muxboard 端到端测试

在真实的飞书环境里运行 `muxboard`，检查看板记录、工作群和群消息是否符合设计文档（`docs/task-board-design.md`）。

**副作用**：每次运行都会在看板里新建记录、新建若干工作群，并在群里发消息。测试数据不清理。飞书没有解散群的命令，需要时手动解散。

## 目录

| 目录 | 覆盖范围 |
| --- | --- |
| `root-task/` | 根任务生命周期：`init`、`show`、`start`、`status`、`output` |
| `subtask-workchat/` | 子任务与工作群：`add`、`children`，自动建群、群名、群描述、二级建群、拉人进群 |
| `assign-notify/` | 分派与汇报：`assign`、`start`、`status` 的状态流转和群消息 |
| `errors/` | 所有错误码和退出码 |

每个目录里，`cases.md` 是用例（编号、场景、步骤、预期），`run.sh` 是对应的脚本，脚本里的用例编号与 `cases.md` 一致。公共函数在 `lib.sh`。

## 前置条件

- 本机已安装 `node`、`jq`、`lark-cli`。
- `lark-cli` 已配置一个 bot 应用，这个 bot：
  - 是看板的可编辑成员；
  - 在来源群里；
  - 有建群、查群成员、发消息的权限。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `E2E_APP_ID` | 是 | 执行测试的 bot 的 app_id，必须与 `lark-cli` 当前配置的应用一致 |
| `E2E_SOURCE_CHAT` | 是 | 当作"人派发任务的群"的群 ID |
| `E2E_ASSIGNEE` | 否 | 分派目标 bot 的 app_id，默认等于 `E2E_APP_ID`。设成其他 bot 会真的唤醒它 |
| `E2E_DISPATCHER` | 否 | 派发人的 open_id（属于 `E2E_APP_ID` 的应用）。不设时跳过派发人相关检查 |

脚本会自动模拟 botmux 注入的 `BOTMUX_LARK_APP_ID`、`BOTMUX_CHAT_ID`、`BOTMUX_OWNER_OPEN_ID`。

## 运行

```bash
export E2E_APP_ID=cli_aad984231e385cc5
export E2E_SOURCE_CHAT=oc_xxx      # 来源群 ID
export E2E_DISPATCHER=ou_xxx       # 派发人 open_id，可不设

e2e-test/run-all.sh                 # 全部
e2e-test/run-all.sh errors          # 只跑某个目录
bash e2e-test/root-task/run.sh      # 直接跑单个目录
```

每个用例输出 `✔`（通过）、`✘`（失败，附期望值、实际值和最近一次输出）或 `-`（跳过）。全部通过时退出码为 0。
