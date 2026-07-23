// Supabase Edge Function: 自研轻量人机验证（无第三方 CDN，国内可达）
// 无状态 HMAC 方案：服务端出题并对答案签名，答案不暴露给前端，攻击者无法伪造签名绕过。
// 部署：supabase functions deploy turnstile-verify
// 密钥：复用项目自带的 SUPABASE_SERVICE_ROLE_KEY 作为 HMAC 密钥，Deno 自动注入，无需额外 set secret。
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'dev-only-insecure-fallback'
const TTL_MS = 5 * 60 * 1000 // 题目有效期 5 分钟，防重放/过期

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// HMAC-SHA256，返回 hex 字符串
async function hmac(message) {
  const key = new TextEncoder().encode(SECRET)
  const data = new TextEncoder().encode(message)
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const buf = await crypto.subtle.sign('HMAC', cryptoKey, data)
  const arr = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0')
  return s
}

function makeChallenge() {
  const a = Math.floor(Math.random() * 20) + 1
  const b = Math.floor(Math.random() * 20) + 1
  const op = Math.random() < 0.5 ? '+' : '-'
  const ans = op === '+' ? a + b : a - b
  const q = a + ' ' + op + ' ' + b + ' = ?'
  return { q, ans }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  try {
    const body = await req.json().catch(() => ({}))
    const action = body.action

    // 出题：返回题目 q、不含答案的 payload（仅 ts|n）、以及对「答案|ts|n」的 HMAC 签名
    if (action === 'challenge') {
      const { q, ans } = makeChallenge()
      const ts = Date.now()
      const n = crypto.randomUUID()
      const payload = btoa(JSON.stringify({ ts, n }))
      const sig = await hmac(ans + '|' + ts + '|' + n)
      return new Response(
        JSON.stringify({ success: true, q, payload, sig }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // 验题：用前端提交的 answer 重新计算 HMAC(answer|ts|n)，与带来的 sig 比对。
    // 只有 answer 正确才能匹配（答案从不下发前端），从而防裸奔绕过。
    if (action === 'verify') {
      const { payload, sig, answer } = body
      if (!payload || !sig) {
        return new Response(
          JSON.stringify({ success: false, error: 'missing params' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }
      let ts, n
      try {
        const obj = JSON.parse(atob(payload))
        ts = obj.ts; n = obj.n
      } catch (e) {
        return new Response(
          JSON.stringify({ success: false, error: 'bad payload' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }
      // 有效期检查
      if (!ts || Date.now() - ts > TTL_MS) {
        return new Response(
          JSON.stringify({ success: false, error: 'expired' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }
      const expectSig = await hmac(String(answer).trim() + '|' + ts + '|' + n)
      // 恒定时间比较，防时序侧信道
      let diff = 0
      if (expectSig.length !== sig.length) diff = 1
      for (let i = 0; i < expectSig.length; i++) {
        diff |= (expectSig.charCodeAt(i) ^ (sig.charCodeAt(i) || 0))
      }
      return new Response(
        JSON.stringify({ success: diff === 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    return new Response(
      JSON.stringify({ success: false, error: 'unknown action' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err && err.message) || 'server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
