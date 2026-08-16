# AGENTS.md — 给协作 AI 的仓库说明

## 这是什么

Vision Bridge：为纯文本 AI 模型提供外挂视觉的零依赖工具。核心是一个 Node CLI
（`vision-bridge.js`），把图片交给任意 OpenAI 兼容视觉端点，返回完整文本转写。

## 仓库布局

- `vision-bridge.js` — 唯一核心代码（零依赖 CLI：读图 → base64 → 视觉 API → 文本）
- `vision_bridge.example.json` — 配置模板；真实配置名为 `vision_bridge.json`，**永不提交**
- `INSTALL.md` — 面向 AI 的自主安装手册（安装类任务的权威入口）
- `skills/vision-bridge/` — skill 形态：`SKILL.md` 定义触发规则，`scripts/` 是启动器
- `src/` — DeepSeek Harness 动态插件形态：`dsh-host.js`（vision_read 工具 + 图片落盘 RPC）、`dsh-client.js`（粘贴拦截 + 选图按钮）
- `README.md` / `README.zh-CN.md` — 面向人类与 AI 的总体介绍

## 开发约定

1. **零依赖是硬约束**：CLI 只用 Node 内置模块（fs / path / fetch / child_process）。
2. **纯 JavaScript**：动态插件两半是函数体字符串，无 import / TypeScript / JSX。
3. **base64 必须按字节**：不要用把字符串当 UTF-8 的 btoa（详见 src/README.md 的已知坑）。
4. 修改 CLI 后必须 `node vision-bridge.js --doctor` 通过，并用一张真实图片回归。
5. `vision_bridge.json`、`images/`、任何真实图片与 key 一律不进 git。

## 测试

```bash
node vision-bridge.js --doctor                      # 配置体检
node vision-bridge.js <一张测试图> --out /tmp/o.txt  # 端到端读图
```

## 已知边界

- Windows 优先（curl/node 为系统工具）；macOS/Linux 直连同样可用，代理路径需系统 curl
- 转写文本按不可信输入处理
- GLM-4V-Flash 单次输出上限 1024 tokens；更长转写换付费模型（改配置 model 字段）
