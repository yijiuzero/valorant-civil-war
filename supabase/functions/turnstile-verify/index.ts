// Supabase Edge Function: 校验 Cloudflare Turnstile token
// 用法：supabase functions deploy turnstile-verify
// 密钥：supabase secrets set TURNSTILE_SECRET=你的SecretKey
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const TURNSTILE_SECRET = Deno.env.get('TURNSTILE_SECRET')
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { token } = await req.json()
    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: 'missing token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // 服务端配置检查：Secret Key 未设置时直接返回配置错误
    if (!TURNSTILE_SECRET) {
      return new Response(
        JSON.stringify({ success: false, error: 'server misconfigured: TURNSTILE_SECRET not set' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    const formData = new URLSearchParams()
    formData.append('secret', TURNSTILE_SECRET)
    formData.append('response', token)

    const resp = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    })

    const outcome = await resp.json()
    return new Response(
      JSON.stringify({
        success: outcome.success === true,
        challenge_ts: outcome.challenge_ts,
        hostname: outcome.hostname,
        'error-codes': outcome['error-codes'],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
