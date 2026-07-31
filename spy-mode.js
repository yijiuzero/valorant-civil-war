// ========== 内鬼模式模块 (V3 精简版) ==========
async function getSupabase() { return await window._getSupabase(); }

// ========== 工具函数 ==========
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========== Teamsplit 桥接 ==========
let spyRoomCode = null, spyUserId = null, spyPlayerId = null, spyHostUserId = null;
let spyTeamA = [], spyTeamB = [], spyState = null, spyChannel = null;

function setupSpyContext(ctx) {
  spyRoomCode = ctx.roomCode;
  spyUserId = ctx.userId;
  spyPlayerId = ctx.playerId;
  spyHostUserId = ctx.hostUserId;
  spyTeamA = ctx.teamA || [];
  spyTeamB = ctx.teamB || [];
}

function isSpyHost() {
  return !!spyUserId && spyUserId === spyHostUserId;
}

function showSpyView(view) {
  ['spyInit','spyAssigning','spyPlaying','spyRevealed'].forEach(function(v) {
    var el = document.getElementById(v);
    if (el) el.style.display = 'none';
  });
  var target = document.getElementById(view);
  if (target) target.style.display = '';
}

async function loadSpyState() {
  if (!spyRoomCode) return;
  try {
    var result = await (await getSupabase()).from('rooms').select('spy_state').eq('code', spyRoomCode).single();
    spyState = (result.data && result.data.spy_state) || null;
    renderCurrentPhase();
  } catch (e) {
    spyState = null; renderSpyInit();
  }
}

async function subscribeSpyState() {
  if (spyChannel) spyChannel.unsubscribe();
  var sb = await getSupabase();
  spyChannel = sb.channel('spy_' + spyRoomCode)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rooms', filter: 'code=eq.' + spyRoomCode },
      function(payload) {
        if (payload.new && payload.new.spy_state) {
          spyState = payload.new.spy_state;
          renderCurrentPhase();
        }
      })
    .subscribe();
}

function renderCurrentPhase() {
  if (!spyState || !spyState.phase) { renderSpyInit(); return; }
  switch (spyState.phase) {
    case 'assigning': renderSpyAssigning(); break;
    case 'playing': renderSpyPlaying(); break;
    case 'revealed': renderSpyRevealed(); break;
    default: renderSpyInit();
  }
}

function renderSpyInit() {
  showSpyView('spyInit');
  var host = isSpyHost();
  var btn = document.getElementById('btnStartSpy');
  if (btn) { btn.disabled = !host; btn.textContent = host ? '分配内鬼 🕵️' : '等待房主开始内鬼模式...'; }
  var hint = document.getElementById('spyInitHint');
  if (hint) hint.textContent = host ? '系统将随机从每队中各选一人作为"内鬼"。' : '房主即将开启内鬼模式，等待分配身份...';
}

async function assignSpies() {
  if (!isSpyHost() || !spyRoomCode) return;
  var all = spyTeamA.concat(spyTeamB);
  if (all.length < 4) { window.showToast && window.showToast('至少需要4人（每队≥2）', 3000); return; }
  // 使用 crypto.getRandomValues() 保证不可预测性
  var randA = new Uint32Array(1);
  crypto.getRandomValues(randA);
  var spyA = spyTeamA[randA[0] % spyTeamA.length];
  var randB = new Uint32Array(1);
  crypto.getRandomValues(randB);
  var spyB = spyTeamB[randB[0] % spyTeamB.length];
  var randTaskA = new Uint32Array(1);
  crypto.getRandomValues(randTaskA);
  var taskA = randTaskA[0] % window.spyTasks.length;
  var randTaskB = new Uint32Array(1);
  crypto.getRandomValues(randTaskB);
  var taskB = randTaskB[0] % window.spyTasks.length;
  if (taskB === taskA && window.spyTasks.length > 1) taskB = (taskA + 1) % window.spyTasks.length;
  var newState = { phase: 'playing', team_a_spy: spyA.id, team_b_spy: spyB.id, tasks: {}, revealed: false };
  newState.tasks[String(spyA.id)] = taskA;
  newState.tasks[String(spyB.id)] = taskB;
  try {
    var result = await (await getSupabase()).from('rooms').update({ spy_state: newState }).eq('code', spyRoomCode);
    if (result.error) throw result.error;
    spyState = newState; renderSpyPlaying();
  } catch (e) { window.showToast && window.showToast('分配失败: ' + e.message, 3000); }
}

function renderSpyAssigning() { showSpyView('spyAssigning'); }

function renderSpyPlaying() {
  showSpyView('spyPlaying');
  if (!spyState) return;
  var isSpy = (spyPlayerId === spyState.team_a_spy || spyPlayerId === spyState.team_b_spy);
  var spyPanel = document.getElementById('spyIdentityPanel');
  var normalPanel = document.getElementById('spyNormalPanel');
  if (spyPanel) spyPanel.style.display = isSpy ? '' : 'none';
  if (normalPanel) normalPanel.style.display = isSpy ? 'none' : '';
  if (isSpy) {
    var teamLabel = spyPlayerId === spyState.team_a_spy ? '🔴 A队' : '🔵 B队';
    var who = document.getElementById('spyTeamLabel'); if (who) who.textContent = teamLabel;
    var taskIdx = spyState.tasks[String(spyPlayerId)];
    var task = window.spyTasks[taskIdx];
    if (task) {
      var ti = document.getElementById('spyTaskIcon'), tt = document.getElementById('spyTaskTitle'), td = document.getElementById('spyTaskDesc');
      if (ti) ti.textContent = task.icon; if (tt) tt.textContent = task.title; if (td) td.textContent = task.desc;
    }
    document.querySelectorAll('#spyTeamAList .spy-team-member, #spyTeamBList .spy-team-member').forEach(function(el) {
      el.classList.toggle('spy-self', el.dataset.pid === String(spyPlayerId));
    });
  }
  var hostBtn = document.getElementById('btnRevealSpies');
  if (hostBtn) hostBtn.style.display = isSpyHost() ? '' : 'none';
}

async function revealSpies() {
  if (!isSpyHost() || !spyState || !spyRoomCode) return;
  spyState.phase = 'revealed'; spyState.revealed = true;
  // 仪式感延迟：先揭晓中...
  renderSpyAssigning();
  await new Promise(r => setTimeout(r, 1200));
  try {
    await (await getSupabase()).from('rooms').update({ spy_state: spyState }).eq('code', spyRoomCode);
    renderSpyRevealed();
  } catch (e) { window.showToast && window.showToast('揭晓失败: ' + e.message, 3000); }
}

function renderSpyRevealed() {
  showSpyView('spyRevealed');
  if (!spyState) return;
  var spyA = findPlayerById(spyState.team_a_spy), spyB = findPlayerById(spyState.team_b_spy);
  var aName = document.getElementById('revealSpyA'), bName = document.getElementById('revealSpyB');
  if (aName) aName.textContent = spyA ? spyA.name : '未知';
  if (bName) bName.textContent = spyB ? spyB.name : '未知';
  var taskA = window.spyTasks[spyState.tasks[String(spyState.team_a_spy)]];
  var taskB = window.spyTasks[spyState.tasks[String(spyState.team_b_spy)]];
  var at = document.getElementById('revealTaskA'), bt = document.getElementById('revealTaskB');
  if (at && taskA) at.textContent = taskA.icon + ' ' + taskA.title + '：' + taskA.desc;
  if (bt && taskB) bt.textContent = taskB.icon + ' ' + taskB.title + '：' + taskB.desc;
  // 触发动画
  var cols = document.querySelectorAll('.spy-reveal-col');
  cols.forEach(function(col) { col.classList.remove('reveal-animate'); void col.offsetWidth; col.classList.add('reveal-animate'); });
  var names = document.querySelectorAll('.spy-reveal-name');
  names.forEach(function(n) { n.classList.remove('spy-name-flash'); void n.offsetWidth; n.classList.add('spy-name-flash'); });
}

function findPlayerById(id) {
  return spyTeamA.concat(spyTeamB).find(function(p) { return p.id === id; });
}

function leaveSpyMode() {
  if (spyChannel) { spyChannel.unsubscribe(); spyChannel = null; }
  spyState = null; spyRoomCode = null;
}

async function initSpyMode(ctx) {
  setupSpyContext(ctx);
  await loadSpyState();
  subscribeSpyState();
}

// ========== 在线 Lobby 房间 ==========
let lobbyChannel = null, lobbyRoomCode = null, lobbyState = null;

async function cleanupSpyLobbyRooms() {
  try {
    var sb = await getSupabase();
    var twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    var oldLobby = await sb.from('rooms').select('code').eq('status', 'lobby').lt('created_at', twoHoursAgo);
    if (oldLobby.data && oldLobby.data.length > 0) {
      var lobbyCodes = oldLobby.data.map(function(r) { return r.code; });
      await sb.from('rooms').delete().in('code', lobbyCodes);
    }
  } catch (e) { /* 忽略清理错误 */ }
}

async function createSpyLobby() {
  await cleanupSpyLobbyRooms();
  var sb = await getSupabase();
  var code = Array.from(crypto.getRandomValues(new Uint32Array(6)), x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('').toUpperCase();
  var hostName = window._currentUserDisplayName || '房主';
  var hostId = (window._currentUser && window._currentUser.id) || null;
  var initState = {
    phase: 'lobby', host_name: hostName, host_user_id: hostId,
    players: [{ name: hostName, user_id: hostId, team: null, rank: window._currentUserRank || 0 }],
    team_a: [], team_b: [],
    team_a_spy_name: null, team_b_spy_name: null, tasks: {}
  };
  try {
    await sb.from('rooms').insert({ code: code, status: 'lobby', host_user_id: hostId, spy_state: initState });
    lobbyRoomCode = code; lobbyState = initState;
    subscribeSpyLobby(code); showSpyLobbyView();
    window.showToast && window.showToast('房间创建成功！', 2000);
  } catch (e) { window.showToast && window.showToast('创建失败: ' + e.message, 3000); }
}

async function joinSpyLobby(inputCode) {
  var name = window._currentUserDisplayName;
  if (!name || name === '玩家') { window.showToast && window.showToast('请先登录', 3000); return; }
  var code = (inputCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (!code) { window.showToast && window.showToast('房间码无效', 3000); return; }
  var sb = await getSupabase();
  var uid = (window._currentUser && window._currentUser.id) || null;
  try {
    var newState = await sb.rpc('lobby_add_player', {
      p_code: code, p_name: name, p_user_id: uid, p_rank: window._currentUserRank || 0
    });
    if (newState.error) {
      var msg = newState.error.message || '加入失败';
      if (msg.includes('房间已满')) { window.showToast && window.showToast('房间已满（最多10人）', 2000); }
      else if (msg.includes('不存在')) { window.showToast && window.showToast('房间不存在或已关闭', 3000); }
      else { window.showToast && window.showToast('加入失败: ' + msg, 3000); }
      return;
    }
    lobbyState = newState.data;
    // 检查 phase：可能是已关闭的房间
    if (lobbyState && lobbyState.phase && lobbyState.phase !== 'lobby') {
      window.showToast && window.showToast('游戏已开始', 3000);
      return;
    }
    lobbyRoomCode = code;
    subscribeSpyLobby(code); showSpyLobbyView();
  } catch (e) {
    window.showToast && window.showToast('加入失败: ' + (e.message || '未知错误'), 3000);
  }
}

function subscribeSpyLobby(code) {
  if (lobbyChannel) lobbyChannel.unsubscribe();
  getSupabase().then(function(sb) {
    lobbyChannel = sb.channel('lobby_' + code)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: 'code=eq.' + code },
        function(payload) {
          if (payload.new && payload.new.spy_state) {
            lobbyState = payload.new.spy_state;
            // 同步 rooms 表的 host_user_id 到 lobbyState，确保房主转移对所有客户端生效
            if (payload.new.host_user_id) {
              lobbyState.host_user_id = payload.new.host_user_id;
            }
            renderSpyLobby();
          }
        })
      .subscribe();
  });
}

function isHost() {
  if (!lobbyState || !window._currentUser) return false;
  return lobbyState.host_user_id === window._currentUser.id;
}

function showSpyLobbyView() {
  ['spyStandaloneEntry','spyStandaloneSetup','spyStandaloneGame','spyQuickRoomSetup','spyQuickRoomResult','spyJoinRoomPanel'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  var lv = document.getElementById('spyLobbyView'); if (lv) lv.style.display = '';
  renderSpyLobby();
}

// ===== 拖拽分队 =====
function allowDrop(e) { 
  e.preventDefault(); 
  var col = e.target && e.target.closest ? e.target.closest('.spy-drag-col') : null;
  if (col) col.classList.add('drag-over');
}
function handleDragLeave(e) {
  var col = e.target && e.target.closest ? e.target.closest('.spy-drag-col') : null;
  if (col) col.classList.remove('drag-over');
}

function dragStart(e) {
  var card = (e.target && e.target.closest) ? e.target.closest('.spy-drag-card') : null;
  var name = card ? card.getAttribute('data-name') : (e.target && e.target.dataset ? e.target.dataset.name : '');
  e.dataTransfer.setData('text/plain', name || '');
  e.dataTransfer.effectAllowed = 'move';
}

async function handleDropTeam(e, team) {
  e.preventDefault();
  var name = e.dataTransfer.getData('text/plain');
  if (!name || !isHost()) return;
  await updatePlayerTeam(name, team);
}

// 触屏/鼠标/键盘通用的「点击分配」入口：从卡片 data-name 取玩家名（避免把名字拼进 JS 字符串）
function assignTeamFromCard(btn, team) {
  var card = btn.closest('.spy-drag-card');
  if (!card) return;
  var name = card.getAttribute('data-name');
  if (!name || !isHost()) return;
  updatePlayerTeam(name, team === 'null' ? null : team);
}

function renderSpyLobby() {
  if (!lobbyState) return;
  var el = document.getElementById('spyLobbyView'); if (!el) return;
  var phase = lobbyState.phase, host = isHost();

  var codeHtml = '<div style="display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:16px;">' +
    '<span style="font-size:13px;color:var(--text-dim);">房间码</span>' +
    '<span style="font-size:24px;font-weight:900;color:var(--accent);letter-spacing:3px;">' + lobbyRoomCode + '</span>' +
    '<button class="btn-machine teamsplit-inline-btn" aria-label="复制房间码" onclick="navigator.clipboard.writeText(\'' + esc(lobbyRoomCode) + '\');window.showToast(\'已复制\',2000)" style="min-height:32px;padding:2px 10px;font-size:12px;">📋</button>' +
    '</div>';

  if (phase === 'lobby') {
    var unassigned = lobbyState.players.filter(function(p) { return !p.team || (p.team !== 'A' && p.team !== 'B'); });
    var teamA = lobbyState.players.filter(function(p) { return p.team === 'A'; });
    var teamB = lobbyState.players.filter(function(p) { return p.team === 'B'; });
    var canStart = teamA.length >= 1 && teamB.length >= 1;

    function dragCard(p) {
      var isA = p.team === 'A', isB = p.team === 'B';
      var btnA = host
        ? '<button type="button" class="spy-team-btn spy-team-btn-a' + (isA ? ' active' : '') + '" aria-label="' + (isA ? '取消分配到A队' : '分配到A队') + '" onclick="assignTeamFromCard(this,\'' + (isA ? 'null' : 'A') + '\')">' + (isA ? '✓A' : 'A') + '</button>'
        : '';
      var btnB = host
        ? '<button type="button" class="spy-team-btn spy-team-btn-b' + (isB ? ' active' : '') + '" aria-label="' + (isB ? '取消分配到B队' : '分配到B队') + '" onclick="assignTeamFromCard(this,\'' + (isB ? 'null' : 'B') + '\')">' + (isB ? '✓B' : 'B') + '</button>'
        : '';
      var actions = host ? '<span class="spy-team-btn-row">' + btnA + btnB + '</span>' : '';
      var rk = p.rank || 0;
      var rankTag = (rk && window.getRankName) ? ' <span class="spy-rank-tag">' + window.getRankName(rk) + '</span>' : '';
      var isMobile = window.matchMedia('(max-width: 640px)').matches;
      return '<div class="spy-drag-card spy-drag-card-assign' + (isMobile ? ' spy-drag-card-mobile' : '') + '" draggable="' + (host && !isMobile ? 'true' : 'false') + '" data-name="' + esc(p.name) + '" ondragstart="dragStart(event)">' +
        '<span class="spy-drag-name">' + esc(p.name) + rankTag + '</span>' + actions + '</div>';
    }

    el.innerHTML = codeHtml +
      '<div class="spy-setup-card">' +
      '<div class="spy-setup-head"><span>🎮 等待玩家加入（' + lobbyState.players.length + '/10人）</span></div>' +
      '<div style="font-size:13px;color:var(--text-dim);text-align:center;margin-bottom:12px;">群友登录后在"内鬼模式→加入线上房间"输入房间码</div>' +
      (host
        ? '<div class="spy-drag-area">' +
          '<div class="spy-drag-col spy-drag-unassigned" ondragover="allowDrop(event)" ondragleave="handleDragLeave(event)" ondrop="handleDropTeam(event,null)">' +
            '<div class="spy-drag-label">待分配</div><div class="spy-drag-list">' + unassigned.map(dragCard).join('') + '</div></div>' +
          '<div class="spy-drag-col team-a" ondragover="allowDrop(event)" ondragleave="handleDragLeave(event)" ondrop="handleDropTeam(event,\'A\')">' +
            '<div class="spy-drag-label">🔴 A队 (' + teamA.length + '人)</div><div class="spy-drag-list">' + teamA.map(dragCard).join('') + '</div></div>' +
          '<div class="spy-drag-col team-b" ondragover="allowDrop(event)" ondragleave="handleDragLeave(event)" ondrop="handleDropTeam(event,\'B\')">' +
            '<div class="spy-drag-label">🔵 B队 (' + teamB.length + '人)</div><div class="spy-drag-list">' + teamB.map(dragCard).join('') + '</div></div>' +
          '</div>'
        : '<div class="spy-drag-area">' +
          '<div class="spy-drag-col spy-drag-unassigned"><div class="spy-drag-label">待分配</div><div class="spy-drag-list">' + unassigned.map(function(p) { return '<div class="spy-drag-card">' + esc(p.name) + ((p.rank && window.getRankName) ? ' <span class="spy-rank-tag">' + window.getRankName(p.rank) + '</span>' : '') + '</div>'; }).join('') + '</div></div>' +
          '<div class="spy-drag-col team-a"><div class="spy-drag-label">🔴 A队 (' + teamA.length + '人)</div><div class="spy-drag-list">' + teamA.map(function(p) { return '<div class="spy-drag-card">' + esc(p.name) + ((p.rank && window.getRankName) ? ' <span class="spy-rank-tag">' + window.getRankName(p.rank) + '</span>' : '') + '</div>'; }).join('') + '</div></div>' +
          '<div class="spy-drag-col team-b"><div class="spy-drag-label">🔵 B队 (' + teamB.length + '人)</div><div class="spy-drag-list">' + teamB.map(function(p) { return '<div class="spy-drag-card">' + esc(p.name) + ((p.rank && window.getRankName) ? ' <span class="spy-rank-tag">' + window.getRankName(p.rank) + '</span>' : '') + '</div>'; }).join('') + '</div></div>' +
          '</div>') +
      (host
        ? '<div style="text-align:center;margin-top:16px;"><button class="btn-spy-mode" onclick="startLobbySpy()" style="min-height:44px;font-size:15px;"' + (canStart ? '' : ' disabled') + '>开始内鬼模式 🕵️</button><div style="font-size:12px;color:var(--text-dim);margin-top:4px;">两队各至少1人</div></div>'
        : '<div style="text-align:center;margin-top:12px;font-size:14px;color:var(--text-dim);">等待房主分配队伍...</div>') +
      '<div style="text-align:center;margin-top:12px;"><button class="spy-setup-back" onclick="leaveLobbyRoom()" style="display:inline-block;">离开房间</button></div>' +
      '</div>';
  } else {
    renderLobbyGameView();
  }
}

function renderLobbyGameView() {
  if (lobbyState.phase === 'closed' || lobbyState.phase === 'done') {
    var el = document.getElementById('spyLobbyView');
    if (el) el.innerHTML = '<div class="spy-reveal-card"><div class="spy-reveal-icon">🔒</div><div class="spy-reveal-title">房间已关闭</div><div style="font-size:13px;color:var(--text-dim);text-align:center;margin-bottom:8px;">房主已离开，本次内鬼房间结束。</div><button class="spy-setup-back" onclick="leaveLobbyRoom()">返回</button></div>';
    return;
  }
  var myName = window._currentUserDisplayName || '';
  var isSpy = (myName === lobbyState.team_a_spy_name || myName === lobbyState.team_b_spy_name);
  var teamLabel = (lobbyState.team_a && lobbyState.team_a.some(function(p) { return p.name === myName; })) ? '🔴 A队' : '🔵 B队';
  function rankTagOf(name) {
    var rk = 0; var ps = lobbyState.players || [];
    for (var i = 0; i < ps.length; i++) { if (ps[i].name === name) { rk = ps[i].rank || 0; break; } }
    return (rk && window.getRankName) ? ' <span class="spy-rank-tag">' + window.getRankName(rk) + '</span>' : '';
  }
  var el = document.getElementById('spyLobbyView');
  if (!el) return;
  var codeHtml = '<div style="font-size:14px;font-weight:700;color:var(--accent);text-align:center;margin-bottom:8px;">房间码: ' + lobbyRoomCode + '</div>';

  if (lobbyState.phase === 'revealed') {
    // 内鬼身份
    var taskA = lobbyState.tasks && lobbyState.tasks[lobbyState.team_a_spy_name];
    var taskAD = (taskA != null && window.spyTasks[taskA]) ? window.spyTasks[taskA].icon + ' ' + window.spyTasks[taskA].title : '';
    var taskB = lobbyState.tasks && lobbyState.tasks[lobbyState.team_b_spy_name];
    var taskBD = (taskB != null && window.spyTasks[taskB]) ? window.spyTasks[taskB].icon + ' ' + window.spyTasks[taskB].title : '';
    // 所有玩家任务列表
    var allTaskRows = (lobbyState.players || []).map(function(p, idx) {
      var isSpyP = (p.name === lobbyState.team_a_spy_name || p.name === lobbyState.team_b_spy_name);
      var tIdx = lobbyState.tasks && lobbyState.tasks[p.name];
      var tInfo = (tIdx != null && window.spyTasks[tIdx]) ? window.spyTasks[tIdx].icon + ' ' + window.spyTasks[tIdx].title : '-';
      var teamEmoji = p.team === 'A' ? '🔴' : '🔵';
      return '<div class="spy-reveal-row' + (isSpyP ? ' spy-revealed-spy spy-row-reveal' : ' spy-row-reveal') + '" style="animation-delay:' + (idx * 0.1 + 0.5) + 's;"><span class="spy-reveal-row-team">' + teamEmoji + '</span><span class="spy-reveal-row-name">' + esc(p.name) + rankTagOf(p.name) + (isSpyP ? ' 🕵️' : '') + '</span><span class="spy-reveal-row-task">' + tInfo + '</span></div>';
    }).join('');

    el.innerHTML = codeHtml +
      '<div class="spy-reveal-card"><div class="spy-reveal-icon">🎭</div><div class="spy-reveal-title">内鬼揭晓！</div>' +
      '<div class="spy-reveal-teams">' +
      '<div class="spy-reveal-col"><div class="spy-reveal-team team-a">🔴 A队内鬼</div><div class="spy-reveal-name">' + esc(lobbyState.team_a_spy_name || '-') + rankTagOf(lobbyState.team_a_spy_name) + '</div><div style="font-size:12px;color:var(--text-dim);">' + taskAD + '</div></div>' +
      '<div class="spy-reveal-col"><div class="spy-reveal-team team-b">🔵 B队内鬼</div><div class="spy-reveal-name">' + esc(lobbyState.team_b_spy_name || '-') + rankTagOf(lobbyState.team_b_spy_name) + '</div><div style="font-size:12px;color:var(--text-dim);">' + taskBD + '</div></div>' +
      '</div>' +
      '<div style="margin-top:16px;padding-top:12px;border-top:1px solid color-mix(in srgb,var(--border) 60%,transparent);"><div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px;">📋 所有人任务</div>' +
      '<div class="spy-reveal-all-tasks">' + allTaskRows + '</div></div>' +
      (isHost() ? '<button class="btn-spin" onclick="resetLobbySpy()" style="margin-top:16px;">再来一局 🔄</button>' : '') +
      '<div style="text-align:center;margin-top:12px;"><button class="spy-setup-back" onclick="leaveLobbyRoom()">离开房间</button></div>' +
      '</div>';
  } else {
    // playing: 直接在 lobby view 中渲染
    el.innerHTML = codeHtml +
      '<div class="spy-card-main">' +
      '<div class="spy-setup-card" style="text-align:center;">' +
      (isSpy
        ? '<div class="spy-card-body">' +
          '<div style="font-size:18px;font-weight:900;color:var(--accent);margin-bottom:8px;">🕵️ 你是内鬼！</div>' +
          '<div class="spy-team-label" style="font-size:14px;margin-bottom:12px;">' + teamLabel + '</div>' +
          (function() {
            var idx = lobbyState.tasks && lobbyState.tasks[myName];
            var t = (idx != null && window.spyTasks[idx]) ? window.spyTasks[idx] : null;
            return t ? '<div class="spy-task-card"><span class="spy-task-icon">' + t.icon + '</span><span class="spy-task-title">' + t.title + '</span><div class="spy-task-desc">' + t.desc + '</div></div>' : '';
          })() +
          '<p class="spy-warning">⚠️ 注意隐蔽！完成任务不被发现。</p>' +
          '</div>'
        : '<div class="spy-card-body"><p>✅ 你不是内鬼！</p><p class="spy-hint">队伍：' + teamLabel + '</p>' +
          (function() {
            var idx = lobbyState.tasks && lobbyState.tasks[myName];
            var t = (idx != null && window.spyTasks[idx]) ? window.spyTasks[idx] : null;
            return t ? '<div class="spy-task-card" style="margin-top:12px;"><span class="spy-task-icon">' + t.icon + '</span><span class="spy-task-title">' + t.title + '</span><div class="spy-task-desc">' + t.desc + '</div></div>' : '';
          })() +
          '<p class="spy-hint">你的目标是与队伍一起赢得比赛。</p></div>') +
      (isHost() ? '<button class="btn-spy-mode" onclick="lobbyRevealSpies()" style="margin-top:12px;">揭晓内鬼 🎭</button>' : '<p style="font-size:13px;color:var(--text-dim);margin-top:8px;">等待房主揭晓结果...</p>') +
      '<div style="margin-top:16px;"><button class="spy-setup-back" onclick="leaveLobbyRoom()" style="display:inline-block;">离开房间</button></div>' +
      '</div></div>';
  }
}

async function updatePlayerTeam(name, team) {
  if (!lobbyState || !isHost() || !lobbyRoomCode) return;
  var target = (lobbyState.players || []).find(function(x) { return x.name === name; });
  if (!target || !target.user_id) return;
  try {
    var sb = await getSupabase();
    var result = await sb.rpc('lobby_set_player_team', {
      p_code: lobbyRoomCode, p_user_id: target.user_id, p_team: team
    });
    if (result.error) {
      window.showToast && window.showToast('分配失败: ' + (result.error.message || '未知错误'), 3000);
      return;
    }
    lobbyState = result.data;
    renderSpyLobby();
  } catch (e) { window.showToast && window.showToast('分配失败: ' + e.message, 3000); }
}

async function startLobbySpy() {
  if (!lobbyState || !isHost() || !lobbyRoomCode) return;
  var teamA = lobbyState.players.filter(function(p) { return p.team === 'A'; });
  var teamB = lobbyState.players.filter(function(p) { return p.team === 'B'; });
  if (!teamA.length || !teamB.length) { window.showToast && window.showToast('两队都需要有人', 2000); return; }
  try {
    var sb = await getSupabase();
    var result = await sb.rpc('lobby_start_spy', { p_code: lobbyRoomCode });
    if (result.error) {
      window.showToast && window.showToast('开始失败: ' + (result.error.message || '未知错误'), 3000);
      return;
    }
    lobbyState = result.data;
    renderSpyLobby();
  } catch (e) { window.showToast && window.showToast('开始失败: ' + e.message, 3000); }
}

async function lobbyRevealSpies() {
  if (!lobbyState || !isHost() || !lobbyRoomCode) return;
  try {
    var sb = await getSupabase();
    var result = await sb.rpc('lobby_reveal_spy', { p_code: lobbyRoomCode });
    if (result.error) {
      window.showToast && window.showToast('揭晓失败: ' + (result.error.message || '未知错误'), 3000);
      return;
    }
    lobbyState = result.data;
    renderSpyLobby();
  } catch (e) { window.showToast && window.showToast('揭晓失败: ' + e.message, 3000); }
}

async function resetLobbySpy() {
  if (!isHost() || !lobbyRoomCode) return;
  try {
    var sb = await getSupabase();
    var result = await sb.rpc('lobby_reset_spy', { p_code: lobbyRoomCode });
    if (result.error) {
      window.showToast && window.showToast('重置失败: ' + (result.error.message || '未知错误'), 3000);
      return;
    }
    lobbyState = result.data;
    renderSpyLobby();
  } catch (e) { window.showToast && window.showToast('重置失败: ' + e.message, 3000); }
}

async function leaveLobbyRoom() {
  var code = lobbyRoomCode, uid = (window._currentUser && window._currentUser.id) || null;
  var wasHost = isHost();
  if (code && uid) {
    try {
      var sb = await getSupabase();
      var result = await sb.rpc('lobby_remove_player', { p_code: code, p_user_id: uid });
      if (!result.error && result.data) {
        // data = { spy_state, host_user_id, transferred }
        lobbyState = result.data.spy_state || result.data;
      }
    } catch (e) { /* 忽略 */ }
  }
  if (lobbyChannel) { lobbyChannel.unsubscribe(); lobbyChannel = null; }
  lobbyRoomCode = null; lobbyState = null;
  backToSpyEntry();
}

// ========== 入口工具 ==========
function backToSpyEntry() {
  ['spyStandaloneSetup','spyStandaloneGame','spyQuickRoomSetup','spyQuickRoomResult','spyJoinRoomPanel','spyLobbyView','spyJoinRoomView'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  var entry = document.getElementById('spyStandaloneEntry'); if (entry) entry.style.display = '';
}

function showRoomCodeInput() {
  ['spyLobbyView','spyStandaloneGame','spyQuickRoomResult','spyQuickRoomSetup','spyStandaloneSetup'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  var panel = document.getElementById('spyJoinRoomPanel'); if (panel) panel.style.display = '';
}

function showJoinRoomView() {
  ['spyStandaloneEntry','spyLobbyView','spyStandaloneGame','spyQuickRoomResult','spyQuickRoomSetup','spyStandaloneSetup'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  var view = document.getElementById('spyJoinRoomView'); if (view) view.style.display = '';
  // 自动聚焦输入框
  setTimeout(function() { var i = document.getElementById('joinRoomCodeInput'); if (i) i.focus(); }, 100);
}

function hideRoomCodeInput() {
  var panel = document.getElementById('spyJoinRoomPanel'); if (panel) panel.style.display = 'none';
}

// ========== 暴露到 window ==========
window.initSpyMode = initSpyMode;
window.leaveSpyMode = leaveSpyMode;
window.assignSpies = assignSpies;
window.revealSpies = revealSpies;
window.backToSpyEntry = backToSpyEntry;
window.showRoomCodeInput = showRoomCodeInput;
window.hideRoomCodeInput = hideRoomCodeInput;
window.showJoinRoomView = showJoinRoomView;
window.createSpyLobby = createSpyLobby;
window.joinSpyLobby = joinSpyLobby;
window.updatePlayerTeam = updatePlayerTeam;
window.allowDrop = allowDrop;
window.handleDragLeave = handleDragLeave;
window.dragStart = dragStart;
window.handleDropTeam = handleDropTeam;
window.startLobbySpy = startLobbySpy;
window.lobbyRevealSpies = lobbyRevealSpies;
window.resetLobbySpy = resetLobbySpy;
window.leaveLobbyRoom = leaveLobbyRoom;
window.assignTeamFromCard = assignTeamFromCard;

// 供 app.js 的 switchModule 在切走时退订内鬼 Lobby/桥接 Realtime 频道（遗留 #7）
window.cleanupSpyChannel = function() {
  if (lobbyChannel) { lobbyChannel.unsubscribe(); lobbyChannel = null; }
  if (spyChannel) { spyChannel.unsubscribe(); spyChannel = null; }
};
