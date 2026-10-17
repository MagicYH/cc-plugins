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
│       │   └── hooks.json      # 钩子配置
│       └── README.md
└── README.md
```

## 添加新插件

1. 复制 `plugins/botmux-extend` 为 `plugins/<新插件名>`
2. 修改其 `.claude-plugin/plugin.json` 中的 `name`、`description`
3. 在 `.claude-plugin/marketplace.json` 的 `plugins` 数组中添加一项，`source` 指向 `./plugins/<新插件名>`

## 使用方式

```
/plugin marketplace add MagicYH/cc-plugins
/plugin install botmux-extend@cc-plugins
```
