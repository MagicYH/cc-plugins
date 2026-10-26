# 任务看板技术设计

## 结论

用一个 CLI 工具 `muxboard` 封装飞书多维表格（bitable），作为多个 bot 协作的任务看板。看板有两个目的：

1. 给人一个友好的界面，能简单看出任务进展。
2. 给 bot 一个交换信息的地方。

核心规则：

- bot 只能通过 `muxboard` 访问看板，每条命令都按任务 ID 操作，没有列出整张表的命令。
- 消息里只传任务 ID 和查看命令，任务详情由 bot 自己用 `muxboard show` 去看板上读。
- 分派和状态汇报的消息由 `muxboard` 以执行命令的 bot 的身份发出；执行过程中的其他沟通，bot 直接在群里对话。
- 根任务的群就是人派发任务的那个普通群；子任务要继续拆分时，用 `split` 为它新建工作群，把上级群里的人和 bot 拉进来。汇报沿着群一级级往上走，根任务最终在根任务的群里向人汇报。
- 插件提供一个技能（skill），告诉 bot 什么时候用哪个命令。
- `muxboard` 底层调用 `lark-cli`，统一用 bot 身份，所有命令输出 JSON。

bot 之间 @ 的可行性已经验证（见第 7.2 节）。

## 1. 范围

- 只支持 Claude Code 的 bot。CLI 和技能都随 `botmux-extend` 插件分发。
- 做：任务的创建、查看、分派、状态更新、父子关系查询、建工作群、分派和状态变更时的消息。
- 不做：截止时间、独立日志表、写入方校验、重复创建检测、失败重试、产出附件（产出附件放到后续迭代）、Stop hook。

## 2. 表结构

看板用哪张表记在用户配置 `~/.config/muxboard/board.json` 里（环境变量 `MUXBOARD_CONFIG` 可指定其他路径），内容是 base token、table ID、字段 ID 映射和表格链接。没有这个文件时，`muxboard init` 按插件自带的模板 `config/board.json` 新建一张表，见第 6.2 节「muxboard init」。下表的字段 ID 是本机现有看板（base `KpbybB1JPaWVtYsB6r8c4UZdnkg`，数据表 `tblqY5Msqv9tDBWI`）的，新建的表字段 ID 不同。

CLI 内部用字段 ID 读写，不用字段名。字段名可以改，ID 不变。

**任务 ID** 指飞书为每条记录生成的记录 ID（`rec` 开头，表格界面上不显示），CLI 的所有命令都用它定位任务。

| 字段名 | 字段 ID | 类型 | 说明 |
| --- | --- | --- | --- |
| 任务标题 | `fldDa07B7G` | 文本 | |
| 任务描述 | `fldW79g4H9` | 文本 | 任务内容；参考文档的链接也写在这里 |
| 任务状态 | `fldZTEiywf` | 单选 | 见第 3 节 |
| 优先级 | `fldLxu5DPC` | 单选 | 高 / 中 / 低 |
| 负责人 | `fldPKudYmh` | 文本 | 存 bot 的 app_id，如 `cli_xxx` |
| 父任务 | `fldhZR2aJp` | 关联（双向） | 指向父任务，飞书自动生成反向的子任务列表 |
| 工作群 | `fldnCfUCxW` | 群聊 | 这个任务的子任务协作的群。根任务是 `init` 所在的群；其他任务在 `split` 时新建；没有继续拆分的任务留空 |
| 准出标准 | `fldfuR0nmi` | 文本 | 任务完成的判断标准 |
| 当前进展 | `fldMc28yQk` | 文本 | 最近一次状态变更的说明，见第 6.3 节 |
| 产出 | `fldgNsHCoP` | 文本 | 暂保留为文本，后续改为附件 |
| 修改时间 | `fldZfhlB8N` | 修改时间 | 系统自动维护，用来发现长时间没有更新的任务 |
| 派发人 | `fldEuP2QPm` | 人员 | 只有根任务填，是派发任务的人；根任务完成时 @ 这个人 |
| 主机 | `fld7ju2EnA` | 文本 | 负责人 bot 最近一次操作该任务时所在的主机（`os.hostname()`），多 bot 跨主机协作时用来定位。`init`、`start`、`split`、`status`、`output` 写入；`add`、`assign` 由父任务的 bot 执行，不写 |
| 依赖 | `fldxiyUgLK` | 关联（单向，可多选） | 同一父任务下必须先完成的任务，`add --deps` 写入。依赖全部完成后才能 `assign` |

## 3. 任务状态

| 状态 | 含义 | 谁设置 |
| --- | --- | --- |
| 待分配 | 子任务已创建，还没有分给 bot，或已分派但对方还没开始 | 父任务的 bot（创建子任务时） |
| 进行中 | 负责人 bot 已开始处理 | 负责人 bot（收到任务后）；根任务创建时直接设为进行中 |
| 阻塞 | 缺少信息或依赖未完成，无法继续 | 负责人 bot |
| 已完成 | 已满足准出标准 | 负责人 bot |

流转方向：`待分配 → 进行中 → 已完成`。进行中可以切到阻塞，阻塞解除后用 `status 进行中` 回到进行中。

- 待分配的任务也可以直接设为阻塞：bot 拿到任务、还没开始就可能发现缺信息。
- `start` 只处理待分配的任务；对阻塞或已完成的任务执行 `start`，不改状态，直接返回成功。

- 分派（`muxboard assign`）只写负责人，不改状态。目标 bot 执行 `muxboard start` 后才变成进行中。这样派发消息没送到时，看板显示的仍是待分配，不会误报成进行中。
- 有未完成子任务的任务，不能设为已完成，CLI 会拒绝。

## 4. Bot 标识

- 负责人字段存 app_id（`cli_` 开头）。app_id 是应用的固定 ID，看板只用它标记谁来完成任务。
- CLI 从 botmux 注入的环境变量 `BOTMUX_LARK_APP_ID` 读取当前 bot 的 app_id，不需要 bot 自己传。
- 在群里 @ 某个 bot 时，CLI 用 `lark-cli im +chat-members-list` 查群成员。返回的 `bots` 列表里有每个 bot 的 `app_id`、名称和 `member_id`。`member_id` 就是这个 bot 在调用方应用下的 open_id，可以直接用来 @。
- 不读取 `~/.botmux/bots.json`，其中有各 bot 的密钥。

## 5. 协作流程

**根任务**

1. 人在一个普通群里（下文称"根群"）@ 初始 bot 派发任务。
2. 初始 bot 执行 `muxboard init`：CLI 先确认当前会话是普通群（不是单聊、不是话题群），然后创建根任务记录：负责人是自己，状态为进行中，派发人写进"派发人"字段，根群写进"工作群"字段。不新建群。

**子任务**

1. 父任务的 bot 用 `muxboard add` 创建子任务，状态为待分配。父任务必须已经有工作群：根任务的工作群就是根群；其他任务要先 `split`。
2. 父任务的 bot 用 `muxboard assign` 把子任务分给某个 bot：CLI 写负责人，把目标 bot 拉进父任务的工作群，并在群里 @ 它。消息里只有任务 ID 和查看命令。
3. 目标 bot 执行 `muxboard show <任务ID>` 读取任务详情，再执行 `muxboard start <任务ID>`，状态改为进行中。
4. 执行过程中需要沟通时，父子 bot 直接在工作群里对话，不经过 CLI。

**子任务继续拆分**

1. 子任务的 bot 发现任务需要再拆分时，执行 `muxboard split <任务ID>`，为这个任务新建工作群，把上级群里的人和 bot 都拉进来。
2. 之后按"子任务"一节的步骤，在新群里 `add`、`assign`。

**完成与汇报**

1. 任务完成时，负责人 bot 执行 `muxboard status <任务ID> 已完成 --note ...`。
2. CLI 以这个 bot 的身份发汇报消息，消息里带任务 ID 和查看命令：
   - 子任务：发到父任务的工作群，@ 父任务的 bot。
   - 根任务：发到根群，@ 派发人。
3. 父任务的 bot 收到消息后，自己用 `muxboard children <父任务ID>` 检查所有子任务的状态，再决定下一步：用 `muxboard children <父任务ID> --ready` 派发下一个可派发任务、继续等、追加任务，或者确认完成后把父任务设为已完成。父任务设为已完成时，按第 2 步继续往上汇报。

**工作群**

- 根任务的工作群就是根群，`init` 不建群，也不改根群的群名和群描述。
- 其他任务的工作群由 `split` 新建，群名用"根任务标题 - 该任务标题"。
- 建群的是执行 `split` 的 bot，所以它是群主，也天然在群里。
- **拉人和 bot**：`split` 把上级群（父任务的工作群）里的人和 bot 都拉进新群。人用于了解进展；bot 是当前参与协作的这组 bot，进群后才能被分派、被 @。用的是建群 bot 自己查到的群成员 ID，不存在跨应用 ID 不一致的问题。人单次最多拉 50 个。
- **群里记着上级群**：`split` 建群时，CLI 把"任务 ID + 上级群 ID"写进群描述，并在群里发一条说明消息：

  ```
  本群是任务「用户系统」（recYYY）的工作群，上级群：oc_xxx。
  查看任务详情：muxboard show recYYY
  ```

  群描述上限 100 个字符，任务 ID 和群 ID 加起来约 60 个字符，放得下。

**bot 在新群里没有之前的对话上下文**

botmux 按"群 + bot"区分会话。执行 `split` 的 bot 是在上级群里做的拆分，它在新建的工作群里还没有会话：

- 子 bot 在新群里回复或汇报时，botmux 会为它在新群里新开一个会话，这个会话不知道之前的计划。
- 解决办法：新群的说明消息和群描述里有任务 ID，汇报消息里也带任务 ID。bot 被唤醒后，先用 `muxboard show` 和 `muxboard children` 从看板读回情况。
- 根任务的子任务在根群里分派和汇报，根任务的 bot 一直在同一个群里，不受这个问题影响。

**依赖关系**

- 父任务等所有子任务完成后才能完成。
- 子任务之间的先后顺序（比如先总设计、后各模块）记在"依赖"字段里：`add --deps` 写入，`assign` 时检查依赖是否全部完成，没完成报 `deps_unfinished`。计划保存在看板上，父任务的 bot 换会话后用 `children --ready` 读回可派发的任务。
- 一个 bot 同一时间只处理一个任务：`assign` 时目标 bot 有占用中的任务就报 `bot_busy`。占用指负责人是该 bot、状态为待分配（已派发未开始）、进行中或阻塞，且这个任务没有子任务；有子任务的任务是在协调，不算占用。
- 已派发（有负责人）或不是待分配的子任务不能再 `assign`，报 `already_assigned`。需要改派时（比如负责 bot 失联），父任务的 bot 先用 `unassign` 收回，再重新 `assign`。

## 6. CLI 设计

### 6.1 运行环境

| 依赖 | 来源 | 用途 |
| --- | --- | --- |
| `BOTMUX_LARK_APP_ID` | botmux 注入 | 当前 bot 的 app_id，用作负责人 |
| `BOTMUX_CHAT_ID` | botmux 注入 | 当前群 ID，`init` 时作为根群 |
| `BOTMUX_CHAT_TYPE` | botmux 注入 | 当前会话类型（`group` / `p2p`），`init` 时为 `p2p` 直接拒绝 |
| `lark-cli` | 本机已安装 | 读写看板、建群、查群成员、发消息，统一 `--as bot` |
| 看板配置 | `~/.config/muxboard/board.json`，`MUXBOARD_CONFIG` 可覆盖 | base token、table ID、字段 ID 映射、表格链接。缺失时只有 `init` 能执行，其他命令返回 `board_not_initialized`；存在但缺少模板里的字段时，所有命令返回 `board_config_incomplete` |
| 表结构模板 | 插件自带 `config/board.json` | 新建看板时的字段名、类型和单选选项，不含 ID |

缺少环境变量时，所有命令返回错误 `not_in_botmux`。

### 6.2 命令

#### 命令总览

| 命令 | 作用 | 谁用 |
| --- | --- | --- |
| `muxboard init` | 创建根任务 | 收到人派发任务的初始 bot |
| `muxboard show <任务ID>` | 查看任务详情 | 所有 bot |
| `muxboard start <任务ID>` | 开始处理分派给自己的任务 | 被分派的 bot |
| `muxboard children <任务ID>` | 查看子任务列表和可派发的任务 | 父任务的 bot |
| `muxboard add <父任务ID>` | 创建子任务 | 父任务的 bot |
| `muxboard split <任务ID>` | 为要继续拆分的任务新建工作群，拉入上级群的人和 bot | 子任务的 bot |
| `muxboard assign <子任务ID>` | 把子任务分给某个 bot，在工作群里 @ 它 | 父任务的 bot |
| `muxboard unassign <子任务ID>` | 收回已分派的子任务：清空负责人、改回待分配，通知原负责 bot | 父任务的 bot |
| `muxboard status <任务ID> <状态>` | 更新状态；阻塞或完成时向上级群汇报 | 负责人 bot |
| `muxboard output <任务ID> <内容>` | 写入产出 | 负责人 bot |

#### `muxboard init`

创建根任务：负责人是当前 bot，状态为进行中，工作群是当前群（根群）。

当前会话必须是普通群：

1. `BOTMUX_CHAT_TYPE` 为 `p2p`（单聊）时拒绝。
2. 用 `lark-cli im chats get` 读当前群信息：`chat_mode` 必须是 `group`，`group_message_type` 不能是 `thread`（话题模式），否则拒绝。

不满足时返回 `not_group_chat`，不写看板。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--title <文本>` | 是 | 标题 |
| `--desc <文本>` | 是 | 描述，参考文档的链接写在这里 |
| `--criteria <文本>` | 是 | 准出标准 |
| `--priority <高\|中\|低>` | 否 | 优先级，默认"中" |
| `--from <open_id>` | 否 | 派发人的 open_id，写进"派发人"字段。bot 从收到的消息里取发送人的 open_id 传入；不传时用 botmux 注入的 `BOTMUX_OWNER_OPEN_ID` |

关于 `BOTMUX_OWNER_OPEN_ID`：它是这个 botmux 会话的发起人，在会话创建时就固定了，不一定是这一轮发消息的人。群里多人共用一个会话时，两者可能不同，所以优先由 bot 传入当前消息发送人的 open_id。

这个 open_id 属于根任务 bot 的应用。根任务完成时由同一个 bot 发汇报消息，所以可以直接用它 @ 派发人。

看板配置不存在时，确认是普通群后先新建看板：

1. 以 bot 身份按模板 `config/board.json` 新建多维表格和数据表（`base +base-create`，再用 `+field-create` 补建指向本表的"父任务"双向关联和"依赖"单向关联）。
2. 用 `+field-list` 按字段名读回字段 ID，用 `+base-get` 读表格链接。
3. 给会话发起人（`BOTMUX_OWNER_OPEN_ID`）加管理权限（`drive +member-add --perm full_access`）。
4. 把 base token、table ID、字段 ID 和链接写入看板配置，之后的命令都用这张表。

创建根任务后，在根群发一条消息，带上任务 ID 和看板链接。

输出：`{"ok": true, "data": {"task_id": "recXXX", "chat_id": "oc_xxx", "url": "https://.../base/xxx"}}`。`chat_id` 是根群，`url` 是看板链接（配置里没有链接时为 null，也不发消息）。

错误：缺少 `BOTMUX_CHAT_ID` → `not_in_botmux`；当前会话不是普通群 → `not_group_chat`。

#### `muxboard show <任务ID>`

查看任务详情。

输出：

```json
{
  "ok": true,
  "data": {
    "task_id": "recZZZ",
    "title": "实现登录接口",
    "desc": "……\n参考文档：https://xxx.feishu.cn/docx/...",
    "criteria": "接口通过联调测试",
    "priority": "中",
    "status": "进行中",
    "owner": "cli_xxx",
    "progress": "[10-17 15:30] 进行中：开始处理",
    "output": null,
    "work_chat": null,
    "dispatcher": null,
    "updated_at": "2026-10-17T15:30:00.000+08:00",
    "hostname": "mac-mini",
    "deps": ["recXXX"],
    "parent": {"task_id": "recYYY", "title": "用户系统", "owner": "cli_yyy", "status": "进行中"},
    "children": {"total": 0, "done": 0}
  }
}
```

错误：`not_found`。

#### `muxboard start <任务ID>`

开始处理任务：状态从待分配改为进行中，"当前进展"写"开始处理"。任务是其他状态（进行中、阻塞、已完成）时不做改动，直接返回成功并带上当前状态。

输出：`{"ok": true, "data": {"task_id": "recZZZ", "status": "进行中"}}`

错误：`not_found`。

#### `muxboard children <任务ID>`

列出直接子任务。`ready` 为 true 表示可以立即分派：状态为待分配、没有负责人、依赖全部已完成。排序：可派发的在前，再按优先级（高 → 中 → 低），最后按创建顺序。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--status <状态>` | 否 | 只看某个状态的子任务 |
| `--ready` | 否 | 只看可派发的子任务，不带取值 |

输出：

```json
{
  "ok": true,
  "data": {
    "children": [
      {"task_id": "recZZZ", "title": "实现登录接口", "priority": "中", "owner": "cli_xxx", "status": "进行中",
       "deps": ["recXXX"], "ready": false,
       "progress": "[10-17 15:30] 进行中：开始处理", "output": null, "updated_at": "2026-10-17T15:30:00.000+08:00", "hostname": "mac-mini"}
    ]
  }
}
```

错误：`not_found`。

#### `muxboard add <父任务ID>`

在父任务下创建一个子任务，状态为待分配。不建群：父任务必须已经有工作群（根任务的工作群是根群；其他任务先执行 `split`）。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `<父任务ID>` | 是 | 父任务的 ID |
| `--title <文本>` | 是 | 标题 |
| `--desc <文本>` | 是 | 描述，参考文档的链接写在这里 |
| `--criteria <文本>` | 是 | 准出标准 |
| `--priority <高\|中\|低>` | 否 | 优先级，默认"中" |
| `--deps <ID,ID>` | 否 | 依赖的任务 ID，逗号分隔，必须是同一父任务下的子任务 |

输出：`{"ok": true, "data": {"task_id": "recZZZ", "chat_id": "oc_xxx"}}`。`chat_id` 是父任务的工作群，子任务会在这个群里分派。

错误：`not_found`（父任务或依赖不存在）；父任务没有工作群 → `no_work_chat`（提示先执行 `split`）；依赖不是同一父任务的子任务 → `invalid_args`。

#### `muxboard split <任务ID>`

为要继续拆分的任务新建工作群：

1. 读父任务的工作群作为上级群。
2. 新建群：群名"根任务标题 - 该任务标题"，群描述写"任务 ID + 上级群 ID"，同时拉入上级群里的人（最多 50 个）。
3. 把上级群里的 bot（不含自己，建群的 bot 已在群里）拉进新群。
4. 写入这个任务的"工作群"字段。
5. 在新群里发说明消息。

任务已经有工作群时不重复建群，直接返回现有的群，`chat_created` 为 false。根任务的工作群就是根群，不能 `split`。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `<任务ID>` | 是 | 要继续拆分的任务 ID |

输出：`{"ok": true, "data": {"task_id": "recZZZ", "chat_id": "oc_xxx", "chat_created": true, "bots": ["cli_xxx"]}}`。`bots` 是拉进新群的 bot 的 app_id。

错误：`not_found`；对根任务执行 → `invalid_args`；父任务没有工作群 → `no_work_chat`。

#### `muxboard assign <子任务ID>`

把子任务分给某个 bot：写负责人，把目标 bot 拉进父任务的工作群，并在群里 @ 它。状态保持待分配。

拉人、写负责人之前依次检查，任一不满足就报错且不做任何改动：

1. 子任务是待分配且没有负责人，否则 `already_assigned`。需要改派时先用 `muxboard unassign` 收回。
2. 依赖全部已完成，否则 `deps_unfinished`，消息里列出未完成的依赖和状态。
3. 目标 bot 没有占用中的任务（口径见第 5 节"依赖关系"），否则 `bot_busy`，消息里列出占用的任务。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `<子任务ID>` | 是 | 子任务的 ID |
| `--bot <app_id>` | 是 | 目标 bot 的 app_id |

发出的消息：

```
@Beta 你有一个新任务，任务 ID：recZZZ
请执行 muxboard show recZZZ 查看任务详情，然后执行 muxboard start recZZZ 开始处理
```

输出：`{"ok": true, "data": {"task_id": "recZZZ", "owner": "cli_xxx", "message_id": "om_xxx"}}`

错误：`not_found`；父任务没有工作群 → `no_work_chat`；`already_assigned`；`deps_unfinished`；`bot_busy`；拉群后在群成员里仍找不到目标 bot → `bot_unresolved`。

#### `muxboard unassign <子任务ID>`

收回已分派的子任务，用于改派（比如负责 bot 失联、长时间无响应）：清空负责人，状态改回待分配，"当前进展"写入收回说明，并在父任务的工作群里通知原负责 bot 停止处理。"主机"字段保留，记录最后操作的主机。

写看板之前依次检查，任一不满足就报错且不做任何改动：

1. 子任务有父任务，否则 `no_work_chat`。
2. 当前 bot 是父任务的负责人，否则 `not_dispatcher`。只有派发方能收回。
3. 子任务不是已完成，否则 `task_done`。
4. 子任务有负责人，否则 `not_assigned`。待分配、进行中、阻塞都可以收回。
5. 父任务有工作群，否则 `no_work_chat`。

原负责 bot 已不在工作群里时照样收回，消息里不 @ 它。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `<子任务ID>` | 是 | 子任务的 ID |
| `--note <原因>` | 否 | 收回原因，写进"当前进展"和通知消息 |

发出的消息：

```
@Beta 任务「登录接口」（recZZZ）已收回，请停止处理，不要再更新它的状态
原因：超过 2 小时无响应
```

输出：`{"ok": true, "data": {"task_id": "recZZZ", "previous_owner": "cli_xxx", "status": "待分配", "message_id": "om_xxx"}}`

错误：`not_found`；`no_work_chat`；`not_dispatcher`；`task_done`；`not_assigned`。

#### `muxboard status <任务ID> <状态>`

更新任务状态，并覆盖写入"当前进展"。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `<任务ID>` | 是 | 任务的 ID |
| `<状态>` | 是 | `进行中` / `阻塞` / `已完成` |
| `--note <文本>` | 阻塞、已完成时必填 | 写进"当前进展" |

改成阻塞或已完成后，CLI 以当前 bot 的身份发汇报消息：

| 任务 | 发到哪个群 | @ 谁 |
| --- | --- | --- |
| 子任务 | 父任务的工作群 | 父任务的 bot |
| 根任务 | 根群（根任务的"工作群"字段） | 派发人（"派发人"字段）；字段为空时只发消息，不 @ 人 |

根任务没有工作群（`init` 改版之前创建的旧数据）时不发消息，`notified` 为 false。

消息示例：

```
@Jarvis 任务「实现登录接口」（recZZZ）已完成：接口已上线，测试通过
请执行 muxboard show recZZZ 查看结果，并用 muxboard children recYYY 检查所有子任务的状态，然后按调度规则派发下一个可派发任务（muxboard children recYYY --ready）
```

输出：`{"ok": true, "data": {"task_id": "recZZZ", "status": "已完成", "notified": true}}`

错误：`not_found`；状态不在上面三个之内 → `invalid_status`；缺少 `--note` → `note_required`；还有未完成的子任务时设为已完成 → `children_unfinished`；`bot_unresolved`。

#### `muxboard output <任务ID> <内容>`

覆盖写入任务的"产出"字段，比如 MR 链接、文档链接。

输出：`{"ok": true, "data": {"task_id": "recZZZ"}}`

错误：`not_found`。

#### 通用约定

- 成功：`{"ok": true, "data": {...}}`，退出码 0。
- 失败：`{"ok": false, "error": {"code": "...", "message": "..."}}`，退出码 1。
- 错误码汇总：

| 错误码 | 含义 |
| --- | --- |
| `not_in_botmux` | 缺少 botmux 注入的环境变量 |
| `board_not_initialized` | 看板配置不存在，需要先在普通群里执行 `init` |
| `board_config_incomplete` | 看板配置缺少插件模板里的字段（如旧配置没有「主机」「依赖」），消息列出缺失字段及补法：在看板表中按模板新建字段，把字段 ID 写入配置 |
| `not_found` | 任务不存在 |
| `invalid_status` | 状态值不合法 |
| `note_required` | 改成阻塞或已完成时缺少 `--note` |
| `children_unfinished` | 还有未完成的子任务，不能设为已完成 |
| `no_work_chat` | 找不到发消息的工作群 |
| `bot_unresolved` | 在群成员里找不到目标 bot，无法 @ |
| `already_assigned` | 子任务已派发或不是待分配，不能再 `assign` |
| `deps_unfinished` | 子任务的依赖还没全部完成，不能 `assign` |
| `bot_busy` | 目标 bot 正在处理其他任务，不能 `assign` |
| `not_dispatcher` | 当前 bot 不是父任务的负责人，不能 `unassign` |
| `task_done` | 子任务已完成，不能 `unassign` |
| `not_assigned` | 子任务没有负责人，不需要 `unassign` |
| `lark_error` | `lark-cli` 调用失败，`message` 里带原始错误 |
| `invalid_args` | 命令或参数不合法，比如缺少必填参数、优先级不是高/中/低、对根任务执行 `split` |
| `not_group_chat` | `init` 时当前会话不是普通群（单聊或话题群） |

### 6.3 "当前进展"字段

只存最近一次状态变更的一句话说明，每次覆盖写入，不追加。

- **写入时机**：只在 `init`、`start`（待分配 → 进行中时）、`status` 时由 CLI 自动写入，bot 不需要单独记得去更新进展。
- **格式**：`[时间] 状态：说明`。例如 `[10-17 15:30] 阻塞：缺少测试环境的数据库地址`。
- **说明的来源**：
  - `init`：固定写"创建任务"。派发人记在"派发人"字段，表格界面直接显示姓名。
  - `start`：固定写"开始处理"。
  - `status`：取 `--note`；改成进行中且没带 `--note` 时写"继续处理"。
- 历史记录在飞书的记录历史里可以查到，不需要维护日志。

### 6.4 实现

- 看板读写：`lark-cli base +record-list`、`+record-get`、`+record-upsert`。
- 新建看板：`lark-cli base +base-create`、`+table-list`、`+field-create`、`+field-list`、`+base-get`，授权用 `lark-cli drive +member-add`。
- 建群：`lark-cli im +chat-create`，用 `--users` 拉人、`--description` 写群描述。
- 拉 bot 入群：`lark-cli im chat.members create --member-id-type app_id`。
- 读群信息（判断是否普通群）：`lark-cli im chats get`。
- 查群成员：`lark-cli im +chat-members-list`，`bots` 和 `users` 分开返回。
- 发消息：`lark-cli im +messages-send`，@ 写成 `<at user_id="open_id">名称</at>`。
- `lark-cli base +record-list` / `+record-get` 默认把结果写成文件，放在当前工作目录。CLI 统一加 `--format json`，结果直接在输出里返回，不产生文件。
- 代码位置：`plugins/botmux-extend/`。Claude Code 会把插件的 `bin/` 目录自动加入 PATH，bot 直接执行 `muxboard` 即可。

**代码结构**（Node.js，无第三方依赖）：

| 路径 | 内容 |
| --- | --- |
| `bin/muxboard` | 入口 |
| `lib/cli.js` | 解析参数、检查环境变量、组装依赖、分发命令、输出 JSON |
| `lib/commands/*.js` | 10 个命令，每个导出 `run(args, ctx)` |
| `lib/board.js` | 看板读写：`getTask`、`listChildren`、`listByOwner`、`createTask`、`updateTask` |
| `lib/chat.js` | 群操作：`create`、`getInfo`、`listMembers`、`addBots`、`send` |
| `lib/lark.js` | 调用 `lark-cli`（自动加 `--as bot`，不经过 botmux 托管入口时再加 `--profile <BOTMUX_LARK_APP_ID>`），出错时抛 `lark_error` |
| `lib/workchat.js` | 工作群的群名、群描述格式、说明消息、@ 写法 |
| `lib/args.js`、`errors.js`、`constants.js`、`progress.js`、`context.js` | 参数解析、错误码、状态常量、当前进展格式、命令依赖的类型定义 |
| `lib/config.js` | 看板配置路径、读写，读取表结构模板，校验配置字段是否齐全 |
| `lib/provision.js` | 按模板新建看板并给会话发起人授权 |
| `config/board.json` | 表结构模板（字段名、类型、单选选项），不含 ID |
| `skills/task-board/SKILL.md` | bot 的工作约定 |
| `test/*.test.js` | 单元测试，`npm test` 运行 |

## 7. 技能、通知与身份

### 7.1 技能

插件提供一个 `task-board` 技能，内容是 bot 的工作约定：

- 收到包含任务 ID 的派发消息时，先执行 `muxboard show <任务ID>` 读取详情，再执行 `muxboard start <任务ID>`，按描述和准出标准开展工作。
- 在工作群里被唤醒、却不清楚上下文时，从群说明消息或收到的消息里找到任务 ID，用 `muxboard show`、`muxboard children` 从看板读回情况。
- 根任务需要拆分时，直接用 `add` 建子任务、用 `assign` 分派，子任务在根群里分派。
- 子任务还要继续拆分时，先 `split <自己的任务ID>` 建工作群，再 `add`、`assign`。
- 执行中需要沟通时，直接在工作群里回复对方。
- 受阻时执行 `status <任务ID> 阻塞 --note ...`。
- 完成前对照准出标准自查，用 `output` 写产出，再执行 `status <任务ID> 已完成 --note ...`。
- 收到子任务的完成消息时，用 `children` 检查所有子任务的状态，再决定继续等、追加任务，还是把自己的任务设为已完成。

### 7.2 通知

`muxboard` 以执行命令的 bot 的身份在群里发消息并 @ 目标 bot，示例见第 6.2 节。

**验证结果（2026-10-17）**

- Jarvis 建了测试群"muxboard 验证群"，用 `--bots` 拉入 Beta 和 Zero。
- `+chat-members-list` 返回了 3 个 bot 的 app_id 和 open_id。Beta 在这里的 open_id 和它自己应用下的 open_id 不同，确认 open_id 按应用区分，必须从群成员里查。
- Jarvis 用查到的 open_id @ Beta 后，Beta 的 botmux 会话被拉起，并按消息要求在群里回复了"收到"。bot 之间 @ 唤醒可行。
- 测试群保留到开发完成，用于后续联调。

### 7.3 身份

统一用 bot 身份（`--as bot`），由执行命令的 bot 自己的身份读写看板和发消息。

- **为什么 lark-cli 合适**：`muxboard` 不需要在一个进程里同时使用多个 bot 的身份。每个 bot 在自己的 botmux 会话里执行 `muxboard`，botmux 会自动把这个会话里的 `lark-cli` 绑定到当前 bot 的应用（`src/core/lark-tool-binding.ts`）。所以"用完成任务的 bot 的身份发消息"天然成立。
- **不经过托管入口时**：用 `MUXBOARD_LARK_BIN` 指定了其他 lark-cli，或会话里没有 `BOTMUX_LARK_TOOL_BINDING` 时，`lark.js` 每次调用加 `--profile <BOTMUX_LARK_APP_ID>`，按调用指定当前 bot，不修改 lark-cli 的全局默认 profile。对应 profile 不存在时直接报 `lark_error` 并提示用 `lark-cli profile add --name <app_id> --app-id <app_id> --app-secret-stdin` 添加，不回退到默认 profile，避免以别的 bot 的身份读写。
- **为什么不用 `--as user`**：botmux 里的用户凭据绑定在触发这一轮的真人身上。bot 被另一个 bot 唤醒时没有真人，拿不到用户凭据（`docs/adr/dispatch-user-delegation.md` 第 7 条）。
- **看板权限**：Jarvis（`cli_aad984231e385cc5`）、Beta（`cli_aa59a4113cf8dbf6`）、Zero（`cli_aa59a5723278dbfa`）三个 bot 都已加为看板的可编辑成员。Jarvis 已实测能写入，Beta 和 Zero 还没在真实会话里验证。
- **其他权限**：Jarvis 已能建群、查群成员、发消息。其他 bot 缺少的 im 权限，实现时按报错逐个申请。

## 8. 实施步骤

以下步骤已于 2026-10-17 完成。

1. 验证 bot 之间 @ 唤醒（见第 7.2 节）。
2. 实现全部 8 个命令、看板和群操作模块，单元测试 58 个全部通过。
3. 真实环境联调：以 Jarvis 身份，把测试群当来源群，依次执行 `init`、`add`（自动建群）、`assign`、`start`、`output`、`status`、`children`。结果：
   - 新工作群的群名、群描述（`muxboard task=<根任务ID> upper=<来源群ID>`）、说明消息正确。
   - 分派消息、子任务完成汇报发在工作群，@ 的是正确的 bot。
   - 根任务完成后，汇报发回来源群并 @ 了派发人。
   - `children_unfinished`、`note_required`、`not_found`、`invalid_status` 按预期返回。
   - 联调用的两条记录已删除；联调时建的工作群"muxboard 联调根任务"保留在飞书里。
4. 编写 `task-board` 技能。
5. 跨 bot 真实联调：Jarvis 创建根任务、建子任务并分派给 Beta。Beta 在自己的 botmux 会话里，用自己的身份执行 `show`、`start`、`output`、`status 已完成`，全部成功；CLI 以 Beta 的身份在工作群 @ Jarvis 汇报，Jarvis 的 botmux 会话被唤醒。联调记录已删除，工作群"muxboard Beta 联调"保留在飞书里。

6. 2026-10-18 改版：`init` 以当前普通群作为根群，不再建群；新增 `split` 为要继续拆分的子任务建群，并拉入上级群的人和 bot；`add` 不再建群。单元测试 65 个、端到端测试 135 项全部通过，其中包括 split 时把人拉进新群。

**还没验证**：安装插件后，bot 只凭 `task-board` 技能（不靠人工给出的命令清单）自主走完流程。联调时插件还没安装，是在消息里给了 Beta `muxboard` 的绝对路径和要执行的命令。

## 9. 待确认

无。反向关联（子任务列表）已在网页端确认显示正常。
