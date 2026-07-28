// ---------- 全局变量 ----------
let mapCount = 1, mapTimer = null, bannedSet = new Set(), toastTimeout = null;
let agentRole = 'all', agentCount = 1, agentTimer = null, agentMode = 'count', machineSpinning = false;
let challengeHistory = [];
let navItems = [], contentLayers = [], mainArea = null;
let mapCardsRendered = false, agentsRendered = false;

// ---------- 辅助函数:停止抽奖(清理定时器、恢复按钮)----------
function stopMapSpin(resetButtons = true) {
  if (mapTimer) { cancelAnimationFrame(mapTimer); mapTimer = null; }
  if (resetButtons) {
    const s = document.getElementById('btnSpin');
    if (s) s.disabled = false;
    document.querySelectorAll('.mc-btn').forEach(b => b.disabled = false);
  }
  document.querySelectorAll('.map-card').forEach(c => c.classList.remove('highlight','spotlight','loser-fade'));
}

function stopAgentSpin(resetButtons = true) {
  if (agentTimer) { cancelAnimationFrame(agentTimer); agentTimer = null; }
  if (resetButtons) {
    const s = document.getElementById('btnAgent');
    if (s) s.disabled = false;
    document.querySelectorAll('.ac-btn').forEach(b => b.disabled = false);
  }
  document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('highlight'));
  const cb = document.getElementById('btnChampionComp');
  if (cb) cb.disabled = false;
}

function stopChallenge() {
  machineSpinning = false;
  const b = document.getElementById('btnChallengeSpin');
  const t = document.getElementById('challengeText');
  if (b) b.disabled = false;
  if (t && t.className === 'machine-text spinning') {
    t.className = 'machine-text idle';
    t.textContent = '点击下方按钮 抽取挑战规则';
  }
}

// 全局吐司提示（支持手动关闭）
function showToast(msg, duration) {
  if (duration === undefined) duration = 2000;
  const t = document.getElementById('globalToast');
  if (!t) return;
  if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
  // 安全：用 textContent 替代 innerHTML，防止 XSS
  t.textContent = '';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  const closeBtn = document.createElement('span');
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', hideToast);
  t.appendChild(closeBtn);
  t.style.opacity = '1';
  toastTimeout = setTimeout(() => { t.style.opacity = '0'; toastTimeout = null; }, duration);
}
function hideToast() {
  const t = document.getElementById('globalToast');
  if (t) t.style.opacity = '0';
  if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
}

// ---------- 模块切换 ----------
function switchModule(mod) {
  stopMapSpin(true);
  stopAgentSpin(true);
  stopChallenge();
  // 退订上一个模块的 Realtime 频道，避免连接泄漏（遗留 #7）
  if (typeof window.cleanupTeamSplitChannel === 'function') window.cleanupTeamSplitChannel();
  if (typeof window.cleanupSpyChannel === 'function') window.cleanupSpyChannel();
  // 内鬼模式 & 内战分队 需登录
  if ((mod === 'spy' || mod === 'teamsplit') && !window._currentUser) {
    if (typeof toggleAuthOverlay === 'function') toggleAuthOverlay();
    window.showToast && window.showToast('请先登录', 2000);
    return;
  }
  navItems.forEach(i => {
    const active = i.dataset.module === mod;
    i.classList.toggle('active', active);
    if (active) i.setAttribute('aria-current', 'page');
    else i.removeAttribute('aria-current');
  });
  // 模块切换：直接切换，不额外做淡出淡入（CSS 已有 moduleFadeIn 入场动画）
  contentLayers.forEach(l => {
    if (l.style.display !== 'none') l.style.display = 'none';
  });
  const tl = document.getElementById('module-' + mod);
  if (tl) tl.style.display = '';
  if (mod === 'home') {
    const bg = document.getElementById('heroBg');
    if (bg) bg.style.backgroundImage = 'url(https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/c07f29d903296e00ab9462d7515d7b8d38f53903-1920x1080.jpg)';
    mainArea.classList.add('homepage');
  } else {
    mainArea.classList.remove('homepage');
  }
  if (mod === 'wheel') { if (!mapCardsRendered) { renderMapCards(); mapCardsRendered = true; } }
  else if (mod === 'agent') { if (!agentsRendered) { renderAgents(); agentsRendered = true; } }
  else if (mod === 'teamsplit') initTeamSplitView();
  else if (mod === 'stats') initChallengeMachine();
  else if (mod === 'spy' && typeof backToSpyEntry === 'function') backToSpyEntry();
}

// ---------- 地图模块 ----------
function initMapUI() {
  document.querySelectorAll('.mc-btn').forEach(b => b.addEventListener('click', function(e) {
    if (this.disabled) return;
    document.querySelectorAll('.mc-btn').forEach(x => x.classList.remove('active'));
    this.classList.add('active');
    mapCount = parseInt(this.dataset.count);
  }));
}

function renderMapCards() {
  stopMapSpin(true);
  const c = document.getElementById('mapCards');
  if (!c) return;
  c.innerHTML = maps.map(m => {
    const b = bannedSet.has(m.en);
    return `<div class="map-card${b ? ' banned' : ''}" data-map="${m.en}" style="background-image: url(${m.img}); background-color:#1e2d3d;" onclick="toggleBanMap('${m.en}')"><div class="mc-label">${m.cn}</div><img src="${m.img}" style="display:none" onerror="this.closest('.map-card').style.backgroundImage='none'"></div>`;
  }).join('');
  updateBanStatus();
  const r = document.getElementById('btnResetBan');
  if (r) r.onclick = resetBans;
}

function updateBanStatus() {
  const e = document.getElementById('banCount');
  if (e) e.textContent = `已Ban ${bannedSet.size}/${maps.length} 张`;
}

function resetBans() {
  stopMapSpin(true);
  bannedSet.clear();
  renderMapCards();
}

function toggleBanMap(e) {
  if (bannedSet.has(e)) bannedSet.delete(e); else bannedSet.add(e);
  updateBanStatus();
  const c = document.querySelector(`.map-card[data-map="${e}"]`);
  if (c) c.classList.toggle('banned', bannedSet.has(e));
}

function shuffleArray(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function drawMaps() {
  const b = document.getElementById('btnSpin');
  if (b.disabled) return;
  const p = maps.filter(m => !bannedSet.has(m.en));
  if (p.length === 0) { showToast('所有地图都被 Ban 了，请先解禁一些 🙏', 2500); return; }
  const n = Math.min(mapCount, p.length);
  b.disabled = true;
  document.querySelectorAll('.mc-btn').forEach(x => x.disabled = true);
  const rd = document.getElementById('mapResults');
  if (rd) rd.innerHTML = '';
  document.querySelectorAll('.map-card').forEach(c => { c.classList.remove('highlight','spotlight','loser-fade'); });
  const dur = 1500, tickMs = 80;
  let st, lastTick = -tickMs;
  function tick(now) {
    if (!st) st = now;
    if (now - lastTick < tickMs) { mapTimer = requestAnimationFrame(tick); return; }
    lastTick = now;
    const el = now - st;
    document.querySelectorAll('.map-card').forEach(c => c.classList.remove('highlight'));
    const cs = Array.from(document.querySelectorAll('.map-card:not(.banned)'));
    if (cs.length) {
      const ip = shuffleArray([...Array(cs.length).keys()]);
      for (let j = 0; j < Math.min(n, cs.length); j++) cs[ip[j]].classList.add('highlight');
    }
    if (el >= dur) {
      mapTimer = null;
      const sw = shuffleArray(p);
      const w = sw.slice(0, n);
      document.querySelectorAll('.map-card').forEach(c => c.classList.remove('highlight'));
      // 仪式：先让所有非选中地图淡出，再让选中地图聚光灯
      const losers = Array.from(document.querySelectorAll('.map-card:not(.banned)')).filter(c => !w.some(x => x.en === c.dataset.map));
      losers.forEach(c => c.classList.add('loser-fade'));
      w.forEach(x => { const c = document.querySelector(`.map-card[data-map="${x.en}"]`); if (c) { c.classList.remove('loser-fade'); c.classList.add('spotlight'); } });
      // 延迟揭晓结果卡片，预加载背景图
      setTimeout(() => {
        w.forEach(x => { const c = document.querySelector(`.map-card[data-map="${x.en}"]`); if (c) c.classList.remove('spotlight'); });
        if (w.length) { 
          // 预加载背景图
          const bgImg = new Image();
          bgImg.onload = () => { mainArea.style.backgroundImage = `url(${w[0].img})`; showMapResults(w); };
          bgImg.onerror = () => { mainArea.style.backgroundImage = `url(${w[0].img})`; showMapResults(w); };
          bgImg.src = w[0].img;
        }
      }, 800);
      b.disabled = false;
      document.querySelectorAll('.mc-btn').forEach(x => x.disabled = false);
      // "再来一次" 按钮文本
      if (b) b.textContent = '再来一次 🔄';
    } else {
      mapTimer = requestAnimationFrame(tick);
    }
  }
  mapTimer = requestAnimationFrame(tick);
}

function showMapResults(w) {
  const c = document.getElementById('mapResults');
  if (!c) return;
  c.innerHTML = w.map(m => `<div class="map-result-card" data-map="${m.en}" style="background-color:#1e2d3d;"><div class="mr-label">🎉 ${m.cn} (${m.en})</div></div>`).join('');
  setTimeout(() => {
    w.forEach((m, i) => {
      setTimeout(() => {
        const e = c.querySelector(`[data-map="${m.en}"]`);
        if (e) { e.style.backgroundImage = `url(${m.img})`; e.classList.add('animate-in'); }
      }, i * 150);
    });
  }, 50);
}

// ---------- 特工模块 ----------
function initAgentUI() {
  document.querySelectorAll('.af-btn').forEach(b => b.addEventListener('click', function() {
    document.querySelectorAll('.af-btn').forEach(x => x.classList.remove('active'));
    this.classList.add('active');
    agentRole = this.dataset.role;
    resetAgentMode();
    renderAgents();
  }));
  document.querySelectorAll('.ac-btn').forEach(b => b.addEventListener('click', function(e) {
    if (this.disabled) return;
    document.querySelectorAll('.ac-btn').forEach(x => x.classList.remove('active'));
    this.classList.add('active');
    agentCount = parseInt(this.dataset.count);
    agentMode = 'count';
    syncChampionButton();
  }));
  const cb = document.getElementById('btnChampionComp');
  if (cb) cb.addEventListener('click', function() {
    if (this.disabled) return;
    agentMode = agentMode === 'champion' ? 'count' : 'champion';
    if (agentMode === 'champion') document.querySelectorAll('.ac-btn').forEach(b => b.classList.remove('active'));
    syncChampionButton();
  });
}

function getAgentPool() { return agentRole === 'all' ? [...agents] : agents.filter(a => a.role === agentRole); }
function resetAgentMode() { agentMode = 'count'; syncChampionButton(); }

function syncChampionButton() {
  const c = document.getElementById('btnChampionComp');
  if (!c) return;
  c.style.display = agentRole === 'all' ? '' : 'none';
  c.classList.toggle('active', agentMode === 'champion');
}

function getChampionCompWinners() {
  return [
    ...shuffleArray(agents.filter(a => a.role === '哨卫')).slice(0, 1),
    ...shuffleArray(agents.filter(a => a.role === '控场者')).slice(0, 1),
    ...shuffleArray(agents.filter(a => a.role === '先锋')).slice(0, 1),
    ...shuffleArray(agents.filter(a => a.role === '决斗者' && a.entryTag === '一突')).slice(0, 1),
    ...shuffleArray(agents.filter(a => a.role === '决斗者' && a.entryTag === '二突')).slice(0, 1)
  ];
}

function renderAgents() {
  stopAgentSpin(true);
  const p = getAgentPool();
  const c = document.getElementById('agentGrid');
  if (!c) return;
  const d = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48"%3E%3Crect width="48" height="48" fill="%231e2d3d"/%3E%3C/svg%3E';
  c.innerHTML = p.map(a => `<div class="agent-card" data-agent-id="${a.id}"><img src="${VALORANT_API}/agents/${a.id}/displayicon.png" alt="${a.cn}" loading="lazy" onerror="this.src='${d}'"><div class="agent-name"><span class="agent-role-dot" style="background:${a.rc}"></span>${a.cn}</div></div>`).join('');
  syncChampionButton();
}

function showAgentResults(l) {
  const c = document.getElementById('agentResults');
  if (!c) return;
  c.innerHTML = l.map(a => `<div class="agent-result-card" data-agent-id="${a.id}"><img src="${VALORANT_API}/agents/${a.id}/displayicon.png"><div><div class="ar-name">${a.cn} (${a.en})</div><div class="ar-meta"><div class="ar-role"><span class="agent-role-dot" style="background:${a.rc}"></span>${a.role}</div></div></div></div>`).join('');
  setTimeout(() => {
    l.forEach((a, i) => {
      setTimeout(() => {
        const e = c.querySelector(`[data-agent-id="${a.id}"]`);
        if (e) e.classList.add('show');
      }, i * 120);
    });
  }, 50);
}

function randomAgent() {
  const b = document.getElementById('btnAgent');
  if (b.disabled) return;
  const p = getAgentPool();
  const cc = agentRole === 'all' && agentMode === 'champion';
  if (!cc && !p.length) return;
  const n = cc ? 5 : Math.min(agentCount, p.length);
  const w = cc ? getChampionCompWinners() : shuffleArray(p).slice(0, n);
  b.disabled = true;
  document.querySelectorAll('.ac-btn').forEach(x => x.disabled = true);
  const cb = document.getElementById('btnChampionComp');
  if (cb) cb.disabled = true;
  document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('highlight'));
  const dur = 1200, tickMs = 80;
  let st, lastTick = -tickMs;
  function tick(now) {
    if (!st) st = now;
    if (now - lastTick < tickMs) { agentTimer = requestAnimationFrame(tick); return; }
    lastTick = now;
    const el = now - st;
    document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('highlight'));
    const cs = document.querySelectorAll('.agent-card');
    if (cs.length) {
      const ip = shuffleArray([...Array(cs.length).keys()]);
      for (let j = 0; j < Math.min(n, cs.length); j++) cs[ip[j]].classList.add('highlight');
    }
    if (el >= dur) {
      agentTimer = null;
      document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('highlight'));
      w.forEach(x => { const c = document.querySelector(`.agent-card[data-agent-id="${x.id}"]`); if (c) c.classList.add('highlight'); });
      showAgentResults(w);
      b.disabled = false;
      document.querySelectorAll('.ac-btn').forEach(x => x.disabled = false);
      if (cb) cb.disabled = false;
    } else {
      agentTimer = requestAnimationFrame(tick);
    }
  }
  agentTimer = requestAnimationFrame(tick);
}

// ---------- 内战转盘模块 ----------
function spinChallenge() {
  if (machineSpinning) return;
  machineSpinning = true;
  const b = document.getElementById('btnChallengeSpin');
  const t = document.getElementById('challengeText');
  if (b) b.disabled = true;
  if (t) t.className = 'machine-text spinning';
  const ti = Math.floor(Math.random() * challengeRules.length);
  const td = 1000 + Math.random() * 300;
  const maxDuration = 5000; // 超时保护：防止动画无限循环
  const st = performance.now();
  let li = -1;
  function easeOut(t) { return 1 - Math.pow(1 - t, 4); }
  function tick(now) {
    if (!machineSpinning) return;
    const el = now - st;
    const pg = Math.min(el / td, 1);
    const iv = 30 + easeOut(pg) * 120;
    const ci = (li + 1 + Math.floor(Math.random() * 3)) % challengeRules.length;
    if (t) t.textContent = challengeRules[ci];
    li = ci;
    if (el < maxDuration && pg < 1) setTimeout(() => requestAnimationFrame(tick), iv);
    else {
      if (el >= maxDuration) showToast('抽取超时，请重试', 2000);
      if (t) { t.textContent = challengeRules[ti]; t.className = 'machine-text result'; }
      challengeHistory.unshift(challengeRules[ti]);
      if (challengeHistory.length > 20) challengeHistory.pop();
      updateChallengeCount();
      showChallengeHistory();
      machineSpinning = false;
      if (b) b.disabled = false;
    }
  }
  requestAnimationFrame(tick);
}

function updateChallengeCount() {
  const e = document.getElementById('challengeCount');
  if (e) e.textContent = challengeHistory.length > 0 ? '已抽取 ' + challengeHistory.length + ' 次' : '';
}

function showChallengeHistory() {
  const c = document.getElementById('challengeHistory');
  if (!c) return;
  c.innerHTML = challengeHistory.map((r, i) => '<div class="history-chip' + (i === 0 ? ' latest' : '') + '">' + r + '</div>').join('');
  requestAnimationFrame(() => c.querySelectorAll('.history-chip').forEach((e, i) => setTimeout(() => e.classList.add('show'), i * 50)));
}

function initChallengeMachine() {
  machineSpinning = false;
  if (challengeHistory.length > 0) {
    const t = document.getElementById('challengeText');
    if (t) { t.textContent = challengeHistory[0]; t.className = 'machine-text result'; }
    showChallengeHistory();
    updateChallengeCount();
  } else {
    const t = document.getElementById('challengeText');
    if (t) { t.textContent = '点击下方按钮 抽取挑战规则'; t.className = 'machine-text idle'; }
    updateChallengeCount();
  }
}

// ---------- 页面初始化 & 事件绑定 ----------
function applyThemeFromStorage() {
  const s = localStorage.getItem('ui-theme');
  const d = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const u = s ? s === 'dark' : true;
  document.documentElement.classList.toggle('theme-dark', u);
  updateThemeToggleLabel();
}

function toggleTheme() {
  const d = !document.documentElement.classList.contains('theme-dark');
  document.documentElement.classList.toggle('theme-dark', d);
  localStorage.setItem('ui-theme', d ? 'dark' : 'light');
  updateThemeToggleLabel();
}

function updateThemeToggleLabel() {
  const b = document.getElementById('themeToggle');
  if (!b) return;
  const isDark = document.documentElement.classList.contains('theme-dark');
  b.innerHTML = isDark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}

async function init() {
  try {
    applyThemeFromStorage();
    const tb = document.getElementById('themeToggle');
    if (tb) tb.addEventListener('click', toggleTheme);
    navItems = Array.from(document.querySelectorAll('.nav-item'));
    contentLayers = Array.from(document.querySelectorAll('.content-layer'));
    mainArea = document.getElementById('mainArea');
    
    // DOM 就绪检测：关键元素缺失时中断初始化并提示
    if (!mainArea) {
      console.error('初始化失败: mainArea DOM 元素不存在');
      const toast = document.getElementById('globalToast');
      if (toast) { toast.textContent = '页面初始化失败，请刷新重试'; toast.style.opacity = '1'; }
      return;
    }
    initAgentUI();
    navItems.forEach(i => i.addEventListener('click', () => switchModule(i.dataset.module)));
    
    // 网络状态检测
    function updateNetStatus() {
      const el = document.getElementById('netStatus');
      if (!el) return;
      if (navigator.onLine) {
        el.classList.remove('offline', 'visible');
      } else {
        el.textContent = '网络已断开，部分功能不可用';
        el.classList.add('offline', 'visible');
      }
    }
    window.addEventListener('online', updateNetStatus);
    window.addEventListener('offline', updateNetStatus);
    
    // 页面可见性变化：暂停/恢复动画
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { stopMapSpin(false); stopAgentSpin(false); }
    });
    
    // 键盘可达性
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        const el = e.target.closest && e.target.closest('[role="button"][tabindex]');
        if (el) { e.preventDefault(); el.click(); }
      } else if (e.key === 'Escape') {
        const ov = document.getElementById('authOverlay');
        if (ov && ov.style.display !== 'none') {
          ov.style.display = 'none';
          const entry = document.getElementById('authSidebarEntry');
          if (entry) entry.focus();
        }
        hideToast();
      }
    });
    
    switchModule('home');
    if (typeof initAuth === 'function') {
      try { await initAuth(); } catch (e) { /* optional */ }
    }
  } catch (e) {
    console.error('初始化失败:', e);
    showToast('页面初始化失败，请刷新重试', 5000);
  }
}

init();
