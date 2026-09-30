// AI 연결: Claude(공식 SDK) / OpenAI / Gemini API 호출. 키가 없으면 UI에서 '구독 계정 수동 모드'로 대체.
import Anthropic from '@anthropic-ai/sdk'
import { getSettings, type Provider } from './settings'

export interface AiRequest {
  system: string
  prompt: string
  /** 웹 검색(트렌드 서치) 허용 */
  webSearch?: boolean
  /** 이미지 첨부(검수용) */
  image?: { mime: string; base64: string }
  effort?: 'low' | 'medium' | 'high'
}

/** 크레딧·결제·사용 한도 문제 — 수동 모드로 계속하라고 안내 */
export class AiLimitError extends Error {
  constructor(provider: string, detail: string) {
    super(`${provider} 사용 한도나 크레딧이 끝난 것 같아요(${detail.slice(0, 120)}). 구독 계정 수동 모드로 계속할 수 있어요.`)
    this.name = 'AiLimitError'
  }
}

const LIMIT_RE = /quota|billing|credit|exceeded|exhausted|insufficient|payment|rate.?limit|balance|free tier|limit: 0/i

/** 응답 오류가 한도·결제 문제면 AiLimitError, 아니면 일반 Error */
export function apiError(provider: string, status: number, message?: string): Error {
  const msg = message ?? `${provider} 오류 ${status}`
  if (status === 402 || status === 429 || (status === 403 && LIMIT_RE.test(msg)) || LIMIT_RE.test(msg)) return new AiLimitError(provider, msg)
  return new Error(msg)
}

export const isLimitError = (e: unknown) => e instanceof AiLimitError

export const PROVIDER_LABEL: Record<Provider, string> = { claude: 'Claude', openai: 'ChatGPT', gemini: 'Gemini' }
export const CHAT_URL: Record<Provider, string> = {
  claude: 'https://claude.ai/new',
  openai: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
}

export async function aiText(req: AiRequest, provider: Provider = getSettings().textProvider): Promise<string> {
  if (provider === 'claude') return claudeText(req)
  if (provider === 'openai') return openaiText(req)
  return geminiText(req)
}

async function claudeText(req: AiRequest): Promise<string> {
  try {
    return await claudeTextInner(req)
  } catch (e) {
    const st = (e as { status?: number }).status
    if (st && (st === 402 || st === 429 || LIMIT_RE.test((e as Error).message))) throw new AiLimitError('Claude', (e as Error).message)
    throw e
  }
}

async function claudeTextInner(req: AiRequest): Promise<string> {
  const s = getSettings()
  if (!s.anthropicKey) throw new Error('설정에서 Anthropic API 키를 입력하세요.')
  const client = new Anthropic({ apiKey: s.anthropicKey, dangerouslyAllowBrowser: true })
  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  if (req.image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: req.image.mime as 'image/png', data: req.image.base64 },
    })
  }
  content.push({ type: 'text', text: req.prompt })
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content }]
  const tools: Anthropic.Beta.BetaToolUnion[] = req.webSearch
    ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }]
    : []

  // 웹 검색이 길어지면 pause_turn으로 끊겨 올 수 있어 이어서 요청
  for (let turn = 0; turn < 4; turn++) {
    const res = await client.beta.messages.create({
      model: s.claudeModel,
      max_tokens: 16000,
      system: req.system,
      messages,
      tools,
      output_config: { effort: req.effort ?? 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })
    if (res.stop_reason === 'refusal') {
      throw new Error(`Claude가 요청을 거절했어요${res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : ''}`)
    }
    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: res.content as Anthropic.Beta.BetaContentBlockParam[] })
      continue
    }
    return res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim()
  }
  throw new Error('웹 검색이 너무 오래 걸려요. 다시 시도해 주세요.')
}

async function openaiText(req: AiRequest): Promise<string> {
  const s = getSettings()
  if (!s.openaiKey) throw new Error('설정에서 OpenAI API 키를 입력하세요.')
  const content: unknown[] = [{ type: 'input_text', text: req.prompt }]
  if (req.image) content.push({ type: 'input_image', image_url: `data:${req.image.mime};base64,${req.image.base64}` })
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.openaiKey}` },
    body: JSON.stringify({
      model: s.openaiModel,
      instructions: req.system,
      input: [{ role: 'user', content }],
      tools: req.webSearch ? [{ type: 'web_search' }] : undefined,
    }),
  })
  const j = await res.json()
  if (!res.ok) throw apiError('OpenAI', res.status, j.error?.message)
  if (typeof j.output_text === 'string') return j.output_text
  return (j.output ?? [])
    .flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
    .filter((c: { type: string }) => c.type === 'output_text')
    .map((c: { text: string }) => c.text)
    .join('\n')
}

async function geminiText(req: AiRequest): Promise<string> {
  const s = getSettings()
  if (!s.geminiKey) throw new Error('설정에서 Gemini API 키를 입력하세요.')
  const parts: unknown[] = [{ text: req.prompt }]
  if (req.image) parts.push({ inline_data: { mime_type: req.image.mime, data: req.image.base64 } })
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${s.geminiModel}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.geminiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts }],
        tools: req.webSearch ? [{ google_search: {} }] : undefined,
      }),
    },
  )
  const j = await res.json()
  if (!res.ok) throw apiError('Gemini', res.status, j.error?.message)
  return (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('')
}

/** 이미지 생성(OpenAI / Gemini). Claude는 이미지 생성 기능이 없음 */
export async function aiImage(prompt: string, size: 'square' | 'landscape' | 'portrait' = 'square'): Promise<Blob> {
  const s = getSettings()
  if (s.imageProvider === 'openai') {
    if (!s.openaiKey) throw new Error('설정에서 OpenAI API 키를 입력하세요.')
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.openaiKey}` },
      body: JSON.stringify({
        model: s.openaiImageModel,
        prompt,
        size: { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' }[size],
        quality: 'high',
        n: 1,
      }),
    })
    const j = await res.json()
    if (!res.ok) throw apiError('OpenAI 이미지', res.status, j.error?.message)
    return b64ToBlob(j.data[0].b64_json, 'image/png')
  }
  if (s.imageProvider === 'gemini') {
    if (!s.geminiKey) throw new Error('설정에서 Gemini API 키를 입력하세요.')
    const aspect = { square: '1:1', landscape: '16:9', portrait: '9:16' }[size]
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${s.geminiImageModel}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.geminiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
        }),
      },
    )
    const j = await res.json()
    if (!res.ok) throw apiError('Gemini 이미지', res.status, j.error?.message)
    const part = (j.candidates?.[0]?.content?.parts ?? []).find((p: { inlineData?: unknown }) => p.inlineData)
    if (!part) throw new Error('Gemini가 이미지를 돌려주지 않았어요.')
    return b64ToBlob(part.inlineData.data, part.inlineData.mimeType ?? 'image/png')
  }
  throw new Error('이미지 생성은 수동 모드예요. ChatGPT/Gemini에서 만든 뒤 파일을 올려 주세요.')
}

function b64ToBlob(b64: string, mime: string) {
  const bin = atob(b64)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return new Blob([u], { type: mime })
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}
