// ========== 内鬼模式模块 (V3 精简版) ==========
async function getSupabase() { return await window._getSupabase(); }

// ========== 我的内鬼身份（服务端下发）==========
// 内鬼身份已从 rooms.spy_state 移入服务端独立表 spy_identities（见 migrate-spy-secrets.sql）。
// 客户端不再持有"谁是不是内鬼"，只由服务端告诉我"我是不是内鬼 + 我的任务"。
// 结构：{ phase, is_spy, team, task, players }
let myIdentity = null;

// ========== 工具函数 ==========
// 转义 & " ' < > —— 同时覆盖 HTML 文本节点与双引号/单引号属性两种上下文。
// 历史缺陷：原实现走 div.textContent → innerHTML 往返，浏览器只转义 & < >，
// 不转义引号。昵称含 " 时可闭合 data-name="..." 属性并注入 on* 事件处理器
// （存储型 XSS，可窃取 Supabase token 冒充房主）。
function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
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
          // 内鬼身份不在 spy_state 里，每次状态变化都要向服务端重新确认
          refreshBridgeIdentity();
        }
      })
    .subscribe();
}

// 桥接路径（内战分队 → 内鬼模式）的身份查询。
// 与 lobby 路径分开，避免污染 lobbyRoomCode / lobbyChannel 等 lobby 专属状态。
async function refreshBridgeIdentity() {
  if (!spyRoomCode) return;
  try {
    var sb = await getSupabase();
    var res = await sb.rpc('lobby_get_my_spy', { p_code: spyRoomCode });
    if (res.error) {
      // RPC 不存在（SQL 迁移脚本尚未执行）时静默降级，兼容过渡期
      console.warn('[spy] lobby_get_my_spy 不可用（需先执行 migrate-spy-secrets.sql）：', res.error && res.error.message);
      return;
    }
    if (res.data) { myIdentity = res.data; renderCurrentPhase(); }
  } catch (e) {
    console.warn('[spy] 桥接身份查询异常：', e);
  }
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
  // 身份写入服务端独立表 spy_identities，spy_state 里不再存任何内鬼标识。
  // ⚠️ spy_id 必须用 user_id（auth.uid() 空间）：lobby_get_my_spy 按 auth.uid()
  // 比对判断"我是不是内鬼"。历史缺陷：这里传的是 players 行 ID，与服务端
  // 比对的 ID 空间永远对不上 → is_spy 恒为 false → 内鬼面板谁也不显示，
  // 且没有任何报错（静默死亡，2026-10-14 静态核对定位）。
  // tasks 键同步改用 user_id；服务端 lobby_get_my_spy 按 name 查任务会落空，
  // 由 renderSpyPlaying 的 fallback（spyState.tasks[spyUserId]）兜底。
  var newState = { phase: 'playing', tasks: {}, revealed: false };
  newState.tasks[String(spyA.user_id)] = taskA;
  newState.tasks[String(spyB.user_id)] = taskB;
  try {
    var sb = await getSupabase();
    // 1) 先写独立表（仅房主可写，有 RLS 保护）
    var setRes = await sb.rpc('lobby_set_spy_identity', {
      p_code: spyRoomCode,
      p_spy_a_id: String(spyA.user_id), p_spy_b_id: String(spyB.user_id),
      p_spy_a_name: spyA.name, p_spy_b_name: spyB.name
    });
    if (setRes.error) {
      // RPC 不存在（SQL 迁移脚本尚未执行）时降级：不阻断旧流程
      console.warn('[spy] lobby_set_spy_identity 不可用（需先执行 migrate-spy-secrets.sql）：', setRes.error.message);
    }
    // 2) 再合并更新 spy_state（不含内鬼标识）。
    // 历史缺陷：原为整体覆盖，把 teamsplit 写入的 split 数据当场抹掉（P1-h 实证路径），
    // 先读当前值做字段级合并；根治仍靠服务端 RPC 单事务合并（待办）。
    var curRes = await sb.from('rooms').select('spy_state').eq('code', spyRoomCode).single();
    if (curRes.error) throw curRes.error;
    var merged = Object.assign({}, (curRes.data && curRes.data.spy_state) || {}, newState);
    var result = await sb.from('rooms').update({ spy_state: merged }).eq('code', spyRoomCode);
    if (result.error) throw result.error;
    spyState = merged; renderSpyPlaying();
    // 3) 立即向服务端确认自己身份（房主可能正是内鬼，需立刻看到自己的任务）
    refreshBridgeIdentity();
  } catch (e) { window.showToast && window.showToast('分配失败: ' + e.message, 3000); }
}

function renderSpyAssigning() { showSpyView('spyAssigning'); }

function renderSpyPlaying() {
  showSpyView('spyPlaying');
  if (!spyState) return;
  // 内鬼身份由服务端判定（myIdentity.is_spy），本地不再持有 team_*_spy
  var isSpy = !!(myIdentity && myIdentity.is_spy === true);
  var spyPanel = document.getElementById('spyIdentityPanel');
  var normalPanel = document.getElementById('spyNormalPanel');
  if (spyPanel) spyPanel.style.display = isSpy ? '' : 'none';
  if (normalPanel) normalPanel.style.display = isSpy ? 'none' : '';
  if (isSpy) {
    var teamLabel = (myIdentity && myIdentity.team === 'A') ? '🔴 A队' : '🔵 B队';
    var who = document.getElementById('spyTeamLabel'); if (who) who.textContent = teamLabel;
    // 服务端按 name 查任务在桥接路径会落空（桥接 tasks 以 user_id 为键），
    // 用本地 user_id 再查一次兜底；spyUserId 与 auth.uid() 同空间。
    var taskIdx = (myIdentity && myIdentity.task != null) ? myIdentity.task
                : spyState.tasks[String(spyUserId)];
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
  // 仪式感延迟：先揭晓中...
  renderSpyAssigning();
  await new Promise(r => setTimeout(r, 1200));
  try {
    var sb = await getSupabase();
    // 由服务端把身份从独立表写回 spy_state 并置 revealed（客户端不持有身份）
    var res = await sb.rpc('spy_reveal_bridge', { p_code: spyRoomCode });
    if (res.error) {
      window.showToast && window.showToast('揭晓失败: ' + (res.error.message || '未知错误'), 3000);
      return;
    }
    if (res.data) spyState = res.data;
    renderSpyRevealed();
    myIdentity = null; // 揭晓后身份已公开，无需再查
  } catch (e) { window.showToast && window.showToast('揭晓失败: ' + e.message, 3000); }
}

function renderSpyRevealed() {
  showSpyView('spyRevealed');
  if (!spyState) return;
  // 揭晓后服务端已把 team_*_spy_id 写回 spy_state（此刻公开是设计意图）。
  // 该 ID 是 user_id（auth.uid() 空间），必须按 user_id 查找——
  // 历史缺陷：原按 players 行 ID（p.id）查找，永远匹配不上，揭晓页显示「未知」。
  var spyA = findPlayerByUserId(spyState.team_a_spy_id), spyB = findPlayerByUserId(spyState.team_b_spy_id);
  var aName = document.getElementById('revealSpyA'), bName = document.getElementById('revealSpyB');
  if (aName) aName.textContent = spyA ? spyA.name : '未知';
  if (bName) bName.textContent = spyB ? spyB.name : '未知';
  var taskA = window.spyTasks[spyState.tasks[String(spyState.team_a_spy_id)]];
  var taskB = window.spyTasks[spyState.tasks[String(spyState.team_b_spy_id)]];
  var at = document.getElementById('revealTaskA'), bt = document.getElementById('revealTaskB');
  if (at && taskA) at.textContent = taskA.icon + ' ' + taskA.title + '：' + taskA.desc;
  if (bt && taskB) bt.textContent = taskB.icon + ' ' + taskB.title + '：' + taskB.desc;
  // 触发动画
  var cols = document.querySelectorAll('.spy-reveal-col');
  cols.forEach(function(col) { col.classList.remove('reveal-animate'); void col.offsetWidth; col.classList.add('reveal-animate'); });
  var names = document.querySelectorAll('.spy-reveal-name');
  names.forEach(function(n) { n.classList.remove('spy-name-flash'); void n.offsetWidth; n.classList.add('spy-name-flash'); });
}

// 按 user_id 查找玩家（供揭晓视图按 team_*_spy_id 定位内鬼）。
// 注意：DOM  self 高亮用的 data-pid 仍是 players 行 ID 空间（teamsplit 预览渲染），
// 两套 ID 各有用途，不要混用。
function findPlayerByUserId(uid) {
  return spyTeamA.concat(spyTeamB).find(function(p) { return String(p.user_id) === String(uid); });
}

function leaveSpyMode() {
  if (spyChannel) { spyChannel.unsubscribe(); spyChannel = null; }
  spyState = null; spyRoomCode = null;
}

async function initSpyMode(ctx) {
  setupSpyContext(ctx);
  await loadSpyState();
  subscribeSpyState();
  // 桥接路径同样走服务端身份判定（内鬼身份已移入服务端独立表）
  refreshBridgeIdentity();
}

// ========== 在线 Lobby 房间 ==========
let lobbyChannel = null, lobbyRoomCode = null, lobbyState = null;

// 我的内鬼身份，由 RPC lobby_get_my_spy 按调用者下发。
// 为什么不能客户端自己算：修复前内鬼姓名明文存在 rooms.spy_state 里，
// 任何登录用户（甚至 anon）都能直接读走，内鬼模式的核心玩法形同虚设。
// 现在服务端只告诉我"我是不是内鬼 + 我的任务"，别人是不是内鬼我不该知道。
// （myIdentity 声明在文件顶部，供桥接与lobby 两条路径共用）

async function refreshMyIdentity() {
  if (!lobbyRoomCode) return;
  try {
    var sb = await getSupabase();
    var res = await sb.rpc('lobby_get_my_spy', { p_code: lobbyRoomCode });
    if (res.error) {
      // RPC 不存在（SQL 迁移脚本尚未执行）时静默降级，兼容过渡期
      console.warn('[spy] lobby_get_my_spy 调用失败：', res.error && res.error.message);
      return;
    }
    if (res.data) { myIdentity = res.data; renderSpyLobby(); }
  } catch (e) {
    console.warn('[spy] 拉取身份异常：', e);
  }
}

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
    // 注意：不再初始化 team_a_spy_name / team_b_spy_name。
    // 内鬼身份在开始时由服务端写入独立表 spy_identities，客户端一律拿不到。
    tasks: {}
  };
  try {
    await sb.from('rooms').insert({ code: code, status: 'lobby', host_user_id: hostId, spy_state: initState });
    lobbyRoomCode = code; lobbyState = initState; myIdentity = null;
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
    // 可能是中途加入：向服务端确认自己当前身份
    refreshMyIdentity();
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
            // 内鬼身份不在 spy_state 里（已移入服务端独立表），
            // 因此每次状态变化都要向服务端重新确认「我是不是内鬼」
            refreshMyIdentity();
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
  // 内鬼身份由服务端下发（myIdentity.is_spy），不再用昵称比对 spy_state
  var isSpy = !!(myIdentity && myIdentity.is_spy === true);
  var myTaskIdx = (myIdentity && myIdentity.task != null) ? myIdentity.task : null;
  var myTeam = (myIdentity && myIdentity.team) ? myIdentity.team : null;
  var teamLabel = myTeam === 'A' ? '🔴 A队' : (myTeam === 'B' ? '🔵 B队' : '');
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
    var taskAD = (taskA != null && window.spyTasks[taskA]) ? window.spyTasks[taskA].icon + ' ' + esc(window.spyTasks[taskA].title) : '';
    var taskB = lobbyState.tasks && lobbyState.tasks[lobbyState.team_b_spy_name];
    var taskBD = (taskB != null && window.spyTasks[taskB]) ? window.spyTasks[taskB].icon + ' ' + esc(window.spyTasks[taskB].title) : '';
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
          // 任务索引由服务端 lobby_get_my_spy 直接下发（myIdentity.task）
          (function() {
            var t = (myTaskIdx != null && window.spyTasks[myTaskIdx]) ? window.spyTasks[myTaskIdx] : null;
            return t ? '<div class="spy-task-card"><span class="spy-task-icon">' + t.icon + '</span><span class="spy-task-title">' + esc(t.title) + '</span><div class="spy-task-desc">' + esc(t.desc) + '</div></div>' : '';
          })() +
          '<p class="spy-warning">⚠️ 注意隐蔽！完成任务不被发现。</p>' +
          '</div>'
        : '<div class="spy-card-body"><p>✅ 你不是内鬼！</p><p class="spy-hint">队伍：' + teamLabel + '</p>' +
          (function() {
            var t = (myTaskIdx != null && window.spyTasks[myTaskIdx]) ? window.spyTasks[myTaskIdx] : null;
            return t ? '<div class="spy-task-card" style="margin-top:12px;"><span class="spy-task-icon">' + t.icon + '</span><span class="spy-task-title">' + esc(t.title) + '</span><div class="spy-task-desc">' + esc(t.desc) + '</div></div>' : '';
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
    // 内鬼身份已由服务端写入独立表，此刻立即确认自己是否内鬼
    refreshMyIdentity();
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
    // 揭晓后服务端已把内鬼姓名写回 spy_state，无需再查身份
    myIdentity = null;
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
    // 重置后服务端已清空身份记录，本地也必须清，否则会残留上一局的内鬼身份
    myIdentity = null;
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

// 登出 / 换号时由 auth.js:handleSessionLost 统一调用。
// 退订两条路径的频道 + 清空全部身份缓存。cleanupSpyChannel 只退订不清状态，
// 若不额外清理，上一位用户的 lobbyState 会残留，导致下一位登录者进入同房间码时
// 渲染出上一位的内鬼面板（"你是内鬼！"闪现）。
window.resetSpyIdentity = function() {
  if (lobbyChannel) { lobbyChannel.unsubscribe(); lobbyChannel = null; }
  if (spyChannel) { spyChannel.unsubscribe(); spyChannel = null; }
  spyUserId = null; spyPlayerId = null; spyHostUserId = null; spyRoomCode = null;
  spyTeamA = []; spyTeamB = []; spyState = null;
  lobbyRoomCode = null; lobbyState = null;
  myIdentity = null;
};
