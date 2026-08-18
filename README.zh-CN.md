# Vision Bridge（视觉桥）中文说明

**为纯文本 AI 模型补上视觉能力：一张图片 → 一份完整文本转写。**

一个零依赖的 Node 脚本 + 一个可被 AI 自主安装的 skill/插件。DeepSeek、GLM 等
纯文本对话模型无法看图片；Vision Bridge 借助任意 OpenAI 兼容的视觉端点
（GLM-4V-Flash 免费、qwen-vl、Gemini、SiliconFlow、自建 vLLM……），把图片转成
"全文 OCR + 版面结构 + 视觉元素 + 语义"的结构化文本证据，AI 读到的是内容而不是像素。

## 快速开始（30 秒）

```bash
git clone https://github.com/linweiliang-ai/vision-bridge-cn && cd vision-bridge
cp vision_bridge.example.json vision_bridge.json
# 编辑 vision_bridge.json，把 apiKey 填好（推荐智谱免费 key：https://open.bigmodel.cn/）
node vision-bridge.js --doctor      # 体检
node vision-bridge.js 截图.png      # 读图
node vision-bridge.js 截图.png --question "第 3 行的数字是多少？"   # 定向提问
```

## 推荐视觉引擎（本机网络实测，2025）

| 端点 | 直连 | 说明 |
| --- | --- | --- |
| 智谱 GLM（glm-4v-flash） | ✅ | 免费，推荐默认 |
| 阿里云 DashScope（qwen-vl） | ✅ | 付费 key |
| DeepSeek API | ✅ | 暂无视觉模型 |
| Google Gemini | ❌（需代理） | 配置 `proxy` 字段走本地代理 |

## AI 自主安装

把 [INSTALL.md](INSTALL.md) 和仓库地址交给你的 AI，其余交给它：克隆仓库 → 生成配置 →
`--doctor` 体检 → 把 skill 装进所在 harness → 遇到图片自动调用，全程无需人工控制。

## 永久安装（DeepSeek Harness）

动态插件随会话消失；需要 `vision_read` 工具**重启后仍在**时，按 `dsh-plugin/README.md`
安装为常驻插件（profile 一行配置 + 一次放置，之后每次启动自动生效）。

## 隐私与安全

图片会发送到你配置的第三方视觉引擎；转写文本按不可信输入对待；API key 切勿提交到仓库。

## License

[MIT](LICENSE) © 2026 Vision Bridge contributors
