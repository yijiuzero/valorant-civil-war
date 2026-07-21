// ========== Supabase Auth 模块（昵称注册/可选登录）==========
const AUTH_DOMAIN = '@val-game.com';
let supabase = null;
let currentUser = null;

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

// 初始化：检测已登录 session，不弹窗
async function initAuth() {
  const sb = await getSupabase();
  const { data } = await sb.auth.getSession();
  currentUser = data.session ? data.session.user : null;
  updateSidebar();
}

// 注册
async function doSignUp(nickname, password) {
  const sb = await getSupabase();
  const email = toEmail(nickname);
  const { data, error } = await sb.auth.signUp({
    email: email, password: password,
    options: { data: { display_name: nickname } }
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
}

async function handleAuthSubmit() {
  const nickname = document.getElementById('authNickname').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  const btn = document.getElementById('authSubmitBtn');

  if (!nickname || !password) { errEl.textContent = '请填写昵称和密码'; return; }
  if (nickname.length < 2) { errEl.textContent = '昵称至少 2 个字符'; return; }
  if (password.length < 4) { errEl.textContent = '密码至少 4 位'; return; }

  btn.disabled = true; btn.textContent = '处理中...'; errEl.textContent = '';
  const isSignUp = document.getElementById('authTitle').textContent === '注册账号';
  try {
    if (isSignUp) await doSignUp(nickname, password);
    else await doSignIn(nickname, password);
  } catch (e) {
    const msg = e.message || '';
    // 注册时如果账户已存在，自动切登录
    if (isSignUp && (msg.includes('already') || msg.includes('exist'))) {
      errEl.textContent = '该昵称已注册，正尝试登录...';
      try { await doSignIn(nickname, password); return; }
      catch (e2) { errEl.textContent = '登录失败：密码错误？'; }
    }
    errEl.textContent = e.message + '（' + toEmail(nickname) + '）';
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
      display.innerHTML = '<div class="auth-user-name">👤 ' + userDisplayName(currentUser) + '</div><div class="auth-logout-link" onclick="doSignOut()">退出</div>';
      display.style.display = '';
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
  // 登录后隐藏侧边栏锁图标
  document.querySelectorAll('.nav-lock').forEach(function(el) { el.style.display = currentUser ? 'none' : ''; });
}

// 暴露
window.initAuth = initAuth;
window.toggleAuthOverlay = toggleAuthOverlay;
window.doSignOut = doSignOut;
window.handleAuthSubmit = handleAuthSubmit;
window.setAuthMode = setAuthMode;
