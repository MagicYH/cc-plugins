# 任务看板技术设计

## 结论

用一个 CLI 工具 `muxboard` 封装飞书多维表格（bitable），作为多个 bot 协作的任务看板。看板有两个目的：

1. 给人一个友好的界面，能简单看出任务进展。
2. 给 bot 一个交换信息的地方。

核心规则：

- bot 只能通过 `muxboard` 访问看板，每条命令都按任务 ID 操作，没有列出整张表的命令。
- 消息里只传任务 ID 和查看命令，任务详情由 bot 自己用 `muxboard show` 去看板上读。
- 分派和状态汇报的消息由 `muxboard` 以执行命令的 bot 的身份发出；执行过程中的其他沟通，bot 直接在群里对话。
- 每个父任务有一个工作群，群里记着上级群的信息，汇报沿着群一级级往上走，根任务最终在人派发任务的群里汇报。
- 插件提供一个技能（skill），告诉 bot 什么时候用哪个命令。
- `muxboard` 底层调用 `lark-cli`，统一用 bot 身份，所有命令输出 JSON。

bot 之间 @ 的可行性已经验证（见第 7.2 节）。

## 1. 范围

- 只支持 Claude Code 的 bot。CLI 和技能都随 `botmux-extend` 插件分发。
- 做：任务的创建、查看、分派、状态更新、父子关系查询、建工作群、分派和状态变更时的消息。
- 不做：截止时间、独立日志表、写入方校验、重复创建检测、失败重试、产出附件（产出附件放到后续迭代）、Stop hook。

## 2. 表结构

数据表 `tblqY5Msqv9tDBWI`，所属 base `KpbybB1JPaWVtYsB6r8c4UZdnkg`。

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
| 工作群 | `fldnCfUCxW` | 群聊 | 只有父任务（有子任务的任务）才填，是它的子任务协作的群；叶子任务（没有下级任务）留空 |
| 准出标准 | `fldfuR0nmi` | 文本 | 任务完成的判断标准 |
| 当前进展 | `fldMc28yQk` | 文本 | 最近一次状态变更的说明，见第 6.3 节 |
| 产出 | `fldgNsHCoP` | 文本 | 暂保留为文本，后续改为附件 |
| 修改时间 | `fldZfhlB8N` | 修改时间 | 系统自动维护，用来发现长时间没有更新的任务 |
| 派发人 | `fldEuP2QPm` | 人员 | 只有根任务填，是派发任务的人；根任务完成时 @ 这个人 |

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

1. 人在群里（下文称"来源群"）@ 初始 bot 派发任务。
2. 初始 bot 执行 `muxboard init`，创建根任务记录：负责人是自己，状态为进行中，派发人写进"派发人"字段。

**子任务**

1. 父任务的 bot 用 `muxboard add` 创建子任务，状态为待分配。
2. 父任务第一次创建子任务时，CLI 新建一个工作群，并写入父任务的"工作群"字段。
3. 父任务的 bot 用 `muxboard assign` 把子任务分给某个 bot：CLI 写负责人，把目标 bot 拉进工作群，并在群里 @ 它。消息里只有任务 ID 和查看命令。
4. 目标 bot 执行 `muxboard show <任务ID>` 读取任务详情，再执行 `muxboard start <任务ID>`，状态改为进行中。
5. 执行过程中需要沟通时，父子 bot 直接在工作群里对话，不经过 CLI。

**完成与汇报**

1. 任务完成时，负责人 bot 执行 `muxboard status <任务ID> 已完成 --note ...`。
2. CLI 以这个 bot 的身份，在"上级群"里 @ 上级任务的 bot，消息里带任务 ID 和查看命令：
   - 子任务：上级群是父任务的工作群。
   - 根任务：上级群是来源群，@ 的是派发人。根任务没有子任务时不发消息，因为 bot 本来就在来源群里和人对话。
3. 父任务的 bot 收到消息后，自己用 `muxboard children <父任务ID>` 检查所有子任务的状态，再决定下一步：继续等、追加任务，或者确认完成后把父任务设为已完成。父任务设为已完成时，按第 2 步继续往上汇报。

**工作群**

- 每个父任务一个群：一组子任务对应一个新群，群名用"根任务标题 - 父任务标题"（父任务就是根任务时只用根任务标题）。
- 子任务自己再拆子任务时，它成为新的父任务，CLI 为它再建一个群。
- 建群的是父任务的 bot，所以它是群主，也天然在群里。
- **群里记着上级群**：建群时，CLI 把"任务 ID + 上级群 ID"写进群描述，并在群里发一条说明消息：

  ```
  本群是任务「用户系统」（recYYY）的工作群，上级群：oc_xxx。
  查看任务详情：muxboard show recYYY
  ```

  根任务工作群的上级群就是来源群。根任务第一次 `add` 时，还没有工作群，根任务的 bot 一定是在来源群的会话里执行的，所以 CLI 直接取当前群（`BOTMUX_CHAT_ID`）作为来源群，不需要额外存储。群描述上限 100 个字符，任务 ID 和群 ID 加起来约 60 个字符，放得下。
- **人进群**：建群时，CLI 只把上级群里的人拉进新群，不拉上级群里的 bot。bot 只在 `assign` 时按需拉进来。这样根任务派发人所在的来源群里的人，会一级级被带进所有下级工作群。用的是建群 bot 自己查到的群成员 open_id，不存在跨应用 ID 不一致的问题。单次最多拉 50 人。

**父任务的 bot 在工作群里没有之前的对话上下文**

botmux 按"群 + bot"区分会话。父任务的 bot 是在上一级的群里接到任务、做的拆分，它在新建的工作群里还没有会话：

- 子 bot 在工作群里回复或汇报时，botmux 会为父任务的 bot 在工作群里新开一个会话，这个会话不知道之前的计划。
- 解决办法：工作群的说明消息和群描述里有父任务 ID，汇报消息里也带任务 ID。父任务的 bot 被唤醒后，先用 `muxboard show` 和 `muxboard children` 从看板读回情况。
- 子 bot 是在工作群里接到任务的，它的整个执行过程都在同一个会话里，不受影响。

**依赖关系**

- 父任务等所有子任务完成后才能完成。
- 子任务之间的先后顺序（比如先后端、后前端）不在表里表达，由父任务的 bot 控制分派时机：前一个完成后再分派下一个。

## 6. CLI 设计

### 6.1 运行环境

| 依赖 | 来源 | 用途 |
| --- | --- | --- |
| `BOTMUX_LARK_APP_ID` | botmux 注入 | 当前 bot 的 app_id，用作负责人 |
| `BOTMUX_CHAT_ID` | botmux 注入 | 当前群 ID，根任务第一次 `add` 时作为来源群 |
| `lark-cli` | 本机已安装 | 读写看板、建群、查群成员、发消息，统一 `--as bot` |
| 配置文件 | 插件自带 | base token、table ID、字段 ID 映射 |

缺少环境变量时，所有命令返回错误 `not_in_botmux`。

### 6.2 命令

#### 命令总览

| 命令 | 作用 | 谁用 |
| --- | --- | --- |
| `muxboard init` | 创建根任务 | 收到人派发任务的初始 bot |
| `muxboard show <任务ID>` | 查看任务详情 | 所有 bot |
| `muxboard start <任务ID>` | 开始处理分派给自己的任务 | 被分派的 bot |
| `muxboard children <任务ID>` | 查看子任务列表 | 父任务的 bot |
| `muxboard add <父任务ID>` | 创建子任务，必要时建工作群 | 父任务的 bot |
| `muxboard assign <子任务ID>` | 把子任务分给某个 bot，在工作群里 @ 它 | 父任务的 bot |
| `muxboard status <任务ID> <状态>` | 更新状态；阻塞或完成时向上级群汇报 | 负责人 bot |
| `muxboard output <任务ID> <内容>` | 写入产出 | 负责人 bot |

#### `muxboard init`

创建根任务：负责人是当前 bot，状态为进行中。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--title <文本>` | 是 | 标题 |
| `--desc <文本>` | 是 | 描述，参考文档的链接写在这里 |
| `--criteria <文本>` | 是 | 准出标准 |
| `--priority <高\|中\|低>` | 否 | 优先级，默认"中" |
| `--from <open_id>` | 否 | 派发人的 open_id，写进"派发人"字段。bot 从收到的消息里取发送人的 open_id 传入；不传时用 botmux 注入的 `BOTMUX_OWNER_OPEN_ID` |

关于 `BOTMUX_OWNER_OPEN_ID`：它是这个 botmux 会话的发起人，在会话创建时就固定了，不一定是这一轮发消息的人。群里多人共用一个会话时，两者可能不同，所以优先由 bot 传入当前消息发送人的 open_id。

这个 open_id 属于根任务 bot 的应用。根任务完成时由同一个 bot 发汇报消息，所以可以直接用它 @ 派发人。

输出：`{"ok": true, "data": {"task_id": "recXXX"}}`

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

列出直接子任务。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--status <状态>` | 否 | 只看某个状态的子任务 |

输出：

```json
{
  "ok": true,
  "data": {
    "children": [
      {"task_id": "recZZZ", "title": "实现登录接口", "owner": "cli_xxx", "status": "进行中",
       "progress": "[10-17 15:30] 进行中：开始处理", "output": null, "updated_at": "2026-10-17T15:30:00.000+08:00"}
    ]
  }
}
```

错误：`not_found`。

#### `muxboard add <父任务ID>`

在父任务下创建一个子任务，状态为待分配。父任务还没有工作群时，先建群：

1. 群名按第 5 节规则生成。
2. 群描述写"任务 ID + 上级群 ID"。根任务的上级群是来源群；其他任务的上级群是它的父任务的工作群。
3. 把上级群里的人拉进新群。
4. 写入父任务的"工作群"字段。
5. 在群里发说明消息。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `<父任务ID>` | 是 | 父任务的 ID |
| `--title <文本>` | 是 | 标题 |
| `--desc <文本>` | 是 | 描述，参考文档的链接写在这里 |
| `--criteria <文本>` | 是 | 准出标准 |
| `--priority <高\|中\|低>` | 否 | 优先级，默认"中" |

输出：`{"ok": true, "data": {"task_id": "recZZZ", "chat_id": "oc_xxx", "chat_created": true}}`。`chat_created` 表示这次是否新建了群。

错误：`not_found`。

#### `muxboard assign <子任务ID>`

把子任务分给某个 bot：写负责人，把目标 bot 拉进父任务的工作群，并在群里 @ 它。状态保持待分配。同一个子任务可以重新分派给另一个 bot（改派），CLI 覆盖负责人。

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

错误：`not_found`；父任务没有工作群 → `no_work_chat`；拉群后在群成员里仍找不到目标 bot → `bot_unresolved`。

#### `muxboard status <任务ID> <状态>`

更新任务状态，并覆盖写入"当前进展"。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `<任务ID>` | 是 | 任务的 ID |
| `<状态>` | 是 | `进行中` / `阻塞` / `已完成` |
| `--note <文本>` | 阻塞、已完成时必填 | 写进"当前进展" |

改成阻塞或已完成后，CLI 以当前 bot 的身份在上级群里发消息：

| 任务 | 上级群 | @ 谁 |
| --- | --- | --- |
| 子任务 | 父任务的工作群 | 父任务的 bot |
| 有子任务的根任务 | 来源群（从根任务工作群的群描述里读） | 派发人（"派发人"字段）；字段为空时只发消息，不 @ 人 |
| 没有子任务的根任务 | 不发消息 | — |

消息示例：

```
@Jarvis 任务「实现登录接口」（recZZZ）已完成：接口已上线，测试通过
请执行 muxboard show recZZZ 查看结果，并用 muxboard children recYYY 检查所有子任务的状态
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
| `not_found` | 任务不存在 |
| `invalid_status` | 状态值不合法 |
| `note_required` | 改成阻塞或已完成时缺少 `--note` |
| `children_unfinished` | 还有未完成的子任务，不能设为已完成 |
| `no_work_chat` | 找不到发消息的工作群 |
| `bot_unresolved` | 在群成员里找不到目标 bot，无法 @ |
| `lark_error` | `lark-cli` 调用失败，`message` 里带原始错误 |
| `invalid_args` | 命令或参数不合法，比如缺少必填参数、优先级不是高/中/低 |

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
- 建群：`lark-cli im +chat-create`，用 `--bots` 拉 bot、`--users` 拉人、`--description` 写群描述。
- 读群描述：`lark-cli im chats get`。
- 查群成员：`lark-cli im +chat-members-list`，`bots` 和 `users` 分开返回。
- 发消息：`lark-cli im +messages-send`，@ 写成 `<at user_id="open_id">名称</at>`。
- `lark-cli base +record-list` / `+record-get` 默认把结果写成文件，放在当前工作目录。CLI 统一加 `--format json`，结果直接在输出里返回，不产生文件。
- 代码位置：`plugins/botmux-extend/`。Claude Code 会把插件的 `bin/` 目录自动加入 PATH，bot 直接执行 `muxboard` 即可。

**代码结构**（Node.js，无第三方依赖）：

| 路径 | 内容 |
| --- | --- |
| `bin/muxboard` | 入口 |
| `lib/cli.js` | 解析参数、检查环境变量、组装依赖、分发命令、输出 JSON |
| `lib/commands/*.js` | 8 个命令，每个导出 `run(args, ctx)` |
| `lib/board.js` | 看板读写：`getTask`、`listChildren`、`createTask`、`updateTask` |
| `lib/chat.js` | 群操作：`create`、`getDescription`、`listMembers`、`addBots`、`send` |
| `lib/lark.js` | 调用 `lark-cli`（自动加 `--as bot`），出错时抛 `lark_error` |
| `lib/workchat.js` | 工作群的群名、群描述格式、说明消息、@ 写法 |
| `lib/args.js`、`errors.js`、`constants.js`、`progress.js`、`context.js` | 参数解析、错误码、状态常量、当前进展格式、命令依赖的类型定义 |
| `config/board.json` | base token、table ID、字段 ID 映射 |
| `skills/task-board/SKILL.md` | bot 的工作约定 |
| `test/*.test.js` | 单元测试，`npm test` 运行 |

## 7. 技能、通知与身份

### 7.1 技能

插件提供一个 `task-board` 技能，内容是 bot 的工作约定：

- 收到包含任务 ID 的派发消息时，先执行 `muxboard show <任务ID>` 读取详情，再执行 `muxboard start <任务ID>`，按描述和准出标准开展工作。
- 在工作群里被唤醒、却不清楚上下文时，从群说明消息或收到的消息里找到任务 ID，用 `muxboard show`、`muxboard children` 从看板读回情况。
- 任务需要拆分时，用 `add` 建子任务、用 `assign` 分派。
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

- **为什么 lark-cli 合适**：`muxboard` 不需要在一个进程里同时使用多个 bot 的身份。每个 bot 在自己的 botmux 会话里执行 `muxboard`，botmux 会自动把这个会话里的 `lark-cli` 绑定到当前 bot 的应用（`src/core/lark-tool-binding.ts`）。所以"用完成任务的 bot 的身份发消息"天然成立。需要时也可以用 `lark-cli --profile` 切换应用。
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

**还没验证**：安装插件后，bot 只凭 `task-board` 技能（不靠人工给出的命令清单）自主走完流程。联调时插件还没安装，是在消息里给了 Beta `muxboard` 的绝对路径和要执行的命令。

## 9. 待确认

无。反向关联（子任务列表）已在网页端确认显示正常。
