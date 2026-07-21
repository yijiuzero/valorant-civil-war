// ========== 内鬼模式模块 (V3 精简版) ==========
let supabase = null;
async function getSupabase() {
  if (supabase) return supabase;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/+esm');
  supabase = createClient('https://scoatqhpwkfhhinjviqr.supabase.co', 'sb_publishable_HRVWyVg47KyE2WJV7zLkSQ_Ap-y7AK-');
  return supabase;
}

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
  var spyA = spyTeamA[Math.floor(Math.random() * spyTeamA.length)];
  var spyB = spyTeamB[Math.floor(Math.random() * spyTeamB.length)];
  var taskA = Math.floor(Math.random() * window.spyTasks.length);
  var taskB = Math.floor(Math.random() * window.spyTasks.length);
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

async function createSpyLobby() {
  var sb = await getSupabase();
  var code = Math.random().toString(36).slice(2, 8).toUpperCase();
  var hostName = window._currentUserDisplayName || '房主';
  var hostId = (window._currentUser && window._currentUser.id) || null;
  var initState = {
    phase: 'lobby', host_name: hostName,
    players: [{ name: hostName, user_id: hostId, team: null }],
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

async function joinSpyLobby(code) {
  var name = window._currentUserDisplayName;
  if (!name || name === '玩家') { window.showToast && window.showToast('请先登录', 3000); return; }
  var sb = await getSupabase();
  var res = await sb.from('rooms').select('spy_state').eq('code', code.toUpperCase()).single();
  if (res.error) { window.showToast && window.showToast('加入失败: ' + (res.error.message || res.error.code), 4000); return; }
  if (!res.data || !res.data.spy_state) { window.showToast && window.showToast('房间不存在', 3000); return; }
  var state = res.data.spy_state;
  var alreadyJoined = state.players && state.players.some(function(p) { return p.name === name; });
  if (state.phase !== 'lobby' && !alreadyJoined) { window.showToast && window.showToast('游戏已开始', 3000); return; }
  if (alreadyJoined && state.phase === 'lobby') { window.showToast && window.showToast('该名字已在房间中', 3000); return; }
  var uid = (window._currentUser && window._currentUser.id) || null;
  state.players.push({ name: name, user_id: uid, team: null });
  await sb.from('rooms').update({ spy_state: state }).eq('code', code.toUpperCase());
  lobbyRoomCode = code; lobbyState = state;
  subscribeSpyLobby(code); showSpyLobbyView();
}

function subscribeSpyLobby(code) {
  if (lobbyChannel) lobbyChannel.unsubscribe();
  var sb = supabase;
  if (!sb) { console.warn('subscribeSpyLobby: supabase not initialized'); return; }
  lobbyChannel = sb.channel('lobby_' + code)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: 'code=eq.' + code },
      function(payload) { if (payload.new && payload.new.spy_state) { lobbyState = payload.new.spy_state; renderSpyLobby(); } })
    .subscribe();
}

function isHost() {
  if (!lobbyState || !window._currentUser) return false;
  return lobbyState.host_name === window._currentUserDisplayName;
}

function showSpyLobbyView() {
  ['spyStandaloneEntry','spyStandaloneSetup','spyStandaloneGame','spyQuickRoomSetup','spyQuickRoomResult','spyJoinRoomPanel'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  var lv = document.getElementById('spyLobbyView'); if (lv) lv.style.display = '';
  renderSpyLobby();
}

function renderSpyLobby() {
  if (!lobbyState) return;
  var el = document.getElementById('spyLobbyView'); if (!el) return;
  var phase = lobbyState.phase, host = isHost();

  var codeHtml = '<div style="display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:16px;">' +
    '<span style="font-size:13px;color:var(--text-dim);">房间码</span>' +
    '<span style="font-size:24px;font-weight:900;color:var(--accent);letter-spacing:3px;">' + lobbyRoomCode + '</span>' +
    '<button class="btn-machine teamsplit-inline-btn" onclick="navigator.clipboard.writeText(\'' + lobbyRoomCode + '\');window.showToast(\'已复制\',2000)" style="min-height:32px;padding:2px 10px;font-size:12px;">📋</button>' +
    '</div>';

  if (phase === 'lobby') {
    var playerCards = lobbyState.players.map(function(p) {
      var t = p.team || '',
          clsA = 'spy-team-btn spy-team-btn-a' + (t === 'A' ? ' active' : ''),
          clsB = 'spy-team-btn spy-team-btn-b' + (t === 'B' ? ' active' : ''),
          btns = host ? '<div class="spy-team-btn-row"><button class="' + clsA + '" onclick="updatePlayerTeam(\'' + esc(p.name) + '\',\'A\')">A</button><button class="' + clsB + '" onclick="updatePlayerTeam(\'' + esc(p.name) + '\',\'B\')">B</button></div>' : '',
          label = t === 'A' ? ' 🔴A' : (t === 'B' ? ' 🔵B' : '');
      return '<div class="spy-player-row"><span>👤 ' + esc(p.name) + label + '</span>' + btns + '</div>';
    }).join('');

    var teamA = lobbyState.players.filter(function(p) { return p.team === 'A'; });
    var teamB = lobbyState.players.filter(function(p) { return p.team === 'B'; });
    var canStart = teamA.length >= 1 && teamB.length >= 1;
    var teamPreview = '';
    if (teamA.length || teamB.length) {
      teamPreview = '<div class="spy-team-preview" style="margin-top:12px;">' +
        '<div class="spy-team-col"><div class="spy-team-label team-a">🔴 A队 (' + teamA.length + '人)</div><div class="spy-team-players">' + teamA.map(function(p) { return '<div class="spy-team-member">' + esc(p.name) + '</div>'; }).join('') + '</div></div>' +
        '<div class="spy-team-col"><div class="spy-team-label team-b">🔵 B队 (' + teamB.length + '人)</div><div class="spy-team-players">' + teamB.map(function(p) { return '<div class="spy-team-member">' + esc(p.name) + '</div>'; }).join('') + '</div></div>' +
        '</div>';
    }
    el.innerHTML = codeHtml +
      '<div class="spy-setup-card">' +
      '<div class="spy-setup-head"><span>🎮 等待玩家加入（' + lobbyState.players.length + '人）</span></div>' +
      '<div class="spy-player-list">' + playerCards + '</div>' + teamPreview +
      '<div style="font-size:13px;color:var(--text-dim);text-align:center;margin-bottom:12px;">群友登录后在"内鬼模式→加入线上房间"输入房间码</div>' +
      (host
        ? '<div style="text-align:center;"><button class="btn-spy-mode" onclick="startLobbySpy()" style="min-height:44px;font-size:15px;"' + (canStart ? '' : ' disabled') + '>开始内鬼模式 🕵️</button><div style="font-size:12px;color:var(--text-dim);margin-top:4px;">两队各至少1人</div></div>'
        : '<div style="text-align:center;font-size:14px;color:var(--text-dim);">等待房主分配队伍...</div>') +
      '<div style="text-align:center;margin-top:12px;"><button class="spy-setup-back" onclick="leaveLobbyRoom()" style="display:inline-block;">离开房间</button></div>' +
      '</div>';
  } else {
    renderLobbyGameView();
  }
}

function renderLobbyGameView() {
  var myName = window._currentUserDisplayName || '';
  var isSpy = (myName === lobbyState.team_a_spy_name || myName === lobbyState.team_b_spy_name);
  var teamLabel = (lobbyState.team_a && lobbyState.team_a.indexOf(myName) !== -1) ? '🔴 A队' : '🔵 B队';
  var el = document.getElementById('spyLobbyView');
  if (!el) return;
  var codeHtml = '<div style="font-size:14px;font-weight:700;color:var(--accent);text-align:center;margin-bottom:8px;">房间码: ' + lobbyRoomCode + '</div>';

  if (lobbyState.phase === 'revealed') {
    var taskA = lobbyState.tasks && lobbyState.tasks[lobbyState.team_a_spy_name];
    var taskAD = (taskA != null && window.spyTasks[taskA]) ? '任务：' + window.spyTasks[taskA].icon + ' ' + window.spyTasks[taskA].title : '';
    var taskB = lobbyState.tasks && lobbyState.tasks[lobbyState.team_b_spy_name];
    var taskBD = (taskB != null && window.spyTasks[taskB]) ? '任务：' + window.spyTasks[taskB].icon + ' ' + window.spyTasks[taskB].title : '';
    el.innerHTML = codeHtml +
      '<div class="spy-reveal-card"><div class="spy-reveal-icon">🎭</div><div class="spy-reveal-title">内鬼身份揭晓！</div>' +
      '<div class="spy-reveal-teams">' +
      '<div class="spy-reveal-col"><div class="spy-reveal-team team-a">🔴 A队内鬼</div><div class="spy-reveal-name">' + esc(lobbyState.team_a_spy_name || '-') + '</div><div style="font-size:12px;color:var(--text-dim);">' + taskAD + '</div></div>' +
      '<div class="spy-reveal-col"><div class="spy-reveal-team team-b">🔵 B队内鬼</div><div class="spy-reveal-name">' + esc(lobbyState.team_b_spy_name || '-') + '</div><div style="font-size:12px;color:var(--text-dim);">' + taskBD + '</div></div>' +
      '</div>' +
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
  var p = lobbyState.players.find(function(x) { return x.name === name; });
  if (!p) return;
  p.team = p.team === team ? null : team;
  await (await getSupabase()).from('rooms').update({ spy_state: lobbyState }).eq('code', lobbyRoomCode);
}

async function startLobbySpy() {
  if (!lobbyState || !isHost() || !lobbyRoomCode) return;
  var teamA = lobbyState.players.filter(function(p) { return p.team === 'A'; });
  var teamB = lobbyState.players.filter(function(p) { return p.team === 'B'; });
  if (!teamA.length || !teamB.length) { window.showToast && window.showToast('两队都需要有人', 2000); return; }
  lobbyState.team_a = teamA.map(function(p) { return p.name; });
  lobbyState.team_b = teamB.map(function(p) { return p.name; });
  lobbyState.team_a_spy_name = lobbyState.team_a[Math.floor(Math.random() * lobbyState.team_a.length)];
  lobbyState.team_b_spy_name = lobbyState.team_b[Math.floor(Math.random() * lobbyState.team_b.length)];
  // 给所有人分配任务（扰乱视野，存索引）
  lobbyState.tasks = {};
  var allNames = lobbyState.players.map(function(p) { return p.name; });
  var shuffled = window.spyTasks.slice();
  for (var i = shuffled.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i+1)); var t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t; }
  allNames.forEach(function(name, idx) {
    lobbyState.tasks[name] = idx % shuffled.length; // 存的是 spyTasks 原始索引
  });
  lobbyState.phase = 'playing';
  await (await getSupabase()).from('rooms').update({ spy_state: lobbyState }).eq('code', lobbyRoomCode);
}

async function lobbyRevealSpies() {
  if (!lobbyState || !isHost() || !lobbyRoomCode) return;
  lobbyState.phase = 'revealed';
  await (await getSupabase()).from('rooms').update({ spy_state: lobbyState }).eq('code', lobbyRoomCode);
}

async function resetLobbySpy() {
  if (!isHost() || !lobbyRoomCode) return;
  lobbyState.phase = 'lobby'; lobbyState.team_a = []; lobbyState.team_b = [];
  lobbyState.team_a_spy_name = null; lobbyState.team_b_spy_name = null; lobbyState.tasks = {};
  lobbyState.players.forEach(function(p) { p.team = null; });
  await (await getSupabase()).from('rooms').update({ spy_state: lobbyState }).eq('code', lobbyRoomCode);
}

async function leaveLobbyRoom() {
  var code = lobbyRoomCode, name = window._currentUserDisplayName;
  // 房主离开 → 通知其他人房间已关闭
  if (isHost() && lobbyState && code) {
    try {
      lobbyState.phase = 'closed';
      await (await getSupabase()).from('rooms').update({ spy_state: lobbyState }).eq('code', code);
    } catch (e) { /* 忽略 */ }
  } else if (name && lobbyState && code) {
    try {
      lobbyState.players = lobbyState.players.filter(function(p) { return p.name !== name; });
      await (await getSupabase()).from('rooms').update({ spy_state: lobbyState }).eq('code', code);
    } catch (e) { /* 忽略 */ }
  }
  if (lobbyChannel) { lobbyChannel.unsubscribe(); lobbyChannel = null; }
  lobbyRoomCode = null; lobbyState = null;
  backToSpyEntry();
}

// ========== 入口工具 ==========
function backToSpyEntry() {
  ['spyStandaloneSetup','spyStandaloneGame','spyQuickRoomSetup','spyQuickRoomResult','spyJoinRoomPanel','spyLobbyView'].forEach(function(id) {
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
window.createSpyLobby = createSpyLobby;
window.joinSpyLobby = joinSpyLobby;
window.updatePlayerTeam = updatePlayerTeam;
window.startLobbySpy = startLobbySpy;
window.lobbyRevealSpies = lobbyRevealSpies;
window.resetLobbySpy = resetLobbySpy;
window.leaveLobbyRoom = leaveLobbyRoom;
