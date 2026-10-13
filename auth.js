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
  const clean = nickname.trim().toLowerCase();
  const slug = clean.replace(/[^a-z0-9]/g, '');
  // 纯中文/无ASCII：用确定性短码，相同昵称永远相同邮箱
  var h = 0;
  for (var i = 0; i < clean.length; i++) h = ((h << 5) - h + clean.charCodeAt(i)) | 0;
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
  // 注册身份失效监听（token 过期 / 服务端登出 / 其他标签页登出）
  registerAuthListener();
  const { data } = await sb.auth.getSession();
  if (!data.session) { currentUser = null; updateSidebar(); return; }
  // getSession 返回的是本地缓存的 session，其 user_metadata 可能过期
  //（如段位缺失、昵称未更新）。用 getUser() 从服务端取最新用户，
  // 避免刷新后段位/资料回退为「未设置」（重登却能显示的根因）。
  let user = data.session.user;
  try {
    const { data: ud } = await sb.auth.getUser();
    if (ud && ud.user) user = ud.user;
  } catch (e) { /* 取失败则降级用 session 里的 user */ }
  currentUser = user;
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
  if (loginErr) {
    // 区分邮箱未确认 vs 通用错误
    if (loginErr.message && loginErr.message.includes('Email not confirmed')) {
      throw new Error('注册成功！请前往邮箱确认后再登录（确认后回来即可登录）');
    }
    throw loginErr;
  }
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
  // signOut 不抛异常，失败时返回 { error }；必须检查，否则界面显示已登出
  // 而服务端 session 与 token 仍在（共用电脑场景下的隐私问题）。
  try {
    const sb = await getSupabase();
    const res = await sb.auth.signOut();
    if (res && res.error) {
      window.showToast && window.showToast('登出失败：' + res.error.message + '，请重试', 3000);
      return; // 失败就不改本地状态，保持与服务端一致
    }
  } catch (e) {
    window.showToast && window.showToast('登出失败：网络异常，请重试', 3000);
    return;
  }
  // 显式清理：身份态 + 各模块订阅/缓存，不依赖 updateSidebar 的副作用
  handleSessionLost();
  window.showToast && window.showToast('已退出登录', 2000);
}

function onAuthSuccess() {
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('authNickname').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authError').textContent = '';
  clearCaptcha();
  closeRankEdit();
  syncCurrentUser();
  updateSidebar();
}

// 点击侧边栏登录按钮
function toggleAuthOverlay() {
  closeRankEdit();
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
  // 长度上限：昵称会渲染到侧边栏/大厅/内鬼卡片，index.html 的 maxlength 只挡手输，
  // 超长昵称会撑破布局且放大下游 DOM 压力
  if (nickname.length > 12) { errEl.textContent = '昵称最多 12 个字符'; return; }
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
    const msg = (e && e.message) || '';
    if (/注册成功/.test(msg)) {
      // 注册已成功但需邮箱验证等业务提示：放行，否则用户会误以为昵称/密码错误而反复重试
      errEl.textContent = msg;
    } else if (/Failed to fetch|NetworkError|timeout|超时|网络/i.test(msg)) {
      errEl.textContent = '网络异常，请检查连接后重试';
    } else {
      errEl.textContent = '昵称或密码错误';
    }
  }
  btn.disabled = false;
  btn.textContent = isSignUp ? '注册' : '登录';
}

function updateSidebar() {
  // 身份同步在这里无条件执行：updateSidebar 可能因 DOM 未就绪而提前返回，
  // 绝不能让「某个侧边栏元素是否存在」决定全站身份态是否被同步（历史隐患）。
  syncCurrentUser();
  const entry = document.getElementById('authSidebarEntry');
  const player = document.getElementById('sidebarPlayer');
  if (!entry) return;
  if (currentUser) {
    entry.style.display = 'none';
    if (player) {
      const nameEl = document.getElementById('playerName');
      const rankEl = document.getElementById('playerRank');
      const avatarEl = player.querySelector('.player-avatar');
      if (nameEl) nameEl.textContent = userDisplayName(currentUser);
      if (rankEl) {
        rankEl.textContent = window._currentUserRank ? (window.getRankName ? window.getRankName(window._currentUserRank) : '') : '未设置';
      }
      if (avatarEl) avatarEl.textContent = userDisplayName(currentUser).charAt(0).toUpperCase();
      player.style.display = 'flex';
    }
  } else {
    entry.style.display = '';
    if (player) player.style.display = 'none';
  }
}

function syncCurrentUser() {
  window._currentUser = currentUser;
  window._currentUserDisplayName = userDisplayName(currentUser);
  window._currentUserRank = userRank(currentUser);
  // 登录后隐藏侧边栏锁图标
  document.querySelectorAll('.nav-lock').forEach(function(el) { el.style.display = currentUser ? 'none' : ''; });
}

// ========== 统一身份清理（架构项）==========
// 问题背景：本项目历史上各模块各自缓存登录身份（teamsplit 的 currentUserId、
// spy 的 spyUserId、window._currentUser 等），且登出时只有 auth.js 自己清理，
// 导致换号后残留上一位用户身份、Realtime 订阅不退订、内鬼面板闪现。
// 现改为：单一权威源 = auth.js 的 currentUser，登出/失效时统一广播各模块清理。
// 注意：不再依赖 updateSidebar 的副作用来清理身份（那是隐式且脆弱的耦合）。

// 广播登出/身份失效给所有业务模块
function broadcastIdentityReset() {
  if (typeof window.cleanupTeamSplitChannel === 'function') {
    try { window.cleanupTeamSplitChannel(); } catch (e) {}
  }
  if (typeof window.resetTeamSplitIdentity === 'function') {
    try { window.resetTeamSplitIdentity(); } catch (e) {}
  }
  if (typeof window.resetSpyIdentity === 'function') {
    try { window.resetSpyIdentity(); } catch (e) {}
  }
}

// 段位统一写入入口：回写模块级 currentUser，避免被 syncCurrentUser 从旧值覆盖
window.setCurrentUserRank = function(r) {
  if (currentUser) {
    currentUser = Object.assign({}, currentUser, {
      user_metadata: Object.assign({}, currentUser.user_metadata, { rank: r })
    });
  }
  window._currentUserRank = r;
  // 同步分队大厅的段位下拉显示态，避免下拉与侧边栏不一致
  var sel = document.getElementById('playerRankSelect');
  if (sel && r) sel.value = String(r);
};

// session 失效（登出 / token 过期 / 服务端登出）时的统一处理
function handleSessionLost() {
  currentUser = null;
  window._currentUserRank = 0;
  try { closeRankEdit(); } catch (e) {}
  broadcastIdentityReset();
  updateSidebar();
}

// 注册 onAuthStateChange：Supabase 在 token 过期/被撤销/其他标签页登出时主动通知，
// 这是全站唯一的身份失效感知入口（此前项目零监听，靠手动调用极易漏）。
function registerAuthListener() {
  var sb = supabase;
  if (!sb || !sb.auth || typeof sb.auth.onAuthStateChange !== 'function') return;
  sb.auth.onAuthStateChange(function(event, session) {
    // Supabase 官方提醒：该回调内不要调用其它 supabase 方法，重活延后执行
    setTimeout(function() {
      if (event === 'SIGNED_OUT' || !session) {
        if (currentUser !== null) handleSessionLost();
        return;
      }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        if (session.user) {
          currentUser = session.user;
          updateSidebar();
        }
      }
    }, 0);
  });
}

// ========== 自研本地人机验证（无第三方 CDN，国内可达，服务端 HMAC 校验）==========
// 竞态守卫：setAuthMode 每次切到注册页都会调 loadCaptcha，快速切换会并发触发多次，
// 后返回的响应会覆盖先返回的，导致「界面显示题目 A、currentCaptcha 却是题目 B」，
// 用户照屏作答却永远判错。故只认最后一次请求。
let captchaReqSeq = 0;

async function loadCaptcha() {
  const seq = ++captchaReqSeq;
  const container = document.getElementById('authTurnstile');
  if (!container) return;
  container.style.display = '';
  container.textContent = '正在加载人机验证…';
  container.style.cssText = 'font-size:12px;opacity:0.8;margin-bottom:4px;';
  try {
    const sb = await getSupabase();
    // 超时保护：函数冷启动慢或网络挂住时不让用户无限期卡在「正在加载」
    const invoke = sb.functions.invoke('turnstile-verify', { body: { action: 'challenge' } });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('验证服务响应超时')), 10000));
    const { data, error } = await Promise.race([invoke, timeout]);
    if (seq !== captchaReqSeq) return; // 已有更新的请求，丢弃本次结果
    if (error) throw error;
    if (!data || !data.success) throw new Error('服务端未返回题目');
    currentCaptcha = { payload: data.payload, sig: data.sig };
    // 用 DOM API 构建而非 innerHTML 拼接，服务端下发内容不参与 HTML 解析
    container.textContent = '';
    container.removeAttribute('style');
    const box = document.createElement('div');
    box.className = 'captcha-box';
    const q = document.createElement('div');
    q.className = 'captcha-q';
    q.textContent = data.q || '请完成验证';
    // 答案可能为负（服务端减法不做绝对值），故用 text 而非 number，避免吞掉负号
    const inp = document.createElement('input');
    inp.id = 'captchaAnswer';
    inp.className = 'captcha-input';
    inp.type = 'text';
    inp.inputMode = 'numeric';
    inp.autocomplete = 'off';
    inp.placeholder = '输入答案';
    const err = document.createElement('div');
    err.id = 'captchaErr';
    err.className = 'captcha-err';
    box.appendChild(q); box.appendChild(inp); box.appendChild(err);
    container.appendChild(box);
  } catch (e) {
    if (seq !== captchaReqSeq) return;
    container.textContent = '';
    container.removeAttribute('style');
    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:12px;color:#ffb4b4;line-height:1.5;';
    tip.textContent = '人机验证加载失败：' + (e && e.message ? e.message : '未知错误');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'captcha-retry';
    btn.textContent = '重新加载';
    btn.onclick = loadCaptcha;
    container.appendChild(tip); container.appendChild(btn);
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
  // 注意：DOM 里这两个按钮只有 class（.player-rankedit / .player-logout）没有 id，
  // 早期误用 #btnOpenRankEdit / #btnLogout 导致本段兜底从未生效过。
  if (t.closest('.player-rankedit')) { openRankEdit(); return; }
  if (t.closest('.player-logout')) { doSignOut(); return; }
});

// 修改段位：打开弹窗（预填当前段位）
function openRankEdit() {
  const sel = document.getElementById('rankEditSelect');
  if (sel && window._currentUserRank) sel.value = String(window._currentUserRank);
  const err = document.getElementById('rankEditError');
  if (err) err.textContent = '';
  const ao = document.getElementById('authOverlay');
  if (ao) ao.style.display = 'none';
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
