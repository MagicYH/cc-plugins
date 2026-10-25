# cc-plugins

Claude Code 插件市场。

## 目录结构

```
cc-plugins/
├── .claude-plugin/
│   └── marketplace.json        # 市场清单，列出所有插件
├── plugins/
│   └── <plugin-name>/          # 每个插件一个目录
│       ├── .claude-plugin/
│       │   └── plugin.json     # 插件元信息（必需）
│       ├── bin/                # 可执行文件，Claude Code 自动加入 PATH
│       ├── commands/           # 斜杠命令（*.md）
│       ├── agents/             # 子代理（*.md）
│       ├── skills/             # 技能（<skill-name>/SKILL.md）
│       ├── hooks/
│       │   └── hooks.json      # 钩子配置（只放配置，不放脚本）
│       ├── lib/
│       │   └── hooks/          # 钩子执行的脚本
│       └── README.md
└── README.md
```

## 钩子开发约定

- 钩子脚本放在 `lib/hooks/`，`hooks/hooks.json` 中通过 `${CLAUDE_PLUGIN_ROOT}/lib/hooks/<脚本>` 引用。
- 要把信息写入 Claude 的上下文，按事件选择输出方式：
  - Stop：退出码 0，stdout 输出 `{"decision":"block","reason":"..."}`，`reason` 会交给 Claude 并让它继续一轮；或退出码 2，提示写到 stderr。
  - SessionStart、UserPromptSubmit、PostToolUse 等：可用 `hookSpecificOutput.additionalContext`。Stop 事件不支持该字段。
  - 普通 stdout 文本只显示给用户，Claude 看不到。
- Stop 钩子必须检查输入中的 `stop_hook_active`：为 true 时说明本轮已被拦过一次，应直接放行，避免反复注入。

## 添加新插件

1. 复制 `plugins/botmux-extend` 为 `plugins/<新插件名>`
2. 修改其 `.claude-plugin/plugin.json` 中的 `name`、`description`
3. 在 `.claude-plugin/marketplace.json` 的 `plugins` 数组中添加一项，`source` 指向 `./plugins/<新插件名>`

## 使用方式

```
/plugin marketplace add MagicYH/cc-plugins
/plugin install botmux-extend@cc-plugins
```

### 安装 muxboard（botmux-extend 的命令行工具）

在 Claude Code 内装好插件即可直接用 `muxboard`；在 Claude Code 之外使用，需手动把它加入 PATH。无论哪种方式，都只能在 botmux 会话里运行。

1. 前置依赖
   - Node.js >= 20（`package.json` 的 `engines`），无第三方 npm 依赖，无需 `npm install`。
   - lark-cli：`npm install -g @larksuite/cli`，并完成 bot 身份配置（`lark-cli config init`），`lark-cli auth status` 中 `identities.bot.status` 应为 `ready`。muxboard 调用时固定加 `--as bot`；lark-cli 不在 PATH 时用 `MUXBOARD_LARK_BIN` 指定路径。
   - botmux 环境变量：必需 `BOTMUX_LARK_APP_ID`（缺失时报 `not_in_botmux`）；`init` 还需要 `BOTMUX_CHAT_ID`，并读取 `BOTMUX_CHAT_TYPE`、`BOTMUX_OWNER_OPEN_ID`。botmux 会话会自动注入这些变量。
2. 安装方式
   - Claude Code 内：插件安装后 `bin/` 自动加入 PATH，无需操作。
   - Claude Code 外（终端手动使用、其他 bot 等），任选其一：
     - 把插件的 `bin/` 加入 PATH：`export PATH="<插件目录>/bin:$PATH"`
     - 软链到已在 PATH 中的目录：`ln -s <插件目录>/bin/muxboard ~/.local/bin/muxboard`
     - 在插件目录执行 `npm link`（按 `package.json` 的 `bin` 字段注册全局命令）

     `<插件目录>` 为本仓库的 `plugins/botmux-extend`，或 Claude Code 的安装缓存 `~/.claude/plugins/cache/cc-plugins/botmux-extend/<版本>`（后者随版本升级变化，建议用前者）。
3. 验证
   - `muxboard help`（或不带参数）输出命令列表即安装成功。
   - 在 botmux 会话外执行其他命令会返回 `not_in_botmux`，属正常。
4. 看板配置
   - 配置文件默认为 `~/.config/muxboard/board.json`，可用 `MUXBOARD_CONFIG` 指定其他路径。
   - 首次在普通群（非单聊、非话题群）执行 `muxboard init` 时，若配置不存在，会按插件自带模板新建多维表格，给会话发起人授权并写入配置；其他命令在配置缺失时报 `board_not_initialized`。
