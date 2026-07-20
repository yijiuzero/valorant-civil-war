// ========== Supabase Auth 模块（昵称注册/可选登录）==========
const AUTH_DOMAIN = '@val-game.com';
let supabase = null;
let currentUser = null;

async function getSupabase() {
  if (supabase) return supabase;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/+esm');
  supabase = createClient('https://scoatqhpwkfhhinjviqr.supabase.co', 'sb_publishable_HRVWyVg47KyE2WJV7zLkSQ_Ap-y7AK-');
  return supabase;
}

function toEmail(nickname) {
  const slug = nickname.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return (slug || 'player' + Date.now().toString(36)) + AUTH_DOMAIN;
}
function fromEmail(email) { return email ? email.split('@')[0] : '玩家'; }

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
  const { data, error } = await sb.auth.signUp({ email: toEmail(nickname), password: password });
  if (error) throw error;
  if (data.session) {
    currentUser = data.session.user;
    onAuthSuccess();
    return;
  }
  window.showToast && window.showToast('注册成功！请检查邮箱验证链接。', 4000);
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
  } else {
    el.style.display = 'none';
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
  if (password.length < 6) { errEl.textContent = '密码至少 6 位'; return; }

  btn.disabled = true; btn.textContent = '处理中...'; errEl.textContent = '';
  const isSignUp = document.getElementById('authTitle').textContent === '注册账号';
  try {
    if (isSignUp) await doSignUp(nickname, password);
    else await doSignIn(nickname, password);
  } catch (e) {
    errEl.textContent = e.message || '操作失败，请重试';
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
      display.innerHTML = '<div class="auth-user-name">👤 ' + fromEmail(currentUser.email) + '</div><div class="auth-logout-link" onclick="doSignOut()">退出</div>';
      display.style.display = '';
    }
  } else {
    entry.style.display = '';
    if (display) display.style.display = 'none';
  }
}

// 暴露
window.initAuth = initAuth;
window.toggleAuthOverlay = toggleAuthOverlay;
window.doSignOut = doSignOut;
window.handleAuthSubmit = handleAuthSubmit;
window.setAuthMode = setAuthMode;
