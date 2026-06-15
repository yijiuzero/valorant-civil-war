// ---------- 全局变量 ----------
let mapCount = 1, mapTimer = null, bannedSet = new Set();
let agentRole = 'all', agentCount = 1, agentTimer = null;
let agentMode = 'count';

// ---------- 辅助函数:停止抽奖(清理定时器、恢复按钮)----------
function stopMapSpin(resetButtons = true) {
  if(mapTimer) { clearInterval(mapTimer); mapTimer = null; }
  if(resetButtons) {
    const spinBtn = document.getElementById('btnSpin');
    if(spinBtn) spinBtn.disabled = false;
    document.querySelectorAll('.mc-btn').forEach(btn => btn.disabled = false);
  }
  document.querySelectorAll('.map-card').forEach(c => c.classList.remove('highlight'));
}

function stopAgentSpin(resetButtons = true) {
  if(agentTimer) { clearInterval(agentTimer); agentTimer = null; }
  if(resetButtons) {
    const spinBtn = document.getElementById('btnAgent');
    if(spinBtn) spinBtn.disabled = false;
    document.querySelectorAll('.ac-btn').forEach(btn => btn.disabled = false);
  }
  document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('highlight'));
}

// 全局吐司提示
function showToast(msg, duration = 2000) {
  const toast = document.getElementById('globalToast');
  if(!toast) return;
  toast.innerText = msg;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, duration);
}

// ---------- 模块切换 ----------
function switchModule(mod) {
  // 停止任何进行中的抽奖并恢复按钮
  stopMapSpin(true);
  stopAgentSpin(true);
  // 切换导航样式
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.module === mod);
  });
  document.querySelectorAll('.content-layer').forEach(layer => layer.style.display = 'none');
  const targetLayer = document.getElementById(`module-${mod}`);
  if(targetLayer) targetLayer.style.display = '';
  // 修改背景(默认背景或重置)
  const mainEl = document.getElementById('mainArea');
  if(mod === 'home') {
    mainEl.style.backgroundImage = 'url(https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/c07f29d903296e00ab9462d7515d7b8d38f53903-1920x1080.jpg)';
  } else if(mod === 'wheel') {
    renderMapCards();
    // 保留之前抽奖的背景不清空,如果之前有背景则延续,但不覆盖默认。
  } else if(mod === 'agent') {
    renderAgents();
  } else if(mod === 'stats') {
    initChallengeMachine();
  }
  // 切换模块时保留结果，仅刷新页面时重置
}

function clickCard(mod) {
  const labels = { agent:'随机特工', stats:'内战专用' };
  switchModule(mod);
  showToast(`「${labels[mod] || mod}」模块即将上线,敬请期待 ✨`, 2000);
}

// ---------- 地图模块 ----------
function initMapUI() {
  document.querySelectorAll('.mc-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      if(this.disabled) return;
      document.querySelectorAll('.mc-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      mapCount = parseInt(this.dataset.count);
    // 保留已有结果，不清空
    });
  });
}

function renderMapCards() {
  stopMapSpin(true);
  const container = document.getElementById('mapCards');
  if(!container) return;
  container.innerHTML = maps.map(m => {
    const banned = bannedSet.has(m.en);
    return `<div class="map-card${banned ? ' banned' : ''}" data-map="${m.en}" style="background-image: url(${m.img}); background-color:#1e2d3d;" onclick="toggleBanMap('${m.en}')">
      <div class="mc-label">${m.cn}</div>
      <img src="${m.img}" style="display:none" onerror="this.closest('.map-card').style.backgroundImage='none'">
    </div>`;
  }).join('');
// 保留已有结果，不清空
  updateBanStatus();
  const resetBtn = document.getElementById('btnResetBan');
  if(resetBtn) resetBtn.onclick = resetBans;
}

function updateBanStatus() {
  const el = document.getElementById('banCount');
  if(el) el.textContent = `已Ban ${bannedSet.size}/${maps.length} 张`;
}

function resetBans() {
  stopMapSpin(true);
  bannedSet.clear();
  renderMapCards();
}

function toggleBanMap(mapEn) {
  if(bannedSet.has(mapEn)) {
    bannedSet.delete(mapEn);
  } else {
    bannedSet.add(mapEn);
  }
  updateBanStatus();
// 保留已有结果，不清空
  const card = document.querySelector(`.map-card[data-map="${mapEn}"]`);
  if(card) card.classList.toggle('banned', bannedSet.has(mapEn));
}

// Fisher-Yates 洗牌算法
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function drawMaps() {
  const btn = document.getElementById('btnSpin');
  if(btn.disabled) return;
  // 过滤已Ban地图
  const pool = maps.filter(m => !bannedSet.has(m.en));
  if(pool.length === 0) {
    showToast('所有地图都被 Ban 了，请先解禁一些 🙏', 2500);
    return;
  }
  const n = Math.min(mapCount, pool.length);
  // 禁用按钮
  btn.disabled = true;
  document.querySelectorAll('.mc-btn').forEach(b => b.disabled = true);
  // 清空结果
  const resultsDiv = document.getElementById('mapResults');
  if(resultsDiv) resultsDiv.innerHTML = '';
  document.querySelectorAll('.map-card').forEach(c => c.classList.remove('highlight'));

  const duration = 1500;
  const start = performance.now();
  // 清除旧定时器
  if(mapTimer) clearInterval(mapTimer);
  mapTimer = setInterval(() => {
    const elapsed = performance.now() - start;
    document.querySelectorAll('.map-card').forEach(c => c.classList.remove('highlight'));
    // 只从未Ban的卡片中选取高亮
    const cards = Array.from(document.querySelectorAll('.map-card:not(.banned)'));
    if(cards.length) {
      const idxPool = shuffleArray([...Array(cards.length).keys()]);
      for(let j = 0; j < Math.min(n, cards.length); j++) {
        cards[idxPool[j]].classList.add('highlight');
      }
    }
    if(elapsed >= duration) {
      clearInterval(mapTimer);
      mapTimer = null;
      // 使用 Fisher-Yates 洗牌
      const shuffled = shuffleArray(pool);
      const winners = shuffled.slice(0, n);
      // 清除动画残留，高亮赢家地图卡片
      document.querySelectorAll('.map-card').forEach(c => c.classList.remove('highlight'));
      winners.forEach(w => {
        const card = document.querySelector(`.map-card[data-map="${w.en}"]`);
        if(card) card.classList.add('highlight');
      });
      if(winners.length) {
        document.getElementById('mainArea').style.backgroundImage = `url(${winners[0].img})`;
        showMapResults(winners);
      }
      // 恢复按钮
      btn.disabled = false;
      document.querySelectorAll('.mc-btn').forEach(b => b.disabled = false);
    }
  }, 80);
}

function showMapResults(winners) {
  const container = document.getElementById('mapResults');
  if(!container) return;
  container.innerHTML = winners.map(m => `<div class="map-result-card" data-map="${m.en}" style="background-color:#1e2d3d;"><div class="mr-label">🎉 ${m.cn} (${m.en})</div></div>`).join('');
  setTimeout(() => {
    winners.forEach((m, idx) => {
      setTimeout(() => {
        const el = container.querySelector(`[data-map="${m.en}"]`);
        if(el) {
          el.style.backgroundImage = `url(${m.img})`;
          el.classList.add('show');
        }
      }, idx * 150);
    });
  }, 50);
}

// ---------- 特工模块 ----------
function initAgentUI() {
  document.querySelectorAll('.af-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.af-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      agentRole = this.dataset.role;
      resetAgentMode();
      renderAgents();
    });
  });
  document.querySelectorAll('.ac-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      if(this.disabled) return;
      document.querySelectorAll('.ac-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      agentCount = parseInt(this.dataset.count);
      agentMode = 'count';
      syncChampionButton();
    // 保留已有结果，不清空
    });
  });
  const championBtn = document.getElementById('btnChampionComp');
  if(championBtn) {
    championBtn.addEventListener('click', function() {
      if(this.disabled) return;
      agentMode = agentMode === 'champion' ? 'count' : 'champion';
      if(agentMode === 'champion') {
        document.querySelectorAll('.ac-btn').forEach(b => b.classList.remove('active'));
      }
      syncChampionButton();
    });
  }
}

function getAgentPool() {
  if(agentRole === 'all') return [...agents];
  return agents.filter(a => a.role === agentRole);
}

function resetAgentMode() {
  agentMode = 'count';
  syncChampionButton();
}

function syncChampionButton() {
  const championBtn = document.getElementById('btnChampionComp');
  if(!championBtn) return;
  championBtn.style.display = agentRole === 'all' ? '' : 'none';
  championBtn.classList.toggle('active', agentMode === 'champion');
}

function getChampionCompWinners() {
  const sentinel = shuffleArray(agents.filter(a => a.role === '哨卫')).slice(0, 1);
  const controller = shuffleArray(agents.filter(a => a.role === '控场者')).slice(0, 1);
  const initiator = shuffleArray(agents.filter(a => a.role === '先锋')).slice(0, 1);
  const firstEntry = shuffleArray(agents.filter(a => a.role === '决斗者' && a.entryTag === '一突')).slice(0, 1);
  const secondEntry = shuffleArray(agents.filter(a => a.role === '决斗者' && a.entryTag === '二突')).slice(0, 1);
  return [...sentinel, ...controller, ...initiator, ...firstEntry, ...secondEntry];
}

function renderAgents() {
  stopAgentSpin(true);
  const pool = getAgentPool();
  const container = document.getElementById('agentGrid');
  if(!container) return;
  const defaultImg = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48"%3E%3Crect width="48" height="48" fill="%231e2d3d"/%3E%3C/svg%3E';
  container.innerHTML = pool.map(a => `
    <div class="agent-card" data-agent-id="${a.id}">
      <img src="https://media.valorant-api.com/agents/${a.id}/displayicon.png" alt="${a.cn}" loading="lazy" onerror="this.src='${defaultImg}'">
      <div class="agent-name"><span class="agent-role-dot" style="background:${a.rc}"></span>${a.cn}</div>
    </div>
  `).join('');
// 保留已有结果，不清空
  syncChampionButton();
}

function showAgentResults(list) {
  const container = document.getElementById('agentResults');
  if(!container) return;
  container.innerHTML = list.map(a => `
    <div class="agent-result-card" data-agent-id="${a.id}">
      <img src="https://media.valorant-api.com/agents/${a.id}/displayicon.png">
      <div><div class="ar-name">${a.cn} (${a.en})</div><div class="ar-meta"><div class="ar-role"><span class="agent-role-dot" style="background:${a.rc}"></span>${a.role}</div></div></div>
    </div>
  `).join('');
  setTimeout(() => {
    list.forEach((a, idx) => {
      setTimeout(() => {
        const el = container.querySelector(`[data-agent-id="${a.id}"]`);
        if(el) el.classList.add('show');
      }, idx * 120);
    });
  }, 50);
}

function randomAgent() {
  const btn = document.getElementById('btnAgent');
  if(btn.disabled) return;
  const pool = getAgentPool();
  const isChampionComp = agentRole === 'all' && agentMode === 'champion';
  if(!isChampionComp && !pool.length) return;
  const n = isChampionComp ? 5 : Math.min(agentCount, pool.length);
  const winners = isChampionComp ? getChampionCompWinners() : shuffleArray(pool).slice(0, n);
  btn.disabled = true;
  document.querySelectorAll('.ac-btn').forEach(b => b.disabled = true);
  const championBtn = document.getElementById('btnChampionComp');
  if(championBtn) championBtn.disabled = true;
// 保留已有结果，不清空
  document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('highlight'));

  if(agentTimer) clearInterval(agentTimer);
  const duration = 1200;
  const start = performance.now();

  agentTimer = setInterval(() => {
    const elapsed = performance.now() - start;
    document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('highlight'));
    const cards = document.querySelectorAll('.agent-card');
    if(cards.length) {
      const idxPool = shuffleArray([...Array(cards.length).keys()]);
      for(let j = 0; j < Math.min(n, cards.length); j++) {
        cards[idxPool[j]].classList.add('highlight');
      }
    }
    if(elapsed >= duration) {
      clearInterval(agentTimer);
      agentTimer = null;
      // 清除动画残留的随机高亮,只保留赢家
      document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('highlight'));
      winners.forEach(winner => {
        const card = document.querySelector(`.agent-card[data-agent-id="${winner.id}"]`);
        if(card) card.classList.add('highlight');
      });
      showAgentResults(winners);
      btn.disabled = false;
      document.querySelectorAll('.ac-btn').forEach(b => b.disabled = false);
      if(championBtn) championBtn.disabled = false;
    }
  }, 80);
}

// ---------- 内战转盘模块 ----------
let machineSpinning = false, challengeHistory = [];

function spinChallenge() {
  if(machineSpinning) return;
  machineSpinning = true;
  const btn = document.getElementById('btnChallengeSpin');
  const text = document.getElementById('challengeText');
  if(btn) btn.disabled = true;
  if(text) { text.className = 'machine-text spinning'; }

  const targetIdx = Math.floor(Math.random() * challengeRules.length);
  const totalDuration = 1000 + Math.random() * 300;
  const startTime = performance.now();
  let lastIdx = -1;

  function easeOut(t) { return 1 - Math.pow(1 - t, 4); }

  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / totalDuration, 1);
    // Speed: fast at start, slow at end
    const interval = 30 + easeOut(progress) * 120;
    const currentIdx = (lastIdx + 1 + Math.floor(Math.random() * 3)) % challengeRules.length;
    if(text) text.textContent = challengeRules[currentIdx];
    lastIdx = currentIdx;

    if(progress < 1) {
      setTimeout(function() { requestAnimationFrame(tick); }, interval);
    } else {
      // Final result
      if(text) {
        text.textContent = challengeRules[targetIdx];
        text.className = 'machine-text result';
      }
      challengeHistory.unshift(challengeRules[targetIdx]);
      if(challengeHistory.length > 20) challengeHistory.pop();
      updateChallengeCount();
      showChallengeHistory();
      machineSpinning = false;
      if(btn) btn.disabled = false;
    }
  }
  requestAnimationFrame(tick);
}

function updateChallengeCount() {
  const el = document.getElementById('challengeCount');
  if(el) el.textContent = challengeHistory.length > 0 ? '已抽取 ' + challengeHistory.length + ' 次' : '';
}

function showChallengeHistory() {
  const container = document.getElementById('challengeHistory');
  if(!container) return;
  container.innerHTML = challengeHistory.map(function(r, i) {
    return '<div class="history-chip' + (i === 0 ? ' latest' : '') + '">' + r + '</div>';
  }).join('');
  requestAnimationFrame(function() {
    container.querySelectorAll('.history-chip').forEach(function(el, i) {
      setTimeout(function() { el.classList.add('show'); }, i * 50);
    });
  });
}

function initChallengeMachine() {
  machineSpinning = false;
  if(challengeHistory.length > 0) {
    const text = document.getElementById('challengeText');
    if(text) { text.textContent = challengeHistory[0]; text.className = 'machine-text result'; }
    showChallengeHistory();
    updateChallengeCount();
  } else {
    const text = document.getElementById('challengeText');
    if(text) { text.textContent = '点击下方按钮 抽取挑战规则'; text.className = 'machine-text idle'; }
    updateChallengeCount();
  }
}

// ---------- 页面初始化 & 事件绑定 ----------
function applyThemeFromStorage() {
  const stored = localStorage.getItem('ui-theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useDark = stored ? stored === 'dark' : true;
  document.documentElement.classList.toggle('theme-dark', useDark);
  updateThemeToggleLabel();
}

function toggleTheme() {
  const nextIsDark = !document.documentElement.classList.contains('theme-dark');
  document.documentElement.classList.toggle('theme-dark', nextIsDark);
  localStorage.setItem('ui-theme', nextIsDark ? 'dark' : 'light');
  updateThemeToggleLabel();
}

function updateThemeToggleLabel() {
  const btn = document.getElementById('themeToggle');
  if(!btn) return;
  const isDark = document.documentElement.classList.contains('theme-dark');
  btn.textContent = isDark ? '☀️' : '🌙';
}

function init() {
  applyThemeFromStorage();
  const themeBtn = document.getElementById('themeToggle');
  if(themeBtn) themeBtn.addEventListener('click', toggleTheme);
  initMapUI();
  initAgentUI();
  renderMapCards();
  renderAgents();
  // 导航监听
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => switchModule(item.dataset.module));
  });
  // onclick已在html标签上声明
  // 默认激活首页
  switchModule('home');
}
init();
