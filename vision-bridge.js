#!/usr/bin/env node
/**
 * Vision Bridge — 零依赖图片转写 CLI
 *
 * 把一张图片交给任意 OpenAI 兼容视觉端点，输出完整文本转写，
 * 供纯文本 AI 模型"读图"。仅使用 Node 内置模块。
 *
 * 用法:
 *   node vision-bridge.js <图片路径|URL> [--question "问题"] [--config 路径] [--out 文件] [--timeout ms] [--json]
 *   node vision-bridge.js --doctor
 *   node vision-bridge.js --help
 *
 * 退出码: 0 成功 / 1 配置或输入错误 / 2 视觉引擎 API 错误
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const VERSION = '1.0.0'
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_TOKENS = 1024
const EXT_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

// ---------- 小工具 ----------

function fail(message, code) {
  console.error('vision-bridge: ' + message)
  process.exit(code)
}

function sniffMediaType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return undefined
}

function maskKey(key) {
  if (typeof key !== 'string' || key.length < 8) return key ? '****' : ''
  return key.slice(0, 4) + '…' + key.slice(-4)
}

function isUrl(value) {
  return /^https?:\/\//i.test(value)
}

function parseArgs(argv) {
  const args = { positional: [], question: '', config: undefined, out: undefined, timeoutMs: 120000, doctor: false, json: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--doctor') args.doctor = true
    else if (a === '--help' || a === '-h') args.help = true
    else if (a === '--json') args.json = true
    else if (a === '--question' || a === '--prompt') args.question = argv[++i] ?? ''
    else if (a === '--config') args.config = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--timeout') { const t = Number(argv[++i]); if (Number.isFinite(t) && t > 0) args.timeoutMs = t }
    else if (a.startsWith('-')) { /* 忽略未知 flag，宽容处理 */ }
    else args.positional.push(a)
  }
  return args
}

function helpText() {
  return [
    'Vision Bridge v' + VERSION + ' — 为纯文本 AI 提供读图能力的零依赖 CLI',
    '',
    '用法:',
    '  node vision-bridge.js <图片路径|URL> [选项]',
    '  node vision-bridge.js --doctor      # 体检',
    '',
    '选项:',
    '  --question <文本>   定向提问（引擎先答问题再全文转写）',
    '  --config <路径>     指定配置文件（默认依次找 ./vision_bridge.json、~/vision_bridge.json、$VISION_BRIDGE_CONFIG）',
    '  --out <文件>        同时把转写文本写入文件',
    '  --timeout <ms>      请求超时（默认 120000）',
    '  --json              以 JSON 输出结果',
    '  --help              显示本帮助',
    '',
    '退出码: 0 成功 / 1 配置或输入错误 / 2 视觉引擎 API 错误',
  ].join('\n')
}

// ---------- 配置 ----------

function loadConfig(explicitPath) {
  const candidates = []
  if (explicitPath) candidates.push(explicitPath)
  if (process.env.VISION_BRIDGE_CONFIG) candidates.push(process.env.VISION_BRIDGE_CONFIG)
  candidates.push(path.join(process.cwd(), 'vision_bridge.json'))
  candidates.push(path.join(os.homedir(), 'vision_bridge.json'))
  let file = undefined
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) { file = candidate; break }
  }
  if (file === undefined) {
    return { file, cfg: undefined, error: 'config missing: 在 CLI 同目录或用户主目录放好 vision_bridge.json（可从 vision_bridge.example.json 复制）' }
  }
  let cfg
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return { file, cfg: undefined, error: 'config invalid JSON: ' + error.message }
  }
  if (!cfg || typeof cfg !== 'object') return { file, cfg: undefined, error: 'config must be a JSON object' }
  if (typeof cfg.baseUrl !== 'string' || cfg.baseUrl === '') return { file, cfg, error: 'config.baseUrl 缺失' }
  if (typeof cfg.model !== 'string' || cfg.model === '') return { file, cfg, error: 'config.model 缺失' }
  if (typeof cfg.apiKey !== 'string' || cfg.apiKey.trim() === '' || cfg.apiKey.includes('YOUR_')) return { file, cfg, error: 'config.apiKey 缺失（填写你的视觉引擎 API key）' }
  return { file, cfg, error: undefined }
}

// ---------- HTTP：直连 fetch / 代理 curl ----------

async function apiRequest(cfg, payload, timeoutMs) {
  const endpoint = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions'
  if (cfg.proxy && String(cfg.proxy).trim() !== '') {
    return apiRequestViaCurl(endpoint, cfg, payload, timeoutMs)
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })
  let parsed = null
  try { parsed = await response.json() } catch (_error) { /* 非 JSON 响应 */ }
  if (response.status < 200 || response.status >= 300) {
    const detail = parsed && parsed.error ? JSON.stringify(parsed.error).slice(0, 500) : ('HTTP ' + response.status)
    const err = new Error('vision engine error: ' + detail)
    err.code = 2
    throw err
  }
  return parsed
}

function apiRequestViaCurl(endpoint, cfg, payload, timeoutMs) {
  const binary = process.platform === 'win32' ? 'curl.exe' : 'curl'
  const proxy = String(cfg.proxy).trim()
  const body = JSON.stringify(payload)
  const result = spawnSync(binary, [
    '-sS', '--max-time', String(Math.max(1, Math.round(timeoutMs / 1000))),
    '-X', 'POST', endpoint,
    '-H', 'Content-Type: application/json',
    '-H', 'Authorization: Bearer ' + cfg.apiKey,
    '-x', proxy,
    '--data-binary', '@-',
  ], { input: body, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.error) {
    const err = new Error('curl failed: ' + result.error.message)
    err.code = 2
    throw err
  }
  if (result.status !== 0) {
    const err = new Error('curl exited ' + result.status + ': ' + String(result.stderr || '').slice(0, 500))
    err.code = 2
    throw err
  }
  let parsed = null
  try { parsed = JSON.parse(result.stdout) } catch (_error) {
    const err = new Error('vision engine returned non-JSON: ' + String(result.stdout || '').slice(0, 300))
    err.code = 2
    throw err
  }
  if (parsed && parsed.error) {
    const err = new Error('vision engine error: ' + JSON.stringify(parsed.error).slice(0, 500))
    err.code = 2
    throw err
  }
  return parsed
}

// ---------- 读图 ----------

async function readImageBytes(source, cfg, timeoutMs) {
  if (isUrl(source)) {
    if (cfg && cfg.proxy && String(cfg.proxy).trim() !== '') {
      const binary = process.platform === 'win32' ? 'curl.exe' : 'curl'
      const result = spawnSync(binary, ['-sS', '--max-time', '60', '-x', String(cfg.proxy).trim(), source], { encoding: 'buffer', maxBuffer: MAX_IMAGE_BYTES + 1024 })
      if (result.error || result.status !== 0) fail('cannot download ' + source, 1)
      return new Uint8Array(result.stdout)
    }
    const response = await fetch(source, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) fail('download failed: HTTP ' + response.status + ' for ' + source, 1)
    return new Uint8Array(await response.arrayBuffer())
  }
  const resolved = path.resolve(source)
  if (!fs.existsSync(resolved)) fail('file not found: ' + resolved, 1)
  return new Uint8Array(fs.readFileSync(resolved))
}

// ---------- 体检 ----------

async function doctor(explicitConfigPath) {
  console.log('Vision Bridge v' + VERSION + ' — doctor')
  console.log('node: ' + process.version + (typeof fetch === 'function' ? ' (fetch OK)' : ' (fetch MISSING — need Node >= 18)'))
  const { file, cfg, error } = loadConfig(explicitConfigPath)
  if (file) console.log('config: ' + file)
  else console.log('config: missing')
  if (error) { console.log('apiKey: unknown'); console.log('endpoint: unknown'); console.log('ERROR: ' + error); process.exit(1) }
  console.log('baseUrl: ' + cfg.baseUrl)
  console.log('model: ' + cfg.model)
  console.log('apiKey: present (' + maskKey(cfg.apiKey) + ')')
  console.log('proxy: ' + (cfg.proxy ? cfg.proxy : '(direct)'))
  const endpoint = cfg.baseUrl.replace(/\/+$/, '') + '/models'
  let reachable = false
  try {
    if (cfg.proxy && String(cfg.proxy).trim() !== '') {
      const binary = process.platform === 'win32' ? 'curl.exe' : 'curl'
      const result = spawnSync(binary, ['-sS', '-m', '15', '-o', 'NUL', '-w', '%{http_code}', '-x', String(cfg.proxy).trim(), endpoint], { encoding: 'utf8' })
      reachable = result.status === 0 && /\d{3}/.test(String(result.stdout || ''))
    } else {
      const response = await fetch(endpoint, { method: 'GET', signal: AbortSignal.timeout(15000) })
      reachable = true // 任何 HTTP 响应都说明 TCP+TLS 可达
      console.log('endpoint: reachable (HTTP ' + response.status + ')')
    }
  } catch (_error) {
    reachable = false
  }
  if (!reachable) console.log('endpoint: unreachable')
  if (reachable && !error) { console.log('doctor: OK'); return }
  console.log('doctor: FAILED')
  process.exit(1)
}

// ---------- 主流程 ----------

async function runOne(source, args, cfg) {
  const bytes = await readImageBytes(source, cfg, args.timeoutMs)
  if (bytes.length === 0) fail('empty image: ' + source, 1)
  if (bytes.length > MAX_IMAGE_BYTES) fail('image too large: ' + bytes.length + ' bytes (> 8MB)', 1)
  let mediaType = EXT_MIME[path.extname(source).toLowerCase()]
  if (!mediaType) mediaType = sniffMediaType(bytes)
  if (!mediaType) fail('unsupported image format: ' + source + '（支持 PNG/JPEG/WebP/GIF/BMP）', 1)
  const base64 = Buffer.from(bytes).toString('base64')
  const question = String(args.question || '').trim()
  const prompt = question !== ''
    ? 'A text-only AI agent asks about this image: "' + question + '". Answer that question precisely and concretely first, then provide the complete transcription below.'
    : 'You are a vision bridge for a text-only AI agent. Transcribe this image completely and concretely: 1) all visible text verbatim in reading order (OCR); 2) layout regions and their positions; 3) visual elements (UI components, buttons, colors, charts with axes, labels and values); 4) overall semantics. Do not summarize away details; state uncertainties explicitly. Output plain text (Markdown allowed).'
  const payload = {
    model: cfg.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + base64 } },
      ],
    }],
    max_tokens: typeof cfg.maxTokens === 'number' && cfg.maxTokens > 0 ? cfg.maxTokens : DEFAULT_MAX_TOKENS,
  }
  const parsed = await apiRequest(cfg, payload, args.timeoutMs)
  const content = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content
  if (typeof content !== 'string' || content.length === 0) {
    const err = new Error('vision engine returned no text content: ' + JSON.stringify(parsed).slice(0, 300))
    err.code = 2
    throw err
  }
  return content
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { console.log(helpText()); return }
  if (args.doctor) { await doctor(args.config); return }
  if (args.positional.length === 0) { console.log(helpText()); process.exit(1) }
  const { cfg, error } = loadConfig(args.config)
  if (error) fail(error, 1)
  try {
    const parts = []
    for (const source of args.positional) {
      parts.push({ source, content: await runOne(source, args, cfg) })
    }
    const combined = parts.map((p) => (parts.length > 1 ? '## ' + p.source + '\n\n' : '') + p.content).join('\n\n')
    if (args.out) fs.writeFileSync(path.resolve(args.out), combined, 'utf8')
    if (args.json) {
      console.log(JSON.stringify({ ok: true, results: parts.map((p) => ({ source: p.source, content: p.content })) }))
    } else {
      console.log(combined)
    }
  } catch (error) {
    console.error('vision-bridge: ' + String(error && error.message ? error.message : error))
    process.exit(typeof error.code === 'number' ? error.code : 2)
  }
}

main()
