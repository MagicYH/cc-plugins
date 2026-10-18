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
