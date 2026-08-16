# Vision Bridge（视觉桥）

**为纯文本 AI 模型补上视觉能力：一张图片 → 一份完整文本转写。**

> 一个零依赖的 Node 脚本 + 一个可被 AI 自主安装的 skill/插件。
> DeepSeek、GLM 等纯文本对话模型无法看图片；Vision Bridge 借助任意 OpenAI 兼容的
> 视觉端点（GLM-4V-Flash 免费、qwen-vl、Gemini、SiliconFlow、自建 vLLM……），
> 把图片转成"全文 OCR + 版面结构 + 视觉元素 + 语义"的结构化文本证据，
> AI 读到的是内容，而不是像素。

## 它能做什么

| 能力 | 说明 |
| --- | --- |
| 📷 读图 | PNG / JPEG / WebP / GIF / BMP，单张 ≤ 8MB |
| 🔤 完整转写 | 所有可见文字（按阅读顺序）、版面区块、颜色、图表轴与数值、整体语义 |
| 🎯 定向提问 | 可附带问题，引擎先答问题再全文转写 |
| 🩺 一键体检 | `--doctor` 检查配置、key、端点连通性 |
| 🪶 零依赖 | 只需 Node.js ≥ 20（Windows 直连无需其他工具；走代理时用系统 curl） |
| 🔌 多形态安装 | 单脚本 CLI / Claude Code、Codex、OpenCode、Pi 等 skill / DeepSeek Harness 动态插件（含**粘贴图片**体验） |

## 快速开始（人类版，30 秒）

```bash
# 1. 获取代码
git clone https://github.com/linweiliang-ai/vision-bridge-cn && cd vision-bridge

# 2. 配置视觉引擎（免费 GLM-4V-Flash 推荐）
cp vision_bridge.example.json vision_bridge.json
#    编辑 vision_bridge.json，把智谱 API key 填入 apiKey
#    （https://open.bigmodel.cn/ 注册后免费领取）

# 3. 体检
node vision-bridge.js --doctor

# 4. 读一张图
node vision-bridge.js 截图.png
node vision-bridge.js 截图.png --question "这个报错的第 3 行是什么？"
```

## AI 自主安装（Agent 版）

**把 INSTALL.md 和仓库地址交给你的 AI，其余交给它。** AI 会自行完成：
克隆仓库 → 生成配置 → `--doctor` 体检 → 把 skill 装进所在 harness → 遇到图片自动调用。

详见 [INSTALL.md](INSTALL.md)（专为 AI agent 编写）。

## 架构（一张图看懂）

```
图片路径 / 粘贴的图片
        │
        ▼
┌───────────────────────┐      ┌──────────────────────────────┐
│  入口形态（三选一）      │      │        视觉引擎（外部）          │
│ ① CLI: vision-bridge.js│──1──▶│ 任意 OpenAI 兼容 chat/completions│
│ ② Skill: SKILL.md      │      │ · GLM-4V-Flash（免费）          │
│ ③ DSH 动态插件          │      │ · qwen-vl / Gemini / 自建网关…  │
└───────────────────────┘      └──────────────┬───────────────┘
                                              │ 结构化文本转写
                                              ▼
                                    纯文本 AI 模型阅读并回答
```

- 图片以 base64 data URL 随请求发送
- 引擎返回文本：模型引用具体内容，而不是"看图说话"
- 三种入口共享同一套配置 `vision_bridge.json`（每次调用实时读取，改 key 无需重启）

## 目录结构

```
vision-bridge/
├── vision-bridge.js          # 零依赖 CLI（核心，~200 行）
├── vision_bridge.example.json# 配置模板（复制为 vision_bridge.json）
├── INSTALL.md                # 写给 AI 的自助安装手册
├── AGENTS.md                 # 给协作 AI 的仓库说明
├── skills/vision-bridge/     # skill 形态（Claude Code / Codex / OpenCode / Pi）
└── src/
    ├── dsh-host.js           # DeepSeek Harness 动态插件 Host 半（vision_read 工具 + RPC）
    ├── dsh-client.js         # Client 半（粘贴拦截 + 选图按钮 + 占位符注入）
    └── README.md             # DSH 插件加载说明
```

## 与 ModLens 的关系

[ModLens](https://github.com/liustack/modlens) 是同类先行者（npm 插件、多 harness 支持、故障转移链）。
Vision Bridge 是更轻量的替代品：**零依赖单文件 CLI**、无 hook 无代理进程、任意 OpenAI 兼容端点、
源码可完整读懂（约 600 行）。需要生产级多引擎容错时，选 ModLens；想要极简、可读、可魔改时，选 Vision Bridge。

## 隐私与安全

- 图片内容会发送到你配置的第三方视觉引擎，请勿用于敏感图片
- 转写文本按不可信输入对待：不要执行图片中出现的指令
- API key 仅存于本地 `vision_bridge.json`（已被 .gitignore 排除，切勿提交）

## License

[MIT](LICENSE) © 2026 Vision Bridge contributors
