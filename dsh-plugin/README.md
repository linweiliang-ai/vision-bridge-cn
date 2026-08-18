# Vision Bridge 常驻插件（dsh-plugin）

让 `vision_read` 工具在 DeepSeek Harness **每次启动时自动注册**，重启后依然存在。
这是与"动态插件（形态 B）"互补的**永久安装形态（形态 D）**。

## 特性

- ✅ 重启后仍在：安装一次，每次 `dsh web` 启动自动生效
- ✅ 零配置安装：无 `pnpm` / npm 依赖安装（纯手工放置包目录）
- ✅ 安全降级：`apply()` 全程 try/catch，任何错误只影响本工具注册，不会拖垮启动
- ⚠️ 只含 Host 半（`vision_read` 工具，`path` / `question` 参数）
- ⚠️ 不含粘贴图片的 Client 半（🖼️ 按钮 / Ctrl+V 拦截属于动态插件形态 B，见 `../src/README.md`）

## 安装步骤

1. **放置包目录**（把本目录整个复制为 `vision-bridge-dsh`）：

   ```powershell
   $dst = "$env:USERPROFILE\.dsh\profiles\web\node_modules\vision-bridge-dsh"
   New-Item -ItemType Directory -Path $dst -Force | Out-Null
   Copy-Item "$PWD\package.json", "$PWD\lib" $dst -Recurse -Force
   ```

   （若 DSH_HOME 不是 `C:\Users\<你>\.dsh`，把 `$env:USERPROFILE\.dsh` 换成你的 DSH_HOME。）

2. **登记插件行**：编辑 `<DSH_HOME>\profiles\web\cordis.patch.yml`，在数组末尾追加：

   ```yaml
   # Vision Bridge 常驻插件（vision_read 工具）
   - id: vision-bridge-dsh
     name: vision-bridge-dsh
   ```

3. **校验配置**（无需重启即可确认 patch 可组合）：

   ```powershell
   node "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile web --dump-config
   ```

   输出中应能看到 `vision-bridge-dsh` 行且无报错。

4. **重启 Harness**（关掉终端里 `dsh web` 进程重新运行，或用桌面快捷方式重新启动）。

5. **验证**：新会话里应出现 `vision_read` 工具（可在模型工具列表中看到）。

## 配置

与动态插件共用同一个配置文件，查找顺序：

1. 环境变量 `VISION_BRIDGE_CONFIG` 指向的路径
2. 会话工作区根目录 `vision_bridge.json`
3. 用户主目录 `vision_bridge.json`

字段同 `../vision_bridge.example.json`：`baseUrl` / `apiKey` / `model` / `maxTokens` / `proxy`。

## 卸载

1. 从 `cordis.patch.yml` 删除该行（或加 `disabled: true`）
2. 删除 `profiles\web\node_modules\vision-bridge-dsh` 目录
3. 重启

## 注意

- 在 profile 目录运行 `pnpm install` / `dsh plugin add` 可能会清掉手工放置的包，
  需要按第 1 步重新放置。
- 粘贴图片（Ctrl+V → `[Image: 路径]`）仍依赖动态插件形态 B；本常驻插件保证
  "读图能力"始终可用（直接给路径即可）。
