// ============================================================
// Vision Bridge — DeepSeek Harness 动态插件 · Client 半
// 用法：把本文件【全文】作为 cordis_define 的 code.client 传入。
// 提供：输入框 🖼️ 选图按钮 + 全局粘贴拦截（图片 → Host RPC → 占位符进草稿）
// 注意：纯 JavaScript 函数体（React.createElement，无 JSX/import）
// ============================================================

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

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

function checkSum(text) {
  let sum = 0
  for (let i = 0; i < text.length; i++) sum = (sum + text.charCodeAt(i)) % 0x3fffffff
  return sum
}

let bridge = null

function currentDraft() {
  if (bridge === null) return ''
  try {
    const input = bridge.useInput()
    return input !== null && typeof input === 'object' && typeof input.draft === 'string' ? input.draft : ''
  } catch (_error) {
    return ''
  }
}

function appendToDraft(text) {
  if (bridge === null || text === '') return
  const current = currentDraft()
  bridge.inputActions.setDraft(current === '' ? text : current + '\n' + text)
}

function fileToPng(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined' || typeof document === 'undefined' || typeof Image === 'undefined') {
      reject(new Error('browser image APIs unavailable'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth || img.width
          canvas.height = img.naturalHeight || img.height
          if (canvas.width <= 0 || canvas.height <= 0) throw new Error('empty image')
          const g = canvas.getContext('2d')
          g.drawImage(img, 0, 0)
          canvas.toBlob((blob) => {
            if (blob !== null && blob !== undefined) resolve(blob)
            else reject(new Error('canvas PNG export failed'))
          }, 'image/png')
        } catch (error) {
          reject(error)
        }
      }
      img.onerror = () => reject(new Error('browser could not decode this image'))
      img.src = reader.result
    }
    reader.onerror = () => reject(new Error('file read failed'))
    reader.readAsDataURL(file)
  })
}

async function handleFiles(files) {
  const lines = []
  for (const file of files) {
    try {
      if (typeof file.size === 'number' && file.size > 20 * 1024 * 1024) throw new Error('image larger than 20MB')
      const png = await fileToPng(file)
      const bytes = new Uint8Array(await png.arrayBuffer())
      const base64 = bytesToBase64(bytes)
      const result = await host.call('vision_save_image', {
        name: typeof file.name === 'string' ? file.name : '',
        mediaType: 'image/png',
        base64,
        checkSum: checkSum(base64),
      })
      if (result !== null && typeof result === 'object' && result.ok === true && typeof result.path === 'string') {
        lines.push('[Image: ' + result.path + ']')
      } else {
        throw new Error('save failed: ' + JSON.stringify(result))
      }
    } catch (error) {
      console.error('vision bridge: image save failed', error)
      lines.push('（图片粘贴失败：' + String(error && error.message ? error.message : error) + '）')
    }
  }
  if (lines.length > 0) appendToDraft(lines.join('\n'))
}

function PasteControl(props) {
  let fileInput = null
  React.useEffect(() => {
    bridge = { inputActions: props.inputActions, useInput: props.useInput }
    return () => {
      bridge = null
      fileInput = null
    }
  }, [props.inputActions, props.useInput])
  return React.createElement(
    'span',
    { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
    React.createElement('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff',
      multiple: true,
      style: { display: 'none' },
      ref: (node) => { fileInput = node },
      onChange: (event) => {
        const picked = Array.from(event.target.files || [])
        if (picked.length > 0) void handleFiles(picked)
        event.target.value = ''
      },
    }),
    React.createElement('button', {
      type: 'button',
      title: '选择图片（或直接在输入框 Ctrl+V 粘贴图片）',
      style: {
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: '16px',
        padding: '2px 4px',
        borderRadius: '4px',
      },
      onClick: () => { if (fileInput !== null) fileInput.click() },
    }, '🖼️'),
  )
}

return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots !== undefined) {
      slots.inject('conversation.input.left', () => slots.register(
        { name: 'conversation.input.left', id: 'vision-paste', order: 50, label: '视觉桥选图' },
        (props) => React.createElement(PasteControl, props),
      ))
    }
    ctx.effect(() => {
      const onPaste = (event) => {
        if (bridge === null) return
        const data = event.clipboardData
        if (data === undefined || data === null) return
        const files = Array.from(data.items || [])
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter((file) => file !== null && typeof file.type === 'string' && file.type.indexOf('image/') === 0)
        if (files.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        void handleFiles(files)
      }
      if (typeof window !== 'undefined') window.addEventListener('paste', onPaste, true)
      return () => {
        if (typeof window !== 'undefined') window.removeEventListener('paste', onPaste, true)
      }
    }, 'vision paste interception')
  },
}
