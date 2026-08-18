// ============================================================
// Vision Bridge — DeepSeek Harness 常驻插件（Host 半）
//
// 这是 vision-bridge 的"永久安装"形态：作为标准 Cordis 插件包安装进
// profile 后，vision_read 工具在 Harness 每次启动时自动注册，无需每次
// 会话重新创建动态插件。
//
// 安装（详见 README.md）：
//   1. 把本目录复制到 <DSH_HOME>/profiles/web/node_modules/vision-bridge-dsh
//   2. 在 <DSH_HOME>/profiles/web/cordis.patch.yml 追加一行：
//        - id: vision-bridge-dsh
//          name: vision-bridge-dsh
//   3. 重启 Harness（dsh web）
//
// 与动态插件形态（src/dsh-host.js）的区别：
//   - 只注册 vision_read 工具（path / question 参数）
//   - 不含粘贴图片的 Client 半与 vision_save_image RPC
//     （粘贴体验属于动态插件形态 B，见仓库 src/README.md）
//   - apply() 全程 try/catch：任何错误只影响本工具注册，不会拖垮启动
// ============================================================

import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import os from 'node:os'
import path from 'node:path'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const name = 'vision-bridge-dsh'
export const inject = ['tools']
export const Config = z.object({})

function bytesToBase64(bytes) {
  let out = ''
  let i = 0
  const n = bytes.length
  while (i + 3 <= n) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)] + B64[((b1 & 15) << 2) | (b2 >> 6)] + B64[b2 & 63]
    i += 3
  }
  if (i < n) {
    const b0 = bytes[i]
    const b1 = i + 1 < n ? bytes[i + 1] : 0
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < n ? B64[(b1 & 15) << 2] : '='
    out += '='
  }
  return out
}

function sniffMediaType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
  return undefined
}

function mimeForPath(p) {
  const lower = String(p).toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  return undefined
}

// 配置查找顺序：$VISION_BRIDGE_CONFIG → 会话工作区 vision_bridge.json → 用户主目录
async function loadConfig(ctx) {
  const fs = ctx.get('fs')
  if (fs === undefined) throw new Error('host filesystem service is unavailable')
  const candidates = []
  if (typeof process !== 'undefined' && process.env && process.env.VISION_BRIDGE_CONFIG) {
    candidates.push(String(process.env.VISION_BRIDGE_CONFIG))
  }
  candidates.push('vision_bridge.json')
  candidates.push(path.join(os.homedir(), 'vision_bridge.json'))
  for (const candidate of candidates) {
    let target
    try {
      target = await fs.resolve(candidate)
    } catch (_error) {
      continue
    }
    const stat = await fs.stat(target)
    if (stat === undefined) continue
    let cfg
    try {
      cfg = JSON.parse(await fs.readText(target))
    } catch (_error) {
      continue
    }
    if (!cfg || typeof cfg !== 'object') continue
    if (typeof cfg.baseUrl !== 'string' || cfg.baseUrl === '') throw new Error('config.baseUrl is required (OpenAI-compatible endpoint base, e.g. https://open.bigmodel.cn/api/paas/v4)')
    if (typeof cfg.apiKey !== 'string' || cfg.apiKey.trim() === '' || cfg.apiKey.indexOf('YOUR_') >= 0) throw new Error('config.apiKey is required: put your vision API key into vision_bridge.json')
    if (typeof cfg.model !== 'string' || cfg.model === '') throw new Error('config.model is required, e.g. glm-4v-flash')
    return cfg
  }
  throw new Error('vision bridge config not found (looked in $VISION_BRIDGE_CONFIG, workspace vision_bridge.json, ~/vision_bridge.json). Copy vision_bridge.example.json and fill apiKey.')
}

async function postChatCompletion(ctx, cfg, payload, signal) {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) throw new Error('subprocess service is unavailable')
  const endpoint = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions'
  let exe
  try {
    exe = await subprocess.resolveExecutable('curl.exe', undefined, signal)
  } catch (error) {
    throw new Error('curl.exe not found: ' + error.message + ' (Windows 10/11 ships curl.exe in %SystemRoot%\\System32)')
  }
  const argv = [exe, '-sS', '--max-time', '120', '-X', 'POST', endpoint, '-H', 'Content-Type: application/json', '-H', 'Authorization: Bearer ' + cfg.apiKey]
  if (cfg.proxy && typeof cfg.proxy === 'string' && cfg.proxy.trim() !== '') {
    argv.push('-x', cfg.proxy.trim())
  }
  argv.push('--data-binary', '@-')
  const handle = subprocess.spawn({
    argv,
    cwd: '.',
    env: {},
    stdio: {
      stdin: { data: payload },
      stdout: { maxBytes: MAX_OUTPUT_BYTES },
      stderr: { maxBytes: 64 * 1024 },
    },
    graceMs: 5000,
    signal,
  })
  const outcome = await handle.done
  const out = handle.collected.stdout ? handle.collected.stdout.finalize() : { text: '' }
  const err = handle.collected.stderr ? handle.collected.stderr.finalize() : { text: '' }
  if (outcome.exitCode !== 0) {
    throw new Error('vision engine request failed (curl exit ' + outcome.exitCode + '): ' + String(err.text || '').slice(0, 2000))
  }
  let parsed
  try {
    parsed = JSON.parse(out.text)
  } catch (error) {
    throw new Error('vision engine returned non-JSON response: ' + String(out.text || '').slice(0, 1000))
  }
  if (parsed && parsed.error) {
    throw new Error('vision engine error: ' + JSON.stringify(parsed.error).slice(0, 2000))
  }
  const content = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('vision engine returned no text content: ' + JSON.stringify(parsed).slice(0, 1000))
  }
  return content
}

export function apply(ctx) {
  try {
    const fs = ctx.get('fs')
    const subprocess = ctx.get('subprocess')
    if (fs === undefined || subprocess === undefined) {
      console.error('[vision-bridge-dsh] fs/subprocess unavailable; vision_read not registered')
      return
    }

    ctx.tools.register(defineTool({
      name: 'vision_read',
      description: 'Read one image through the configured external vision engine and return a complete text transcription: all visible text verbatim in reading order, layout regions, visual elements (UI components, colors, charts with axes and labels), and overall semantics. Provide a file path (path). When the user\'s message contains [Image: <path>] placeholders (produced by pasting images), call this tool once per placeholder with path = <path>. Configuration lives in vision_bridge.json (workspace, home, or $VISION_BRIDGE_CONFIG).',
      parameters: {
        path: { type: 'string', required: true, description: 'Path to the image file to read (absolute, or relative to the session workspace).' },
        question: { type: 'string', description: 'Optional specific question about the image; the engine answers it first, then transcribes the whole image.' },
      },
      output: {
        schema: { type: 'string' },
        render(_args, value) {
          return [{ type: 'text', text: value }]
        },
      },
      timeoutMs: 120000,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const signal = exec && exec.signal ? exec.signal : undefined
        const cfg = await loadConfig(ctx)
        const p = typeof args.path === 'string' && args.path.trim() !== '' ? args.path.trim() : ''
        if (p === '') throw new Error('give a path to the image file')
        const target = await fs.resolve(p, { signal })
        const bytes = await fs.readBytes(target, signal, MAX_IMAGE_BYTES)
        if (bytes.length === 0) throw new Error('empty image: ' + p)
        let mediaType = mimeForPath(p)
        if (!mediaType) mediaType = sniffMediaType(bytes)
        if (!mediaType) throw new Error('unsupported image format: ' + p + ' (supported: PNG/JPEG/WebP/GIF/BMP)')
        const dataUrl = 'data:' + mediaType + ';base64,' + bytesToBase64(bytes)
        const question = typeof args.question === 'string' && args.question.trim() !== '' ? args.question.trim() : ''
        const prompt = question !== ''
          ? 'A text-only AI agent asks about this image: "' + question + '". Answer that question precisely and concretely first, then provide the complete transcription below.'
          : 'You are a vision bridge for a text-only AI agent. Transcribe this image completely and concretely: 1) all visible text verbatim in reading order (OCR); 2) layout regions and their positions; 3) visual elements (UI components, buttons, colors, charts with axes, labels and values); 4) overall semantics. Do not summarize away details; state uncertainties explicitly. Output plain text (Markdown allowed).'
        const payload = JSON.stringify({
          model: cfg.model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          }],
          max_tokens: typeof cfg.maxTokens === 'number' && cfg.maxTokens > 0 ? cfg.maxTokens : 1024,
        })
        return await postChatCompletion(ctx, cfg, payload, signal)
      },
    }))
    console.log('[vision-bridge-dsh] vision_read registered (permanent install)')
  } catch (error) {
    console.error('[vision-bridge-dsh] apply failed, tool not registered:', error && error.message ? error.message : error)
  }
}
