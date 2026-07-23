// ========== Supabase Auth 模块（昵称注册/可选登录）==========
const AUTH_DOMAIN = '@val-game.com';
let supabase = null;
let currentUser = null;
let currentCaptcha = null; // { payload, sig } 当前题目的服务端签名

async function getSupabase() {
  if (supabase) return supabase;
  supabase = await window._getSupabase();
  return supabase;
}

function toEmail(nickname) {
  const slug = nickname.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (slug) return slug + AUTH_DOMAIN;
  // 纯中文/无ASCII：用确定性短码，相同昵称永远相同邮箱
  var h = 0;
  for (var i = 0; i < nickname.length; i++) h = ((h << 5) - h + nickname.charCodeAt(i)) | 0;
  return 'u' + Math.abs(h).toString(36) + AUTH_DOMAIN;
}
function userDisplayName(user) {
  if (!user) return '玩家';
  const meta = user.user_metadata || {};
  return meta.display_name || (user.email ? user.email.split('@')[0] : '玩家');
}
function userRank(user) {
  if (!user) return 0;
  const meta = user.user_metadata || {};
  const r = parseInt(meta.rank, 10);
  return (r >= 1 && r <= 9) ? r : 0;
}

// 初始化：检测已登录 session，不弹窗
async function initAuth() {
  const sb = await getSupabase();
  const { data } = await sb.auth.getSession();
  currentUser = data.session ? data.session.user : null;
  updateSidebar();
}

// 注册
async function doSignUp(nickname, password, rank) {
  const sb = await getSupabase();
  const email = toEmail(nickname);
  const { data, error } = await sb.auth.signUp({
    email: email, password: password,
    options: { data: { display_name: nickname, rank: rank } }
  });
  if (error) throw error;
  if (data.session) {
    currentUser = data.session.user;
    onAuthSuccess();
    return;
  }
  // 注册成功但无 session → 邮箱确认未关，立即尝试登录
  const { data: loginData, error: loginErr } = await sb.auth.signInWithPassword({ email: email, password: password });
  if (loginErr) throw loginErr;
  currentUser = loginData.session ? loginData.session.user : null;
  if (currentUser) { onAuthSuccess(); return; }
  throw new Error('注册成功但登录失败，请刷新后重试');
}

// 登录
async function doSignIn(nickname, password) {
  const sb = await getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email: toEmail(nickname), password: password });
  if (error) throw error;
  currentUser = data.session.user;
  onAuthSuccess();
}

// 退出
async function doSignOut() {
  const sb = await getSupabase();
  await sb.auth.signOut();
  currentUser = null;
  updateSidebar();
}

function onAuthSuccess() {
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('authNickname').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authError').textContent = '';
  clearCaptcha();
  syncCurrentUser();
  updateSidebar();
}

// 点击侧边栏登录按钮
function toggleAuthOverlay() {
  const el = document.getElementById('authOverlay');
  if (el.style.display === 'none') {
    el.style.display = '';
    document.getElementById('authError').textContent = '';
    document.getElementById('authNickname').value = '';
    document.getElementById('authPassword').value = '';
    setAuthMode('signin');
    const nick = document.getElementById('authNickname');
    if (nick) setTimeout(function() { nick.focus(); }, 50);
  } else {
    el.style.display = 'none';
    const entry = document.getElementById('authSidebarEntry');
    if (entry) entry.focus();
  }
}

function setAuthMode(mode) {
  const isSignUp = mode === 'signup';
  document.getElementById('authTitle').textContent = isSignUp ? '注册账号' : '欢迎回来';
  document.getElementById('authSubtitle').textContent = isSignUp ? '昵称+密码即可注册' : '用昵称和密码登录';
  document.getElementById('authSubmitBtn').textContent = isSignUp ? '注册' : '登录';
  document.getElementById('authNickname').placeholder = '昵称';
  document.getElementById('authSwitchText').innerHTML = isSignUp
    ? '已有账号？<span class="auth-switch-link" onclick="setAuthMode(\'signin\')">去登录</span>'
    : '没有账号？<span class="auth-switch-link" onclick="setAuthMode(\'signup\')">去注册</span>';
  if (isSignUp) { loadCaptcha(); }
  else { clearCaptcha(); }
  const rankEl = document.getElementById('authRank');
  if (rankEl) rankEl.style.display = isSignUp ? '' : 'none';
}

async function handleAuthSubmit() {
  const nickname = document.getElementById('authNickname').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  const btn = document.getElementById('authSubmitBtn');
  const isSignUp = document.getElementById('authTitle').textContent === '注册账号';

  if (!nickname || !password) { errEl.textContent = '请填写昵称和密码'; return; }
  if (nickname.length < 2) { errEl.textContent = '昵称至少 2 个字符'; return; }
  if (password.length < 6) { errEl.textContent = '密码至少 6 位'; return; }
  if (isSignUp) {
    const rankVal = document.getElementById('authRank').value;
    if (!rankVal) { errEl.textContent = '请选择你的段位'; return; }
  }

  btn.disabled = true; btn.textContent = '处理中...'; errEl.textContent = '';

// 注册时先过自研本地人机验证（服务端 HMAC 校验，防裸奔）
  if (isSignUp) {
    if (!currentCaptcha) {
      errEl.textContent = '请先完成人机验证（看下方题目）';
      btn.disabled = false; btn.textContent = '注册'; return;
    }
    const ansEl = document.getElementById('captchaAnswer');
    const answer = ansEl ? ansEl.value.trim() : '';
    if (!answer) {
      errEl.textContent = '请先回答人机验证题目';
      btn.disabled = false; btn.textContent = '注册'; return;
    }
    try {
      const ok = await verifyCaptcha(answer);
      if (!ok) {
        errEl.textContent = '人机验证未通过，已换新题，请重试';
        loadCaptcha();
        if (ansEl) ansEl.value = '';
        btn.disabled = false; btn.textContent = '注册'; return;
      }
    } catch (e) {
      errEl.textContent = '人机验证服务异常：' + (e.message || '未知错误') + '（请稍后重试）';
      loadCaptcha();
      if (ansEl) ansEl.value = '';
      btn.disabled = false; btn.textContent = '注册'; return;
    }
  }

  try {
    if (isSignUp) await doSignUp(nickname, password, parseInt(document.getElementById('authRank').value, 10));
    else await doSignIn(nickname, password);
  } catch (e) {
    // 统一错误提示，不暴露昵称是否存在（防用户枚举）
    errEl.textContent = '昵称或密码错误';
  }
  btn.disabled = false;
  btn.textContent = isSignUp ? '注册' : '登录';
}

function updateSidebar() {
  const entry = document.getElementById('authSidebarEntry');
  const display = document.getElementById('authUserDisplay');
  if (!entry) return;
    if (currentUser) {
      entry.style.display = 'none';
      if (display) {
        var rankTxt = window._currentUserRank ? (window.getRankName ? window.getRankName(window._currentUserRank) : '') : '未设置';
        display.innerHTML =
          '<div class="auth-user-name"></div>' +
          '<div class="auth-user-actions">' +
            '<button type="button" class="auth-rankedit-btn" id="btnOpenRankEdit" onclick="openRankEdit()">修改段位</button>' +
            '<span class="auth-logout-link" id="btnLogout" onclick="doSignOut()">退出</span>' +
          '</div>';
        display.querySelector('.auth-user-name').textContent = userDisplayName(currentUser) + ' ';
        var rankSpan = document.createElement('span');
        rankSpan.className = 'auth-user-rank';
        rankSpan.textContent = rankTxt;
        display.querySelector('.auth-user-name').appendChild(rankSpan);
        display.style.display = '';
        var reb = document.getElementById('btnOpenRankEdit');
        if (reb) reb.addEventListener('click', openRankEdit);
        var lo = document.getElementById('btnLogout');
        if (lo) lo.addEventListener('click', doSignOut);
      }
    } else {
    entry.style.display = '';
    if (display) display.style.display = 'none';
  }
  syncCurrentUser();
}

function syncCurrentUser() {
  window._currentUser = currentUser;
  window._currentUserDisplayName = userDisplayName(currentUser);
  window._currentUserRank = userRank(currentUser);
  // 登录后隐藏侧边栏锁图标
  document.querySelectorAll('.nav-lock').forEach(function(el) { el.style.display = currentUser ? 'none' : ''; });
}

// ========== 自研本地人机验证（无第三方 CDN，国内可达，服务端 HMAC 校验）==========
async function loadCaptcha() {
  const container = document.getElementById('authTurnstile');
  if (!container) return;
  container.style.display = '';
  container.innerHTML = '<div style="font-size:12px;opacity:0.8;margin-bottom:4px;">正在加载人机验证…</div>';
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.functions.invoke('turnstile-verify', { body: { action: 'challenge' } });
    if (error) throw error;
    if (!data || !data.success) throw new Error('服务端未返回题目');
    currentCaptcha = { payload: data.payload, sig: data.sig };
    container.innerHTML =
      '<div class="captcha-box">' +
        '<div class="captcha-q">' + (data.q || '请完成验证') + '</div>' +
        '<input id="captchaAnswer" class="captcha-input" type="text" inputmode="numeric" autocomplete="off" placeholder="输入答案" />' +
        '<div id="captchaErr" class="captcha-err"></div>' +
      '</div>';
  } catch (e) {
    container.innerHTML = '<div style="font-size:12px;color:#ffb4b4;line-height:1.5;">人机验证加载失败：' + (e && e.message ? e.message : '未知错误') + '。请刷新页面重试。</div>';
  }
}
function clearCaptcha() {
  currentCaptcha = null;
  const container = document.getElementById('authTurnstile');
  if (container) { container.style.display = 'none'; container.innerHTML = ''; }
  const ansEl = document.getElementById('captchaAnswer');
  if (ansEl) ansEl.value = '';
}
async function verifyCaptcha(answer) {
  if (!currentCaptcha) return false;
  const sb = await getSupabase();
  const { data, error } = await sb.functions.invoke('turnstile-verify', {
    body: { action: 'verify', payload: currentCaptcha.payload, sig: currentCaptcha.sig, answer: answer }
  });
  if (error) throw error;
  return !!(data && data.success === true);
}

// 暴露
window.initAuth = initAuth;
window.toggleAuthOverlay = toggleAuthOverlay;
window.doSignOut = doSignOut;
window.handleAuthSubmit = handleAuthSubmit;
window.setAuthMode = setAuthMode;
window.openRankEdit = openRankEdit;
window.closeRankEdit = closeRankEdit;
window.saveRankEdit = saveRankEdit;

// 事件委托兜底：无论侧边栏 innerHTML 如何重建（updateSidebar 每次重建），
// 修改段位 / 退出都能命中；同时免疫 inline onclick 被任何策略拦截的极端情况。
// 与下方 inline onclick、updateSidebar 内的 addEventListener 互为冗余，任一生效即可。
document.addEventListener('click', function(e) {
  const t = e.target;
  if (!t || !t.closest) return;
  if (t.closest('#btnOpenRankEdit')) { openRankEdit(); return; }
  if (t.closest('#btnLogout')) { doSignOut(); return; }
});

// 修改段位：打开弹窗（预填当前段位）
function openRankEdit() {
  const sel = document.getElementById('rankEditSelect');
  if (sel && window._currentUserRank) sel.value = String(window._currentUserRank);
  const err = document.getElementById('rankEditError');
  if (err) err.textContent = '';
  const ov = document.getElementById('rankEditOverlay');
  if (ov) ov.style.display = '';
}
function closeRankEdit() {
  const ov = document.getElementById('rankEditOverlay');
  if (ov) ov.style.display = 'none';
}
async function saveRankEdit() {
  const sel = document.getElementById('rankEditSelect');
  const err = document.getElementById('rankEditError');
  const btn = document.getElementById('rankEditSaveBtn');
  const rank = sel ? parseInt(sel.value, 10) : 0;
  if (!rank || rank < 1 || rank > 9) { if (err) err.textContent = '请选择段位'; return; }
  if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.auth.updateUser({ data: { rank: rank } });
    if (error) throw error;
    if (data && data.user) currentUser = data.user;
    window._currentUserRank = rank;
    syncCurrentUser();
    updateSidebar();
    closeRankEdit();
    window.showToast && window.showToast('段位已更新', 2000);
  } catch (e) {
    if (err) err.textContent = '更新失败：' + (e.message || '未知错误');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  }
}
