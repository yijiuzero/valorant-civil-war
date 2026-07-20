// ========== Supabase Auth 模块 ==========
let supabase = null;
let currentUser = null;

async function getSupabase() {
  if (supabase) return supabase;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/+esm');
  supabase = createClient('https://scoatqhpwkfhhinjviqr.supabase.co', 'sb_publishable_HRVWyVg47KyE2WJV7zLkSQ_Ap-y7AK-');
  return supabase;
}

// 检查当前登录状态
async function checkAuth() {
  const sb = await getSupabase();
  const { data } = await sb.auth.getSession();
  currentUser = data.session ? data.session.user : null;
  if (currentUser) {
    document.getElementById('authOverlay').style.display = 'none';
    updateUserDisplay();
  } else {
    showAuthOverlay();
  }
}

// 注册
async function doSignUp(email, password) {
  const sb = await getSupabase();
  const { data, error } = await sb.auth.signUp({ email: email, password: password });
  if (error) throw error;
  // 如果邮箱验证未开启，注册后直接登录
  if (data.session) {
    currentUser = data.session.user;
    onAuthSuccess();
    return;
  }
  // 否则需要验证邮箱
  window.showToast && window.showToast('注册成功！请检查邮箱验证链接。', 4000);
}

// 登录
async function doSignIn(email, password) {
  const sb = await getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email: email, password: password });
  if (error) throw error;
  currentUser = data.session.user;
  onAuthSuccess();
}

// 退出
async function doSignOut() {
  const sb = await getSupabase();
  await sb.auth.signOut();
  currentUser = null;
  showAuthOverlay();
}

// 登录成功后的处理
function onAuthSuccess() {
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authError').textContent = '';
  updateUserDisplay();
  // 刷新 teamsplit 的匿名登录状态
  if (window.initTeamSplitView) window.initTeamSplitView();
}

// 显示登录弹窗
function showAuthOverlay() {
  document.getElementById('authOverlay').style.display = '';
  document.getElementById('authError').textContent = '';
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  setAuthMode('signin');
}

// 切换登录/注册
function setAuthMode(mode) {
  const isSignUp = mode === 'signup';
  document.getElementById('authTitle').textContent = isSignUp ? '注册账号' : '欢迎回来';
  document.getElementById('authSubtitle').textContent = isSignUp ? '创建账号后即可使用所有功能' : '登录后即可使用所有功能';
  document.getElementById('authSubmitBtn').textContent = isSignUp ? '注册' : '登录';
  document.getElementById('authSwitchText').innerHTML = isSignUp
    ? '已有账号？<span class="auth-switch-link" onclick="setAuthMode(\'signin\')">去登录</span>'
    : '没有账号？<span class="auth-switch-link" onclick="setAuthMode(\'signup\')">去注册</span>';
}

// 表单提交
async function handleAuthSubmit() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  const btn = document.getElementById('authSubmitBtn');

  if (!email || !password) {
    errEl.textContent = '请填写邮箱和密码';
    return;
  }
  if (password.length < 6) {
    errEl.textContent = '密码至少 6 位';
    return;
  }

  btn.disabled = true;
  btn.textContent = '处理中...';
  errEl.textContent = '';

  const isSignUp = document.getElementById('authTitle').textContent === '注册账号';
  try {
    if (isSignUp) await doSignUp(email, password);
    else await doSignIn(email, password);
  } catch (e) {
    errEl.textContent = e.message || '操作失败，请重试';
  }
  btn.disabled = false;
  btn.textContent = isSignUp ? '注册' : '登录';
}

// 更新右上角用户显示
function updateUserDisplay() {
  const display = document.getElementById('authUserDisplay');
  if (display && currentUser) {
    const name = currentUser.email ? currentUser.email.split('@')[0] : '玩家';
    display.innerHTML = '<span class="auth-user-name">👤 ' + name + '</span><span class="auth-logout-link" onclick="doSignOut()">退出</span>';
    display.style.display = '';
  }
}

// 暴露到 window
window.checkAuth = checkAuth;
window.doSignIn = doSignIn;
window.doSignUp = doSignUp;
window.doSignOut = doSignOut;
window.handleAuthSubmit = handleAuthSubmit;
window.setAuthMode = setAuthMode;
