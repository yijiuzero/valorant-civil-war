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
  document.querySelectorAll('.map-card').forEach(c => c.classList.remove('highlight'));
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

// 全局吐司提示
function showToast(msg, duration) {
  if (duration === undefined) duration = 2000;
  const t = document.getElementById('globalToast');
  if (!t) return;
  if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
  t.innerText = msg;
  t.style.opacity = '1';
  toastTimeout = setTimeout(() => { t.style.opacity = '0'; toastTimeout = null; }, duration);
}

// ---------- 模块切换 ----------
function switchModule(mod) {
  stopMapSpin(true);
  stopAgentSpin(true);
  stopChallenge();
  navItems.forEach(i => i.classList.toggle('active', i.dataset.module === mod));
  contentLayers.forEach(l => l.style.display = 'none');
  const tl = document.getElementById('module-' + mod);
  if (tl) tl.style.display = '';
  if (mod === 'home') mainArea.style.backgroundImage = 'url(https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/c07f29d903296e00ab9462d7515d7b8d38f53903-1920x1080.jpg)';
  else if (mod === 'wheel') { if (!mapCardsRendered) { renderMapCards(); mapCardsRendered = true; } }
  else if (mod === 'agent') { if (!agentsRendered) { renderAgents(); agentsRendered = true; } }
  else if (mod === 'teamsplit') initTeamSplitView();
  else if (mod === 'stats') initChallengeMachine();
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
  document.querySelectorAll('.map-card').forEach(c => c.classList.remove('highlight'));
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
      w.forEach(x => { const c = document.querySelector(`.map-card[data-map="${x.en}"]`); if (c) c.classList.add('highlight'); });
      if (w.length) { mainArea.style.backgroundImage = `url(${w[0].img})`; showMapResults(w); }
      b.disabled = false;
      document.querySelectorAll('.mc-btn').forEach(x => x.disabled = false);
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
        if (e) { e.style.backgroundImage = `url(${m.img})`; e.classList.add('show'); }
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
    if (pg < 1) setTimeout(() => requestAnimationFrame(tick), iv);
    else {
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
  b.textContent = document.documentElement.classList.contains('theme-dark') ? '☀️' : '🌙';
}

function init() {
  applyThemeFromStorage();
  const tb = document.getElementById('themeToggle');
  if (tb) tb.addEventListener('click', toggleTheme);
  navItems = Array.from(document.querySelectorAll('.nav-item'));
  contentLayers = Array.from(document.querySelectorAll('.content-layer'));
  mainArea = document.getElementById('mainArea');
  initMapUI();
  initAgentUI();
  navItems.forEach(i => i.addEventListener('click', () => switchModule(i.dataset.module)));
  switchModule('home');
}

init();
