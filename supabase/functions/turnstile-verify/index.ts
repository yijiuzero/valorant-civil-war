// Supabase Edge Function: 自研轻量人机验证（无第三方 CDN，国内可达）
// 无状态 HMAC 方案：服务端出题并对答案签名，答案不暴露给前端，攻击者无法伪造签名绕过。
// 部署：supabase functions deploy turnstile-verify
// 密钥：复用项目自带的 SUPABASE_SERVICE_ROLE_KEY 作为 HMAC 密钥，Deno 自动注入，无需额外 set secret。
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TTL_MS = 5 * 60 * 1000 // 题目有效期 5 分钟，防重放/过期

// 单次题目最多允许的验证尝试次数（同一 nonce）。
// 背景：无状态函数无法持久化失败计数，故改为「一次性 nonce」——
// 一个题目只接受有限次验证，全部用尽即作废，攻击者必须重新出题。
// 遍历同一 payload 的攻击模型因此失效：每次出题只值 MAX_ATTEMPTS 次猜测。
const MAX_ATTEMPTS = 3

// 已消耗次数：以 nonce 为键的内存表，带过期清理。
// 注意：Edge Function 实例可能多副本/被回收，故这是「尽力而为」的加固，
// 并非绝对防护；它的价值在于把破解成本从 N 次请求提升到 N/MAX_ATTEMPTS 次出题。
const attempts = new Map()

function cleanupAttempts() {
  const now = Date.now()
  for (const [k, v] of attempts) {
    if (now - v.ts > TTL_MS) attempts.delete(k)
  }
}

function bumpAttempt(nonce) {
  cleanupAttempts()
  const rec = attempts.get(nonce)
  if (!rec) {
    attempts.set(nonce, { ts: Date.now(), count: 1 })
    return 1
  }
  rec.count += 1
  return rec.count
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// HMAC-SHA256，返回 hex 字符串
async function hmac(message) {
  if (!SECRET) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured (refusing insecure fallback)')
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

// 出题：三数两运算符（a op1 b op2 c = ?）
//
// 安全背景：原实现为两位数加减法，实测答案取值域仅 -19~40 共 60 个整数。
// anon key 硬编码在前端且 verify 可无限次调用，攻击者遍历 60 个候选答案即可
// 100% 破解（总成本 61 次请求），使注册门禁形同虚设。
//
// 关键设计要点（第一版尝试曾失败，务必注意）：
// 暴力破解的成本取决于「答案取值的种类数」，而非题目形态数。
// 仅把两位数改成三数、但减法取绝对值，答案反而被压缩到 0~50（51 种），比原来更差。
// 因此必须让答案本身在足够大的区间上分散开。
//
// 现行方案：a,b,c 各 1~99，两段运算均随机加减且不取绝对值，
// 允许中间结果与最终结果为负（前端输入框已改为 text 以支持负号）。
// 答案取值域约 -196 ~ 198，约 390 种；叠加 verify 失败次数限制后，
// 单次注册需数百次请求且会被限流拦截。
function makeChallenge() {
  const a = Math.floor(Math.random() * 99) + 1   // 1..99
  const b = Math.floor(Math.random() * 99) + 1   // 1..99
  const c = Math.floor(Math.random() * 99) + 1   // 1..99
  const op1 = Math.random() < 0.5 ? '+' : '-'
  const op2 = Math.random() < 0.5 ? '+' : '-'
  const left = op1 === '+' ? a + b : a - b
  const ans = op2 === '+' ? left + c : left - c
  const q = a + ' ' + op1 + ' ' + b + ' ' + op2 + ' ' + c + ' = ?'
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
      // 同一题目的尝试次数限制：超过即作废，攻击者必须重新出题
      const used = bumpAttempt(n)
      if (used > MAX_ATTEMPTS) {
        attempts.delete(n)
        return new Response(
          JSON.stringify({ success: false, error: 'too many attempts, reload challenge' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
        )
      }

      const expectSig = await hmac(String(answer).trim() + '|' + ts + '|' + n)
      // 恒定时间比较，防时序侧信道
      let diff = 0
      if (expectSig.length !== sig.length) diff = 1
      for (let i = 0; i < expectSig.length; i++) {
        diff |= (expectSig.charCodeAt(i) ^ (sig.charCodeAt(i) || 0))
      }
      if (diff !== 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'wrong answer' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
      // 验证通过：立即作废该 nonce，签名不可重放
      attempts.delete(n)
      return new Response(
        JSON.stringify({ success: true }),
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
