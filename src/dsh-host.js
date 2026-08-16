// ============================================================
// Vision Bridge — DeepSeek Harness 动态插件 · Host 半
// 用法：把本文件【全文】作为 cordis_define 的 code.host 传入。
// 依赖：ctx.get('fs')、ctx.get('subprocess')（宿主组合已提供）
// 提供：vision_read 模型工具 + vision_save_image RPC（供 Client 粘贴图片）
// 注意：纯 JavaScript 函数体，无 import/require；Windows 优先（node.exe 需在 PATH）
// ============================================================

const CONFIG_PATH = 'vision_bridge.json'           // 会话工作区根目录下的配置（模板见 vision_bridge.example.json）
const DEFAULT_IMAGES_DIR = 'images'                // 粘贴图片落盘目录（相对工作区；可在配置 imagesDir 覆盖）
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const MAX_B64_CHARS = 16 * 1024 * 1024
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

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

function base64ToBytes(base64) {
  const clean = String(base64).replace(/[^A-Za-z0-9+/=]/g, '')
  if (clean.length % 4 !== 0) throw new Error('bad base64 length')
  const out = []
  let buffer = 0
  let bits = 0
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (ch === '=') break
    const v = B64.indexOf(ch)
    if (v < 0) throw new Error('bad base64 character')
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

function checkSum(text) {
  let sum = 0
  for (let i = 0; i < text.length; i++) sum = (sum + text.charCodeAt(i)) % 0x3fffffff
  return sum
}

function hexOf(bytes, from, count) {
  const parts = []
  const start = from < 0 ? Math.max(0, bytes.length + from) : from
  const limit = Math.min(start + count, bytes.length)
  for (let i = start; i < limit; i++) parts.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16))
  return parts.join(' ')
}

function sniffMediaType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mediaType: 'image/png', ext: 'png' }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mediaType: 'image/jpeg', ext: 'jpg' }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return { mediaType: 'image/gif', ext: 'gif' }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { mediaType: 'image/webp', ext: 'webp' }
  return undefined
}

function mimeForPath(path) {
  const lower = String(path).toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  throw new Error('unsupported image extension in ' + path + '; supported: .png .jpg .jpeg .webp .gif .bmp')
}

async function loadConfig(ctx) {
  const fs = ctx.get('fs')
  if (fs === undefined) throw new Error('host filesystem service is unavailable')
  let target
  try {
    target = await fs.resolve(CONFIG_PATH)
  } catch (error) {
    throw new Error('cannot resolve config path ' + CONFIG_PATH + ': ' + error.message)
  }
  const stat = await fs.stat(target)
  if (stat === undefined) {
    throw new Error('vision bridge config not found at ' + CONFIG_PATH + '. Copy vision_bridge.example.json to vision_bridge.json in the session workspace and fill apiKey.')
  }
  let cfg
  try {
    cfg = JSON.parse(await fs.readText(target))
  } catch (error) {
    throw new Error('invalid JSON in ' + CONFIG_PATH + ': ' + error.message)
  }
  if (!cfg || typeof cfg !== 'object') throw new Error('config must be a JSON object')
  if (!cfg.baseUrl || typeof cfg.baseUrl !== 'string') throw new Error('config.baseUrl is required (OpenAI-compatible endpoint base, e.g. https://open.bigmodel.cn/api/paas/v4)')
  if (!cfg.apiKey || typeof cfg.apiKey !== 'string' || cfg.apiKey.trim() === '' || cfg.apiKey.indexOf('YOUR_') >= 0) throw new Error('config.apiKey is required: put your vision API key into ' + CONFIG_PATH)
  if (!cfg.model || typeof cfg.model !== 'string') throw new Error('config.model is required, e.g. glm-4v-flash')
  return cfg
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

return {
  apply(ctx) {
    const fs = ctx.get('fs')
    const subprocess = ctx.get('subprocess')
    if (fs === undefined || subprocess === undefined) return
    const registry = new Map()

    async function resolveImageBytes(args, exec) {
      const signal = exec && exec.signal ? exec.signal : undefined
      const hasPath = typeof args.path === 'string' && args.path.trim() !== ''
      const hasAttach = typeof args.attachmentId === 'string' && args.attachmentId.trim() !== ''
      if (hasPath && hasAttach) throw new Error('give either path or attachmentId, not both')
      if (hasAttach) {
        const ref = registry.get(args.attachmentId.trim())
        if (ref === undefined) throw new Error('attachment ' + args.attachmentId + ' is not available in this session')
        return { bytes: ref.bytes, mediaType: ref.mediaType }
      }
      if (hasPath) {
        const target = await fs.resolve(args.path, { signal })
        const bytes = await fs.readBytes(target, signal, MAX_IMAGE_BYTES)
        return { bytes, mediaType: mimeForPath(args.path) }
      }
      throw new Error('give either path or attachmentId')
    }

    harness.handle('vision_save_image', async (args) => {
      if (args === null || typeof args !== 'object') throw new Error('bad arguments')
      const base64 = args.base64
      if (typeof base64 !== 'string' || base64.length === 0) throw new Error('missing base64 payload')
      if (base64.length > MAX_B64_CHARS) throw new Error('image too large (base64 ' + base64.length + ' chars)')
      let bytes
      try {
        bytes = base64ToBytes(base64)
      } catch (error) {
        throw new Error('invalid base64 payload: ' + error.message)
      }
      if (bytes.length === 0) throw new Error('empty image')
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image too large (' + bytes.length + ' bytes)')
      const sniff = sniffMediaType(bytes)
      if (sniff === undefined) throw new Error('not a supported image format (head=' + hexOf(bytes, 0, 16) + ')')
      const declaredSum = args.checkSum
      const receivedSum = checkSum(base64)
      if (typeof declaredSum === 'number' && declaredSum !== receivedSum) {
        throw new Error('transport checksum mismatch: client sent ' + declaredSum + ', host computed ' + receivedSum + ' (base64 length ' + base64.length + ')')
      }
      const cfg = await loadConfig(ctx)
      const imagesDir = typeof cfg.imagesDir === 'string' && cfg.imagesDir.trim() !== '' ? cfg.imagesDir.trim() : DEFAULT_IMAGES_DIR
      const head16 = hexOf(bytes, 0, 16)
      const tail16 = hexOf(bytes, -16, 16)
      const stamp = Date.now()
      const outName = 'paste-' + stamp + '.' + sniff.ext
      const outPath = imagesDir + '\\' + outName
      let nodePath
      try {
        nodePath = await subprocess.resolveExecutable('node.exe')
      } catch (error) {
        throw new Error('node.exe not found: ' + error.message + ' (install Node.js >= 20)')
      }
      // 经 node 解码并落盘：绕开 harness 附件库（sharp 拒绝 canvas PNG）与插件侧 fs 写沙箱
      const script = "const fs=require('fs');const path=require('path');const chunks=[];process.stdin.on('data',function(c){chunks.push(c)});process.stdin.on('end',function(){var b=Buffer.concat(chunks).toString('utf8').replace(/\\s+/g,'');fs.mkdirSync(path.dirname(process.argv[1]),{recursive:true});fs.writeFileSync(process.argv[1],Buffer.from(b,'base64'))})"
      const handle = subprocess.spawn({
        argv: [nodePath, '-e', script, outPath],
        cwd: '.',
        env: {},
        stdio: {
          stdin: { data: base64 },
          stdout: { maxBytes: 64 * 1024 },
          stderr: { maxBytes: 64 * 1024 },
        },
        graceMs: 5000,
      })
      const outcome = await handle.done
      const stderr = handle.collected.stderr ? handle.collected.stderr.finalize() : { text: '' }
      if (outcome.exitCode !== 0) throw new Error('node decode failed (exit ' + outcome.exitCode + '): ' + String(stderr.text || '').slice(0, 1000))
      const stat = await fs.stat(await fs.resolve(outPath))
      if (stat === undefined || typeof stat.size !== 'number' || stat.size !== bytes.length) {
        throw new Error('decoded file size mismatch: expected ' + bytes.length + ', got ' + (stat === undefined ? 'none' : String(stat.size)))
      }
      registry.set(outPath, { bytes, mediaType: sniff.mediaType })
      console.log('vision bridge: saved ' + outPath + ' bytes=' + bytes.length + ' type=' + sniff.mediaType + ' head=' + head16 + ' tail=' + tail16)
      return { ok: true, path: outPath, mediaType: sniff.mediaType, bytes: bytes.length, head: head16, tail: tail16 }
    })

    harness.registerTool(ctx, harness.defineTool({
      name: 'vision_read',
      description: 'Read one image through the configured external vision engine and return a complete text transcription: all visible text verbatim in reading order, layout regions, visual elements (UI components, colors, charts with axes and labels), and overall semantics. Provide either a file path (path) or a pasted-image attachment id (attachmentId). When the user\'s message contains [Image: <path>] placeholders (produced by pasting images into the composer), call this tool once per placeholder with path = <path>. Configuration lives in the session workspace vision_bridge.json.',
      parameters: {
        path: { type: 'string', description: 'Path to the image file to read (absolute, or relative to the session workspace). Mutually exclusive with attachmentId.' },
        attachmentId: { type: 'string', description: 'Attachment id from an [Image: <id>] placeholder in the user message (pasted image). Mutually exclusive with path.' },
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
        const resolved = await resolveImageBytes(args, exec)
        const dataUrl = 'data:' + resolved.mediaType + ';base64,' + bytesToBase64(resolved.bytes)
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
  },
}
