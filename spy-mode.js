// ========== 内鬼模式模块 ==========
// Supabase 客户端仅在房间模式需要时懒加载
let supabase = null;
async function getSupabase() {
  if (supabase) return supabase;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/+esm');
  supabase = createClient('https://scoatqhpwkfhhinjviqr.supabase.co', 'sb_publishable_HRVWyVg47KyE2WJV7zLkSQ_Ap-y7AK-');
  return supabase;
}

let spyRoomCode = null;
let spyUserId = null;
let spyPlayerId = null;
let spyHostUserId = null;
let spyTeamA = [];
let spyTeamB = [];
let spyState = null;
let spyChannel = null;

// ========== 桥接:从 teamsplit 获取上下文 ==========
function setupSpyContext(ctx) {
  spyRoomCode = ctx.roomCode;
  spyUserId = ctx.userId;
  spyPlayerId = ctx.playerId;
  spyHostUserId = ctx.hostUserId;
  spyTeamA = ctx.teamA || [];
  spyTeamB = ctx.teamB || [];
}

// ========== 工具函数 ==========
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getRankName(rank) {
  const names = ['', '黑铁', '青铜', '白银', '黄金', '铂金', '钻石', '超凡', '神话', '赋能'];
  return names[rank] || '';
}

function isSpyHost() {
  return !!spyUserId && spyUserId === spyHostUserId;
}

// ========== UI 渲染 ==========
function showSpyView(view) {
  const views = ['spyInit', 'spyAssigning', 'spyPlaying', 'spyRevealed'];
  views.forEach(function(v) {
    const el = document.getElementById(v);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(view);
  if (target) target.style.display = '';
}

// ========== 状态同步 ==========
async function loadSpyState() {
  if (!spyRoomCode) return;
  try {
    const result = await (await getSupabase()).from('rooms').select('spy_state').eq('code', spyRoomCode).single();
    spyState = (result.data && result.data.spy_state) || null;
    renderCurrentPhase();
  } catch (e) {
    spyState = null;
    renderSpyInit();
  }
}

async function subscribeSpyState() {
  if (spyChannel) spyChannel.unsubscribe();
  const sb = await getSupabase();
  spyChannel = sb.channel('spy_' + spyRoomCode)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rooms', filter: 'code=eq.' + spyRoomCode },
      function(payload) {
        if (payload.new && payload.new.spy_state) {
          spyState = payload.new.spy_state;
          renderCurrentPhase();
        }
      }
    )
    .subscribe();
}

function renderCurrentPhase() {
  if (!spyState || !spyState.phase) {
    renderSpyInit();
    return;
  }
  switch (spyState.phase) {
    case 'assigning': renderSpyAssigning(); break;
    case 'playing': renderSpyPlaying(); break;
    case 'revealed': renderSpyRevealed(); break;
    default: renderSpyInit();
  }
}

// ========== 初始视图:等待开始 ==========
function renderSpyInit() {
  showSpyView('spyInit');
  const isHost = isSpyHost();
  const btn = document.getElementById('btnStartSpy');
  if (btn) {
    btn.disabled = !isHost;
    btn.textContent = isHost ? '分配内鬼 🕵️' : '等待房主开始内鬼模式...';
  }
  const hint = document.getElementById('spyInitHint');
  if (hint) {
    hint.textContent = isHost
      ? '系统将随机从每队中各选一人作为"内鬼"，内鬼的目标是让自己队伍输掉比赛。'
      : '房主即将开启内鬼模式，等待分配身份...';
  }
}

// ========== 分配内鬼 ==========
async function assignSpies() {
  if (!isSpyHost() || !spyRoomCode) return;
  const allPlayers = [...spyTeamA, ...spyTeamB];
  if (allPlayers.length < 4) {
    window.showToast && window.showToast('至少需要4人才能开启内鬼模式（每队至少2人）', 3000);
    return;
  }
  const teamAPool = spyTeamA.slice();
  const teamBPool = spyTeamB.slice();
  const spyA = teamAPool[Math.floor(Math.random() * teamAPool.length)];
  const spyB = teamBPool[Math.floor(Math.random() * teamBPool.length)];
  const taskA = Math.floor(Math.random() * window.spyTasks.length);
  let taskB = Math.floor(Math.random() * window.spyTasks.length);
  if (taskB === taskA) taskB = (taskA + 1) % window.spyTasks.length;

  const newState = {
    phase: 'playing',
    team_a_spy: spyA.id,
    team_b_spy: spyB.id,
    tasks: {},
    revealed: false
  };
  newState.tasks[String(spyA.id)] = taskA;
  newState.tasks[String(spyB.id)] = taskB;

  try {
    const result = await (await getSupabase()).from('rooms').update({ spy_state: newState }).eq('code', spyRoomCode);
    if (result.error) throw result.error;
    spyState = newState;
    renderSpyPlaying();
  } catch (e) {
    window.showToast && window.showToast('分配失败: ' + e.message, 3000);
  }
}

// ========== 游戏阶段视图 ==========
function renderSpyAssigning() {
  showSpyView('spyAssigning');
}

function renderSpyPlaying() {
  showSpyView('spyPlaying');
  if (!spyState) return;

  const isSpy = (spyPlayerId === spyState.team_a_spy || spyPlayerId === spyState.team_b_spy);
  const spyPanel = document.getElementById('spyIdentityPanel');
  const normalPanel = document.getElementById('spyNormalPanel');

  if (spyPanel) spyPanel.style.display = isSpy ? '' : 'none';
  if (normalPanel) normalPanel.style.display = isSpy ? 'none' : '';

  if (isSpy) {
    const teamLabel = spyPlayerId === spyState.team_a_spy ? '🔴 A队' : '🔵 B队';
    const who = document.getElementById('spyTeamLabel');
    if (who) who.textContent = teamLabel;

    const taskIdx = spyState.tasks[String(spyPlayerId)];
    const task = window.spyTasks[taskIdx];
    if (task) {
      const ti = document.getElementById('spyTaskIcon');
      const tt = document.getElementById('spyTaskTitle');
      const td = document.getElementById('spyTaskDesc');
      if (ti) ti.textContent = task.icon;
      if (tt) tt.textContent = task.title;
      if (td) td.textContent = task.desc;
    }

    const aElems = document.querySelectorAll('#spyTeamAList .spy-team-member');
    const bElems = document.querySelectorAll('#spyTeamBList .spy-team-member');
    aElems.forEach(function(el) {
      el.classList.toggle('spy-self', el.dataset.pid === String(spyPlayerId));
    });
    bElems.forEach(function(el) {
      el.classList.toggle('spy-self', el.dataset.pid === String(spyPlayerId));
    });
  }

  const hostBtn = document.getElementById('btnRevealSpies');
  if (hostBtn) {
    hostBtn.style.display = isSpyHost() ? '' : 'none';
  }
}

// ========== 揭晓内鬼 ==========
async function revealSpies() {
  if (!isSpyHost() || !spyState || !spyRoomCode) return;
  const revealed = Object.assign({}, spyState, { phase: 'revealed', revealed: true });
  try {
    await (await getSupabase()).from('rooms').update({ spy_state: revealed }).eq('code', spyRoomCode);
    spyState = revealed;
    renderSpyRevealed();
  } catch (e) {
    window.showToast && window.showToast('揭晓失败: ' + e.message, 3000);
  }
}

function renderSpyRevealed() {
  showSpyView('spyRevealed');
  if (!spyState) return;
  const spyA = findPlayerById(spyState.team_a_spy);
  const spyB = findPlayerById(spyState.team_b_spy);
  const aName = document.getElementById('revealSpyA');
  const bName = document.getElementById('revealSpyB');
  if (aName) aName.textContent = spyA ? spyA.name : '未知';
  if (bName) bName.textContent = spyB ? spyB.name : '未知';

  const taskA = window.spyTasks[spyState.tasks[String(spyState.team_a_spy)]];
  const taskB = window.spyTasks[spyState.tasks[String(spyState.team_b_spy)]];
  const at = document.getElementById('revealTaskA');
  const bt = document.getElementById('revealTaskB');
  if (at && taskA) at.textContent = taskA.icon + ' ' + taskA.title + '：' + taskA.desc;
  if (bt && taskB) bt.textContent = taskB.icon + ' ' + taskB.title + '：' + taskB.desc;
}

function findPlayerById(id) {
  return [...spyTeamA, ...spyTeamB].find(function(p) { return p.id === id; });
}

// ========== 离开内鬼模式 ==========
function leaveSpyMode() {
  if (spyChannel) { spyChannel.unsubscribe(); spyChannel = null; }
  spyState = null;
  spyRoomCode = null;
}

// ========== 初始化入口(由 teamsplit 调用) ==========
async function initSpyMode(ctx) {
  setupSpyContext(ctx);
  await loadSpyState();
  subscribeSpyState();
}

// ========== 独立手动组队模式 ==========
const SA_KEY = 'spy_standalone';

function loadStandaloneState() {
  try {
    const raw = localStorage.getItem(SA_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveStandaloneState(state) {
  localStorage.setItem(SA_KEY, JSON.stringify(state));
}

function clearStandaloneState() {
  localStorage.removeItem(SA_KEY);
}

let saState = null;

function initStandaloneView() {
  saState = loadStandaloneState();
  // 如果之前有游戏进度，直接恢复
  if (saState && saState.phase && saState.phase !== 'init') {
    document.getElementById('spyStandaloneEntry').style.display = 'none';
    document.getElementById('spyStandaloneSetup').style.display = 'none';
    document.getElementById('spyStandaloneGame').style.display = '';
    renderStandalonePhase();
    return;
  }
  // 否则显示入口
  backToSpyEntry();
}

function startSpySetup() {
  if (!saState) { saState = { players: [], teamA: [], teamB: [], phase: 'init' }; }
  document.getElementById('spyStandaloneEntry').style.display = 'none';
  document.getElementById('spyStandaloneGame').style.display = 'none';
  document.getElementById('spyStandaloneSetup').style.display = '';
  renderStandaloneSetup();
}

function backToSpyEntry() {
  document.getElementById('spyStandaloneSetup').style.display = 'none';
  document.getElementById('spyStandaloneGame').style.display = 'none';
  document.getElementById('spyStandaloneEntry').style.display = '';
}

function backToSpySetup() {
  document.getElementById('spyStandaloneGame').style.display = 'none';
  document.getElementById('spyStandaloneSetup').style.display = '';
  renderStandaloneSetup();
}

function renderStandaloneSetup() {
  if (!saState) saState = { players: [], teamA: [], teamB: [], phase: 'init' };
  const list = document.getElementById('spySetupPlayerList');
  if (!list) return;
  if (!saState.players.length) {
    list.innerHTML = '<div class="spy-setup-empty">还没有添加玩家，在上方输入名字添加</div>';
  } else {
    list.innerHTML = saState.players.map(function (p, i) {
      return '<div class="spy-setup-chip">' + esc(p.name) + '<button class="spy-setup-chip-remove" onclick="removeStandalonePlayer(' + i + ')">&times;</button></div>';
    }).join('');
  }
  const btn = document.getElementById('btnStandaloneSplit');
  if (btn) btn.disabled = saState.players.length < 4;
}

function addStandalonePlayer() {
  const input = document.getElementById('standalonePlayerInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  if (!saState) saState = { players: [], teamA: [], teamB: [], phase: 'init' };
  saState.players.push({ name: name, id: Date.now() });
  input.value = '';
  saveStandaloneState(saState);
  renderStandaloneSetup();
  input.focus();
}

function removeStandalonePlayer(idx) {
  if (!saState) return;
  saState.players.splice(idx, 1);
  saveStandaloneState(saState);
  renderStandaloneSetup();
}

function shuffleArray(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = r[i]; r[i] = r[j]; r[j] = t;
  }
  return r;
}

function doStandaloneSplit() {
  if (!saState || saState.players.length < 4) return;
  const shuffled = shuffleArray(saState.players);
  const mid = Math.ceil(shuffled.length / 2);
  saState.teamA = shuffled.slice(0, mid);
  saState.teamB = shuffled.slice(mid);
  saState.phase = 'init';
  saViewedIds.clear();
  if (saAutoHideTimer) { clearTimeout(saAutoHideTimer); saAutoHideTimer = null; }
  saveStandaloneState(saState);
  document.getElementById('spyStandaloneSetup').style.display = 'none';
  document.getElementById('spyStandaloneGame').style.display = '';
  renderStandalonePhase();
}

function renderStandalonePhase() {
  if (!saState) return;
  const s = ['sSpyInit', 'sSpyPlaying', 'sSpyRevealed'];
  s.forEach(function (id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  switch (saState.phase) {
    case 'init': renderSInit(); break;
    case 'playing': renderSPlaying(); break;
    case 'revealed': renderSRevealed(); break;
    default: renderSInit();
  }
}

function renderSInit() {
  document.getElementById('sSpyInit').style.display = '';
  // 队伍预览
  const prev = document.getElementById('sSpyTeamPreview');
  if (prev) {
    const aList = (saState.teamA || []).map(function(p) { return '<div class="spy-team-member">' + esc(p.name) + '</div>'; }).join('');
    const bList = (saState.teamB || []).map(function(p) { return '<div class="spy-team-member">' + esc(p.name) + '</div>'; }).join('');
    prev.innerHTML =
      '<div class="spy-team-col"><div class="spy-team-label team-a">🔴 A队 (' + (saState.teamA || []).length + '人)</div><div class="spy-team-players">' + aList + '</div></div>' +
      '<div class="spy-team-col"><div class="spy-team-label team-b">🔵 B队 (' + (saState.teamB || []).length + '人)</div><div class="spy-team-players">' + bList + '</div></div>';
  }
}

function assignStandaloneSpies() {
  if (!saState || !saState.teamA.length || !saState.teamB.length) return;
  const spyA = saState.teamA[Math.floor(Math.random() * saState.teamA.length)];
  const spyB = saState.teamB[Math.floor(Math.random() * saState.teamB.length)];
  const taskA = Math.floor(Math.random() * window.spyTasks.length);
  let taskB = Math.floor(Math.random() * window.spyTasks.length);
  if (taskB === taskA) taskB = (taskA + 1) % window.spyTasks.length;
  saState.team_a_spy = spyA.id;
  saState.team_b_spy = spyB.id;
  saState.tasks = {};
  saState.tasks[String(spyA.id)] = taskA;
  saState.tasks[String(spyB.id)] = taskB;
  saState.phase = 'playing';
  saveStandaloneState(saState);
  renderStandalonePhase();
}

function renderSPlaying() {
  document.getElementById('sSpyPlaying').style.display = '';
  if (!saState) return;

  // 找出当前用户是哪个（本地模式：通过输入的名字匹配）
  // 简单处理：显示"轮流看身份"提示
  const isViewedSpy = isCurrentSPlayerSpy();

  document.getElementById('sSpyNormalPanel').style.display = isViewedSpy === null ? '' : (isViewedSpy ? 'none' : '');
  document.getElementById('sSpyIdentityPanel').style.display = isViewedSpy === true ? '' : 'none';

  if (isViewedSpy === null) {
    // 用户还没选身份
    document.getElementById('sSpyNormalPanel').style.display = '';
    document.getElementById('sSpyIdentityPanel').style.display = 'none';
    const normalPanel = document.getElementById('sSpyNormalPanel');
    if (normalPanel) {
      normalPanel.querySelector('.spy-card-body').innerHTML =
        '<p>请每位玩家轮流点击自己的名字查看身份，看完自动隐藏。</p>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">' +
        (saState.teamA || []).concat(saState.teamB || []).map(function(p) {
          const viewed = saViewedIds.has(p.id);
          const cls = viewed ? 'spy-setup-chip spy-viewed' : 'spy-setup-chip';
          const onclick = viewed ? '' : ' onclick="viewStandaloneIdentity(' + p.id + ')"';
          return '<div class="' + cls + '" style="cursor:' + (viewed ? 'default' : 'pointer') + '"' + onclick + '>👤 ' + esc(p.name) + (viewed ? ' ✓' : '') + '</div>';
        }).join('') +
        '</div>';
    }
  } else {
    // 已选身份，显示内鬼面板
    const label = document.getElementById('sSpyTeamLabel');
    if (label && saState) {
      label.textContent = (saViewedSpy === saState.team_a_spy) ? '🔴 A队' : '🔵 B队';
    }
    const playerId = isSpyTeamA ? saState.team_a_spy : saState.team_b_spy;
    const taskIdx = saState.tasks[String(playerId)];
    const task = window.spyTasks[taskIdx];
    if (task) {
      document.getElementById('sSpyTaskIcon').textContent = task.icon;
      document.getElementById('sSpyTaskTitle').textContent = task.title;
      document.getElementById('sSpyTaskDesc').textContent = task.desc;
    }
  }
}

let saViewedSpy = null;
const saViewedIds = new Set();
let saAutoHideTimer = null;

function viewStandaloneIdentity(pid) {
  if (!saState || saViewedIds.has(pid)) return;
  saViewedSpy = pid;
  saViewedIds.add(pid);
  const isSpy = (pid === saState.team_a_spy || pid === saState.team_b_spy);
  const label = document.getElementById('sSpyTeamLabel');

  if (isSpy) {
    document.getElementById('sSpyIdentityPanel').style.display = '';
    document.getElementById('sSpyNormalPanel').style.display = 'none';
    if (label) label.textContent = (pid === saState.team_a_spy) ? '🔴 A队' : '🔵 B队';
    const taskIdx = saState.tasks[String(pid)];
    const task = window.spyTasks[taskIdx];
    if (task) {
      document.getElementById('sSpyTaskIcon').textContent = task.icon;
      document.getElementById('sSpyTaskTitle').textContent = task.title;
      document.getElementById('sSpyTaskDesc').textContent = task.desc;
    }
  } else {
    // 非内鬼：短暂提示后自动回到列表
    document.getElementById('sSpyIdentityPanel').style.display = 'none';
    document.getElementById('sSpyNormalPanel').style.display = '';
    const normalPanel = document.getElementById('sSpyNormalPanel');
    if (normalPanel) {
      normalPanel.querySelector('.spy-card-body').innerHTML = '<p style="text-align:center;font-size:18px;padding:20px;">✅ 你不是内鬼！<br><span style="font-size:13px;color:var(--text-dim)">身份已查看，即将返回列表...</span></p>';
    }
  }

  // 3 秒后自动隐藏，回到列表
  if (saAutoHideTimer) clearTimeout(saAutoHideTimer);
  saAutoHideTimer = setTimeout(function() {
    saViewedSpy = null;
    renderSPlaying();
  }, 3000);
}

function isCurrentSPlayerSpy() {
  if (!saViewedSpy || !saState) return null;
  if (saViewedSpy === saState.team_a_spy || saViewedSpy === saState.team_b_spy) return true;
  return false;
}

function hideSpyIdentity() {
  saViewedSpy = null;
  if (saAutoHideTimer) { clearTimeout(saAutoHideTimer); saAutoHideTimer = null; }
  renderSPlaying();
}

function revealStandaloneSpies() {
  if (!saState) return;
  saState.phase = 'revealed';
  saveStandaloneState(saState);
  renderStandalonePhase();
}

function renderSRevealed() {
  document.getElementById('sSpyRevealed').style.display = '';
  if (!saState) return;
  const findName = function(team, pid) {
    const p = (team || []).find(function(x) { return x.id === pid; });
    return p ? p.name : '未知';
  };
  const spyAName = findName(saState.teamA, saState.team_a_spy);
  const spyBName = findName(saState.teamB, saState.team_b_spy);
  const taskA = window.spyTasks[saState.tasks[String(saState.team_a_spy)]];
  const taskB = window.spyTasks[saState.tasks[String(saState.team_b_spy)]];
  const teams = document.getElementById('sSpyRevealTeams');
  if (teams) {
    teams.innerHTML =
      '<div class="spy-reveal-col"><div class="spy-reveal-team team-a">🔴 A队内鬼</div><div class="spy-reveal-name">' + esc(spyAName) + '</div><div class="spy-reveal-task">' + (taskA ? taskA.icon + ' ' + taskA.title + '：' + taskA.desc : '-') + '</div></div>' +
      '<div class="spy-reveal-col"><div class="spy-reveal-team team-b">🔵 B队内鬼</div><div class="spy-reveal-name">' + esc(spyBName) + '</div><div class="spy-reveal-task">' + (taskB ? taskB.icon + ' ' + taskB.title + '：' + taskB.desc : '-') + '</div></div>';
  }
}

function resetStandaloneSpy() {
  saViewedSpy = null;
  saViewedIds.clear();
  if (saAutoHideTimer) { clearTimeout(saAutoHideTimer); saAutoHideTimer = null; }
  saState = { players: [], teamA: [], teamB: [], phase: 'init' };
  clearStandaloneState();
  document.getElementById('spyStandaloneGame').style.display = 'none';
  document.getElementById('spyStandaloneSetup').style.display = '';
  renderStandaloneSetup();
}

// ========== 线上发布与加入 ==========
async function publishSpyRoom() {
  if (!saState || !saState.teamA.length || !saState.teamB.length || !saState.team_a_spy) return;
  const sb = await getSupabase();
  // 生成6位房间码
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const spyState = {
    phase: 'published',
    team_a: (saState.teamA || []).map(function(p) { return p.name; }),
    team_b: (saState.teamB || []).map(function(p) { return p.name; }),
    team_a_spy_name: findPlayerName(saState.teamA, saState.team_a_spy),
    team_b_spy_name: findPlayerName(saState.teamB, saState.team_b_spy),
    tasks: saState.tasks
  };
  try {
    await sb.from('rooms').insert({
      code: code, type: 'spy', status: 'playing',
      host_user_id: (window._currentUser && window._currentUser.id) || null,
      spy_state: spyState
    });
    document.getElementById('spyRoomCodeDisplay').textContent = code;
    document.getElementById('spyRoomPublishPanel').style.display = 'none';
    document.getElementById('spyRoomCodePanel').style.display = '';
    window.showToast && window.showToast('房间已发布！将房间码发给群友', 3000);
  } catch (e) {
    window.showToast && window.showToast('发布失败: ' + e.message, 3000);
  }
}

function findPlayerName(team, pid) {
  var p = (team || []).find(function(x) { return x.id === pid; });
  return p ? p.name : '未知';
}

async function joinSpyRoom(code) {
  var name = window._currentUserDisplayName;
  if (!name || name === '玩家') {
    window.showToast && window.showToast('请先登录后再加入房间', 3000);
    return;
  }
  var sb = await getSupabase();
  var res = await sb.from('rooms').select('spy_state').eq('code', code.toUpperCase()).single();
  if (res.error || !res.data || !res.data.spy_state) {
    window.showToast && window.showToast('房间不存在或已过期', 3000);
    return;
  }
  var state = res.data.spy_state;
  // 查找自己属于哪个队伍
  var inTeamA = (state.team_a || []).indexOf(name) !== -1;
  var inTeamB = (state.team_b || []).indexOf(name) !== -1;
  if (!inTeamA && !inTeamB) {
    window.showToast && window.showToast('你不在该房间的玩家列表中（昵称需完全一致）', 4000);
    return;
  }
  var isSpy = (name === state.team_a_spy_name || name === state.team_b_spy_name);
  var teamLabel = inTeamA ? '🔴 A队' : '🔵 B队';

  // 显示身份
  document.getElementById('spyStandaloneEntry').style.display = 'none';
  document.getElementById('spyStandaloneSetup').style.display = 'none';
  document.getElementById('spyStandaloneGame').style.display = '';
  document.getElementById('sSpyInit').style.display = 'none';
  document.getElementById('sSpyPlaying').style.display = '';

  if (isSpy) {
    document.getElementById('sSpyNormalPanel').style.display = 'none';
    document.getElementById('sSpyIdentityPanel').style.display = '';
    document.getElementById('sSpyTeamLabel').textContent = teamLabel;
    var spyId = inTeamA ? state.team_a_spy_name : state.team_b_spy_name;
    // 找到该内鬼的玩家 ID
    var allPlayers = (saState && (saState.teamA || []).concat(saState.teamB || [])) || [];
    var sp = allPlayers.find(function(p) { return p.name === spyId; });
    if (sp && state.tasks && state.tasks[String(sp.id)]) {
      var task = window.spyTasks[state.tasks[String(sp.id)]];
      if (task) {
        document.getElementById('sSpyTaskIcon').textContent = task.icon;
        document.getElementById('sSpyTaskTitle').textContent = task.title;
        document.getElementById('sSpyTaskDesc').textContent = task.desc;
      }
    }
    document.getElementById('sBtnRevealSpies').style.display = 'none';
    document.getElementById('sSpyJoinInfo').style.display = '';
  } else {
    document.getElementById('sSpyNormalPanel').style.display = '';
    document.getElementById('sSpyIdentityPanel').style.display = 'none';
    document.getElementById('sSpyNormalPanel').querySelector('.spy-card-body').innerHTML =
      '<p>✅ 你不是内鬼！</p><p class="spy-hint">队伍：' + teamLabel + '</p><p class="spy-hint">你的目标是与队伍一起赢得比赛。</p>';
    document.getElementById('sSpyJoinInfo').style.display = '';
  }
  document.getElementById('sSpyRevealed').style.display = 'none';
}

function showRoomCodeInput() {
  document.getElementById('spyJoinRoomPanel').style.display = '';
}

function hideRoomCodeInput() {
  document.getElementById('spyJoinRoomPanel').style.display = 'none';
}

function publishRoomPanel() {
  document.getElementById('spyRoomPublishPanel').style.display = '';
}

// 暴露到 window
window.initStandaloneView = initStandaloneView;
window.startSpySetup = startSpySetup;
window.backToSpyEntry = backToSpyEntry;
window.backToSpySetup = backToSpySetup;
window.addStandalonePlayer = addStandalonePlayer;
window.removeStandalonePlayer = removeStandalonePlayer;
window.doStandaloneSplit = doStandaloneSplit;
window.assignStandaloneSpies = assignStandaloneSpies;
window.viewStandaloneIdentity = viewStandaloneIdentity;
window.hideSpyIdentity = hideSpyIdentity;
window.revealStandaloneSpies = revealStandaloneSpies;
window.resetStandaloneSpy = resetStandaloneSpy;
window.publishSpyRoom = publishSpyRoom;
window.joinSpyRoom = joinSpyRoom;
window.showRoomCodeInput = showRoomCodeInput;
window.hideRoomCodeInput = hideRoomCodeInput;
