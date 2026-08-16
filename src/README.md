# Vision Bridge × DeepSeek Harness 动态插件

在 DSH Web GUI 会话中加载本插件后，纯文本模型获得：

- `vision_read` 工具（读路径 / 读粘贴附件）
- 输入框 🖼️ 选图按钮 + **Ctrl+V 粘贴图片**体验（占位符 `[Image: <路径>]` 进草稿）

## 前置条件

- Windows（本插件用系统 `curl.exe` / `node.exe`，`node.exe` 需在 PATH，Node ≥ 20）
- 会话具备动态 Cordis 插件工具（`cordis_define` / `cordis_run`）
- 会话批准策略允许客户端代码激活（client 半需要批准一次）
- 配置：把 `vision_bridge.example.json` 复制为**会话工作区根目录**下的 `vision_bridge.json` 并填好 `apiKey`

## 加载步骤

1. 用 `cordis_define` 创建插件：
   - `code.host` ← 本目录 `dsh-host.js` 全文
   - `code.client` ← 本目录 `dsh-client.js` 全文
2. `cordis_run` 激活；client 半出现批准请求时告知用户在界面上批准。
3. 激活后：用户 Ctrl+V 粘贴图片 → 草稿出现 `[Image: <路径>]` → 发送 →
   对每个占位符调用一次 `vision_read(path=<路径>)`。

> ⚠️ **重要：包是完整的不可变单元**。每次 `cordis_define` 更新版本时，
> **必须同时提供 `code.host` 与 `code.client` 两半全文**——只提供一半会整体替换
> 正在运行的包，把另一半直接停掉（症状：`vision_read` 工具消失，或粘贴报
> `host.call("vision_save_image") ... is not registered`）。本项目开发者已实际踩过此坑，
> 更新版本时务必两半一起发。

## 配置字段

`baseUrl`（OpenAI 兼容端点根地址）/ `apiKey` / `model` / `maxTokens`（GLM-4V-Flash 上限 1024）/
`proxy`（可选）/ `imagesDir`（粘贴图片落盘目录，默认会话工作区 `images\`）。

## 设计决策与已知坑（读代码前必看）

1. **自实现 base64**：Harness Host 的 `btoa` 按 UTF-8 文本编码（`Buffer.from(s,'utf8')`），
   会把二进制图片字节破坏——所以代码自带纯字节 base64 编解码器，不要换成 btoa。
2. **绕开 attachments 库**：harness 原生附件库用 sharp 校验，会拒绝浏览器 canvas
   导出的合法 PNG（字节头正确也报 INVALID_IMAGE）。粘贴链路改为经 `node.exe` 解码落盘。
3. **绕开 fs 写沙箱**：插件侧 `ctx.fs.writeText` 受 workspace-write 沙箱限制（写工作区外
   被拒）。base64 经子进程 **stdin** 交给 node（裸 `ctx.subprocess` 子进程不受 fs 沙箱约束），
   由 node 完成磁盘写入。
4. **粘贴链路**：浏览器剪贴板常携带 DIB/BMP 数据却声明为 PNG，客户端统一经 canvas
   重编码为 PNG 再上传；RPC 带字符校验和，传输损坏会显式报 `checksum mismatch`。
5. **平台边界**：本形态当前 Windows 优先；macOS/Linux 请使用 CLI 或 skill 形态。

## 清理

动态插件是会话级临时扩展；DSH 进程重启后需重新定义并运行。粘贴的 PNG 会累积在
`imagesDir`，可定期清理。
