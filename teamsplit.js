// ========== 内战分队模块 ==========
// 复用全局 Supabase 实例（与 auth.js / spy-mode.js 统一），
// 避免双实例导致的 session / 房主身份判定不一致
const supabase = await window._getSupabase();

let currentRoomCode = null;
let currentPlayerId = null;
let currentPlayerName = '';
let currentUserId = null;
let currentHostUserId = null;
let roomSubscription = null;
let isLeaving = false;
let currentPlayers = [];

// ========== 身份获取 ==========
async function getUserId() {
  if (currentUserId) return currentUserId;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      currentUserId = session.user.id;
      return currentUserId;
    }
  } catch (e) {}
  // 未登录：不再匿名登录（与"内战分队强制登录"一致），交由守卫/UI 提示去登录
  return null;
}

// ========== 工具函数 ==========
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const array = new Uint32Array(6);
  crypto.getRandomValues(array);
  return Array.from(array, x => chars[x % chars.length]).join('');
}

function showTeamsplitView(view) {
  const createEl = document.getElementById('teamsplitCreate');
  const lobbyEl = document.getElementById('teamsplitLobby');
  const resultEl = document.getElementById('teamsplitResult');
  const spyEl = document.getElementById('teamsplitSpy');
  if (createEl) createEl.style.display = 'none';
  if (lobbyEl) lobbyEl.style.display = 'none';
  if (resultEl) { resultEl.style.display = 'none'; resultEl.classList.remove('slide-left','slide-right'); }
  if (spyEl) spyEl.style.display = 'none';
  if (view === 'create' && createEl) createEl.style.display = '';
  else if (view === 'lobby' && lobbyEl) lobbyEl.style.display = '';
  else if (view === 'result' && resultEl) {
    resultEl.style.display = '';
    // 触发对决入场动画
    const teamA = resultEl.querySelector('.teamsplit-team:first-child');
    const teamB = resultEl.querySelector('.teamsplit-team:last-child');
    const vs = resultEl.querySelector('.teamsplit-vs');
    if (teamA) { teamA.classList.remove('slide-left'); void teamA.offsetWidth; teamA.classList.add('slide-left'); }
    if (teamB) { teamB.classList.remove('slide-right'); void teamB.offsetWidth; teamB.classList.add('slide-right'); }
    if (vs) { vs.classList.remove('animate-vs'); void vs.offsetWidth; vs.classList.add('animate-vs'); }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getRankName(rank) {
  const names = ['', '黑铁', '青铜', '白银', '黄金', '铂金', '钻石', '超凡', '神话', '赋能'];
  return names[rank] || '';
}

function getRankIcon(rank) {
  const seasonUuid = window.VALORANT_SEASON_UUID || '564d8e28-c226-3180-6285-e48a390db8b1';
  const t = rank * 3;
  return VALORANT_API + '/competitivetiers/' + seasonUuid + '/' + t + '/smallicon.png';
}
window.getRankName = getRankName;
window.getRankIcon = getRankIcon;

function teamRow(p) {
  const pr = p.rank || 0;
  return '<div class="teamsplit-player-row">' + escapeHtml(p.name) + (pr ? '<span class="teamsplit-rank-tag">' + getRankName(pr) + '</span>' : '') + '</div>';
}

// ========== UI 更新 ==========
function updatePlayerList(players) {
  const list = document.getElementById('playerList');
  const count = document.getElementById('playerCount');
  if (!list || !count) return;
  currentPlayers = players || [];
  const isHost = isCurrentUserHost();
  count.textContent = players.length;
  if (players.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-text">还没有人加入<br>分享房间码给好友吧</div></div>';
    list.style.display = 'flex';
    list.style.alignItems = 'center';
    list.style.justifyContent = 'center';
  } else {
    list.innerHTML = players.map(function(p) {
      const cls = p.id === currentPlayerId ? ' self' : '';
      const hostBadge = p.user_id === currentHostUserId ? '<span class="teamsplit-host-badge">房主</span>' : '';
      const pRank = p.rank || 0;
      const rankIcon = pRank ? '<img class="teamsplit-rank-icon" src="' + getRankIcon(pRank) + '" alt="' + getRankName(pRank) + '" title="' + getRankName(pRank) + '" loading="lazy">' : '';
      let kickBtn = '';
      if (isHost && p.id !== currentPlayerId) {
        kickBtn = '<button class="teamsplit-kick-btn" data-pid="' + p.id + '" title="踢出玩家">&times;</button>';
      }
      return '<div class="teamsplit-player-chip' + cls + '">' + rankIcon + escapeHtml(p.name) + hostBadge + kickBtn + '</div>';
    }).join('');
    list.style.display = '';
    list.style.alignItems = '';
    list.style.justifyContent = '';
  }
    const cls = p.id === currentPlayerId ? ' self' : '';
    const hostBadge = p.user_id === currentHostUserId ? '<span class="teamsplit-host-badge">房主</span>' : '';
    const pRank = p.rank || 0;
    const rankIcon = pRank ? '<img class="teamsplit-rank-icon" src="' + getRankIcon(pRank) + '" alt="' + getRankName(pRank) + '" title="' + getRankName(pRank) + '" loading="lazy">' : '';
    let kickBtn = '';
    if (isHost && p.id !== currentPlayerId) {
      kickBtn = '<button class="teamsplit-kick-btn" data-pid="' + p.id + '" title="踢出玩家">&times;</button>';
    }
    return '<div class="teamsplit-player-chip' + cls + '">' + rankIcon + escapeHtml(p.name) + hostBadge + kickBtn + '</div>';
  }).join('');
  list.querySelectorAll('.teamsplit-kick-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const pid = parseInt(this.dataset.pid);
      const target = currentPlayers.find(function(p) { return p.id === pid; });
      if (target && confirm('确定要踢出「' + target.name + '」吗？')) {
        kickPlayer(pid);
      }
    });
  });
  updateHostControls(isHost, currentPlayers.length);
}

function isCurrentUserHost() {
  return !!currentUserId && currentUserId === currentHostUserId;
}

function updateHostControls(isHost, playerCount) {
  const rankBtn = document.getElementById('btnDoSplitRank');
  const randomBtn = document.getElementById('btnDoSplitRandom');
  if (rankBtn) {
    rankBtn.disabled = playerCount < 2 || !isHost;
    rankBtn.textContent = isHost ? '段位分队 ⚖️' : '仅房主可分队';
  }
  if (randomBtn) {
    randomBtn.disabled = playerCount < 2 || !isHost;
    randomBtn.textContent = isHost ? '随机分队 🎲' : '仅房主可分队';
  }
  const resetBtn = document.getElementById('btnResetSplit');
  if (resetBtn) resetBtn.disabled = !isHost;
  const hostHint = document.getElementById('teamsplitHostHint');
  if (hostHint) {
    if (!currentPlayerId) hostHint.textContent = '加入后可查看房主权限';
    else hostHint.textContent = isHost ? '你是房主，可以开始或重新分队' : '仅房主可以开始或重新分队';
  }
}

async function cleanupOldRooms() {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const oldDone = await supabase.from('rooms').select('code').eq('status', 'done').lt('created_at', oneDayAgo);
    if (oldDone.data && oldDone.data.length > 0) {
      const doneCodes = oldDone.data.map(function(r) { return r.code; });
      await supabase.from('players').delete().in('room_code', doneCodes);
      await supabase.from('rooms').delete().in('code', doneCodes);
    }
    const oldWaiting = await supabase.from('rooms').select('code').eq('status', 'waiting').lt('created_at', twoHoursAgo);
    if (oldWaiting.data && oldWaiting.data.length > 0) {
      const waitingCodes = oldWaiting.data.map(function(r) { return r.code; });
      await supabase.from('players').delete().in('room_code', waitingCodes);
      await supabase.from('rooms').delete().in('code', waitingCodes);
    }
    // 清理过期 Lobby 房间（>2h）
    const oldLobby = await supabase.from('rooms').select('code').eq('status', 'lobby').lt('created_at', twoHoursAgo);
    if (oldLobby.data && oldLobby.data.length > 0) {
      const lobbyCodes = oldLobby.data.map(function(r) { return r.code; });
      await supabase.from('rooms').delete().in('code', lobbyCodes);
    }
  } catch (e) {}
}

async function createRoom() {
  const code = generateRoomCode();
  try {
    const userId = await getUserId();
    if (!userId) throw new Error('身份初始化失败，请刷新重试');
    const insertData = { code: code, status: 'waiting', host_user_id: userId };
    const result = await supabase.from('rooms').insert(insertData).select().single();
    if (result.error) throw result.error;
    currentRoomCode = code;
    currentPlayers = [];
    currentHostUserId = userId;
    const codeDisplay = document.getElementById('roomCodeDisplay');
    codeDisplay.textContent = code;
    codeDisplay.style.cursor = 'pointer';
    codeDisplay.title = '点击复制房间码';
    showTeamsplitView('lobby');
    updatePlayerList([]);
    subscribeToRoom(code);
    // 房主自动加入，并主动拉取最新列表
    // （避免房主自己的 INSERT 实时事件与订阅建立竞态，导致房主不在列表中、无法分队）
    await autoJoinLobby();
    await refreshPlayers();
  } catch (e) {
    showToast('创建房间失败: ' + e.message, 3000);
  }
}

async function joinRoom() {
  const raw = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  const code = raw.replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!code) { showToast('请输入有效的房间码', 2000); return; }
  try {
    await getUserId();
    const result = await supabase.from('rooms').select('*').eq('code', code).eq('status', 'waiting').single();
    if (result.error || !result.data) throw new Error('房间不存在或已开始');
    currentRoomCode = code;
    currentHostUserId = result.data.host_user_id || null;
    const codeDisplay = document.getElementById('roomCodeDisplay');
    codeDisplay.textContent = code;
    codeDisplay.style.cursor = 'pointer';
    codeDisplay.title = '点击复制房间码';
    showTeamsplitView('lobby');
    subscribeToRoom(code);
    await refreshPlayers();
    // 尝试恢复之前的身份
    var autoJoined = await tryAutoJoin(code);
    if (!autoJoined) autoJoinLobby();
  } catch (e) {
    showToast('加入房间失败: ' + e.message, 3000);
  }
}

async function autoJoinLobby() {
  var name = window._currentUserDisplayName;
  if (!name || name === '玩家') { showToast('请先登录', 2000); return; }
  if (!currentRoomCode || currentPlayerId) return;
  if (currentPlayers && currentPlayers.length >= 10) { showToast('房间已满（最多10人）', 2000); return; }
  var rank = window._currentUserRank || 0;
  var rankSel = document.getElementById('playerRankSelect');
  if (!rank && rankSel && rankSel.value) {
    rank = parseInt(rankSel.value, 10);
    try { await supabase.auth.updateUser({ data: { rank: rank } }); window._currentUserRank = rank; } catch (e) {}
  }
  if (!rank) { if (rankSel) rankSel.style.display = ''; showToast('请选择你的段位', 2000); return; }
  if (rank < 1 || rank > 9) { showToast('段位无效', 2000); return; }
  try {
    var userId = await getUserId();
    // 检查重名
    var dupResult = await supabase.from('players').select('id,name').eq('room_code', currentRoomCode).ilike('name', name);
    if (dupResult.data && dupResult.data.length > 0) {
      // 可能是自己（之前离开又回来）
      var existing = dupResult.data[0];
      currentPlayerId = existing.id;
      localStorage.setItem('ts_player_' + currentRoomCode, currentPlayerId);
      localStorage.setItem('ts_player_name', name);
      localStorage.setItem('ts_player_rank', String(rank));
      currentPlayerName = name;
      showToast('已恢复身份', 2000);
      return;
    }
    var insertData = { room_code: currentRoomCode, name: name, rank: rank };
    if (userId) insertData.user_id = userId;
    var insertResult = await supabase.from('players').insert(insertData).select().single();
    if (insertResult.error) throw insertResult.error;
    currentPlayerId = insertResult.data.id;
    localStorage.setItem('ts_player_' + currentRoomCode, currentPlayerId);
    localStorage.setItem('ts_player_name', name);
    localStorage.setItem('ts_player_rank', String(rank));
    currentPlayerName = name;
    if (rankSel) { rankSel.value = ''; rankSel.style.display = 'none'; }
    showToast('已加入分队', 2000);
  } catch (e) { showToast('加入失败: ' + e.message, 3000); }
}

async function joinLobby() {
  var name = document.getElementById('playerNameInput').value.trim();
  if (!name) name = window._currentUserDisplayName || '';
  if (!name || name === '玩家') { showToast('请输入你的名字', 2000); return; }
  if (!currentRoomCode) return;
  if (currentPlayerId) { showToast('你已经在房间中了', 2000); return; }
  if (currentPlayers && currentPlayers.length >= 10) { showToast('房间已满（最多10人）', 2000); return; }
  try {
    const roomCheck = await supabase.from('rooms').select('status').eq('code', currentRoomCode).single();
    if (roomCheck.data && roomCheck.data.status === 'done') {
      showToast('该房间已分队完毕，请创建或加入其他房间', 3000);
      return;
    }
  } catch (e) {}
  const rankSel = document.getElementById('playerRankSelect');
  let rank = window._currentUserRank || 0;
  if (!rank && rankSel && rankSel.value) {
    rank = parseInt(rankSel.value, 10);
    try { await supabase.auth.updateUser({ data: { rank: rank } }); window._currentUserRank = rank; } catch (e) {}
  }
  if (!rank) { if (rankSel) rankSel.style.display = ''; showToast('请选择你的段位', 2000); return; }
  if (rank < 1 || rank > 9) { showToast('段位无效', 2000); return; }
  try {
    const userId = await getUserId();
    const savedId = localStorage.getItem('ts_player_' + currentRoomCode);
    let dupQuery = supabase.from('players').select('id,name').eq('room_code', currentRoomCode).ilike('name', name);
    if (savedId) dupQuery = dupQuery.neq('id', savedId);
    const dupResult = await dupQuery;
    if (dupResult.data && dupResult.data.length > 0) {
      showToast('名字「' + dupResult.data[0].name + '」已被使用，换一个吧', 3000);
      return;
    }
    const insertData = { room_code: currentRoomCode, name: name, rank: rank };
    if (userId) insertData.user_id = userId;
    const insertResult = await supabase.from('players').insert(insertData).select().single();
    if (insertResult.error) throw insertResult.error;
    currentPlayerId = insertResult.data.id;
    localStorage.setItem('ts_player_' + currentRoomCode, currentPlayerId);
    localStorage.setItem('ts_player_name', name);
    localStorage.setItem('ts_player_rank', rank);
    currentPlayerName = name;
    document.getElementById('playerNameInput').value = '';
    if (rankSel) { rankSel.value = ''; rankSel.style.display = 'none'; }
    showToast('已加入分队', 2000);
  } catch (e) {
    showToast('加入失败: ' + e.message, 3000);
  }
}

async function tryAutoJoin(code) {
  const userId = await getUserId();
  if (!userId) return false;
  try {
    const result = await supabase.from('players').select('*').eq('user_id', userId).eq('room_code', code).single();
    if (result.error || !result.data) {
      return false;
    }
    currentPlayerId = result.data.id;
    currentPlayerName = result.data.name;
    return true;
  } catch (e) {
    return false;
  }
}

function subscribeToRoom(code, onReady) {
  if (roomSubscription) roomSubscription.unsubscribe();
  roomSubscription = supabase.channel('room_' + code)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: 'room_code=eq.' + code }, function(payload) {
      handlePlayersChanged(payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: 'code=eq.' + code }, function(payload) {
      handleRoomChanged(payload);
    })
    // 广播：被房主踢出（房主踢人时主动发送，文案明确区分"被踢"与"自己离开"）
    .on('broadcast', { event: 'player_kicked' }, function(payload) {
      const name = (payload && payload.payload && payload.payload.name) || (payload && payload.name) || '';
      if (name && name !== currentPlayerName) {
        showToast('「' + name + '」已被房主踢出房间', 2500);
      }
    })
    // 广播：主动离开房间
    .on('broadcast', { event: 'player_left' }, function(payload) {
      const name = (payload && payload.payload && payload.payload.name) || (payload && payload.name) || '';
      if (name && name !== currentPlayerName) {
        showToast('「' + name + '」已离开房间', 2000);
      }
    })
    .subscribe(function(status) {
      if (status === 'SUBSCRIBED' && onReady) onReady();
    });
}

async function refreshPlayers() {
  if (!currentRoomCode) return;
  try {
    const result = await supabase.from('players').select('*').eq('room_code', currentRoomCode).order('created_at');
    if (result.data) updatePlayerList(result.data);
  } catch (e) {}
}

function handlePlayersChanged(payload) {
  if (!currentRoomCode) return;
  if (!payload || !payload.eventType) { refreshPlayers(); return; }
  try {
    const event = payload.eventType;
    const newRow = payload.new;
    const oldRow = payload.old || {};

    if (event === 'INSERT') {
      if (!currentPlayers.some(function(p) { return p.id === newRow.id; })) {
        currentPlayers.push(newRow);
        currentPlayers.sort(function(a, b) { return new Date(a.created_at) - new Date(b.created_at); });
        updatePlayerList(currentPlayers);
      }
    } else if (event === 'UPDATE') {
      const idx = currentPlayers.findIndex(function(p) { return p.id === newRow.id; });
      if (idx >= 0) {
        currentPlayers[idx] = newRow;
        updatePlayerList(currentPlayers);
      } else {
        refreshPlayers();
      }
    } else if (event === 'DELETE') {
      currentPlayers = currentPlayers.filter(function(p) { return p.id !== oldRow.id; });
      updatePlayerList(currentPlayers);
      // 踢出/离开的文字提示统一由 player_kicked / player_left 广播处理；
      // 此处仅处理"被踢者本人"的专属提示（广播不会回显给发起方，被踢者靠这里兜底）
      if (currentPlayerId && oldRow.id === currentPlayerId) {
        showToast('\u4f60\u5df2\u88ab\u623f\u4e3b\u79fb\u51fa\u623f\u95f4', 3000);
        if (roomSubscription) { roomSubscription.unsubscribe(); roomSubscription = null; }
        if (currentRoomCode) localStorage.removeItem('ts_player_' + currentRoomCode);
        currentRoomCode = null;
        currentPlayerId = null;
        // 注意：此处不清 currentPlayerName。被踢者已退订频道，不会再收到任何广播；
        // 保留它可让 player_kicked 广播守卫稳定跳过被踢者本人，避免事件乱序时重复弹窗。
        showTeamsplitView('create');
      }
    }
  } catch (e) {
    refreshPlayers();
  }
}

function handleRoomChanged(payload) {
  if (!currentRoomCode) return;
  const newRow = (payload && payload.new) ? payload.new : {};
  if (newRow.status === 'done') {
    if (!isCurrentUserHost()) {
      const split = newRow.spy_state && newRow.spy_state.split;
      if (split && split.teamA && split.teamB) {
        const ta = document.getElementById('teamAPlayers');
        const tb = document.getElementById('teamBPlayers');
        if (ta) ta.innerHTML = split.teamA.map(teamRow).join('');
        if (tb) tb.innerHTML = split.teamB.map(teamRow).join('');
        showTeamsplitView('result');
      }
    }
  } else if (newRow.status === 'waiting') {
    if (!isCurrentUserHost()) {
      showTeamsplitView('lobby');
      refreshPlayers();
    }
  }
}

async function doSplit(mode) {
  if (!currentRoomCode) return;
  try {
    if (!currentPlayers || currentPlayers.length < 2) { showToast('至少需要2人', 2000); return; }
    if (!isCurrentUserHost()) { showToast('只有房主可以开始分队', 2000); return; }
    const rankBtn = document.getElementById('btnDoSplitRank');
    const randomBtn = document.getElementById('btnDoSplitRandom');
    if (rankBtn) rankBtn.disabled = true;
    if (randomBtn) randomBtn.disabled = true;
    if (!mode) mode = 'rank';
    const players = currentPlayers.slice();
    if (mode === 'random') {
      for (let i = players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = players[i]; players[i] = players[j]; players[j] = tmp;
      }
    } else {
      players.sort(function(a, b) { return (b.rank || 0) - (a.rank || 0); });
    }
    const teamA = [], teamB = [];
    let sumA = 0, sumB = 0;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const r = p.rank || 0;
      if (mode === 'random') {
        if (teamA.length <= teamB.length) teamA.push(p);
        else teamB.push(p);
      } else {
        if (sumA <= sumB) { teamA.push(p); sumA += r; }
        else { teamB.push(p); sumB += r; }
      }
    }
    document.getElementById('teamAPlayers').innerHTML = teamA.map(teamRow).join('');
    document.getElementById('teamBPlayers').innerHTML = teamB.map(teamRow).join('');
    showTeamsplitView('result');
    localStorage.setItem('ts_last_result', JSON.stringify({ roomCode: currentRoomCode, teamA: teamA, teamB: teamB }));
    localStorage.setItem('ts_spy_teams', JSON.stringify({ roomCode: currentRoomCode, teamA: teamA, teamB: teamB }));
    await supabase.from('rooms').update({ status: 'done', spy_state: { split: { teamA: teamA, teamB: teamB } } }).eq('code', currentRoomCode);
  } catch (e) {
    showToast('分队失败: ' + e.message, 3000);
  }
}

async function resetSplit() {
  if (!currentRoomCode) return;
  try {
    const players = currentPlayers;
    if (!isCurrentUserHost()) { showToast('只有房主可以重新分队', 2000); return; }
    await supabase.from('rooms').update({ status: 'waiting' }).eq('code', currentRoomCode);
    showTeamsplitView('lobby');
    updatePlayerList(players);
  } catch (e) {
    showToast('重新分队失败: ' + e.message, 3000);
  }
}

async function kickPlayer(playerId) {
  if (!currentRoomCode) return;
  try {
    const target = currentPlayers.find(function(p) { return String(p.id) === String(playerId); });
    const targetName = target ? target.name : '';
    // 先广播「被房主踢出」，再删除行；其余客户端据此显示明确的踢人提示
    if (roomSubscription && targetName) {
      try {
        await roomSubscription.send({
          type: 'broadcast',
          event: 'player_kicked',
          payload: { name: targetName }
        });
      } catch (e) {}
    }
    const result = await supabase.from('players').delete().eq('id', parseInt(playerId)).eq('room_code', currentRoomCode);
    if (result.error) throw result.error;
    showToast('已将该玩家移出房间', 2000);
    refreshPlayers();
  } catch (e) {
    showToast('踢人失败: ' + e.message, 3000);
  }
}

async function leaveRoom() {
  isLeaving = true;
  const isHost = !!(currentHostUserId && window._currentUser && currentHostUserId === window._currentUser.id);
  // 普通成员离开：先广播「X 已离开」（必须在退订前发送，否则其余客户端收不到），再退订并删除自己行
  if (currentRoomCode && !isHost && currentPlayerId && roomSubscription && currentPlayerName) {
    try {
      await roomSubscription.send({
        type: 'broadcast',
        event: 'player_left',
        payload: { name: currentPlayerName }
      });
    } catch (e) {}
  }
  if (roomSubscription) { roomSubscription.unsubscribe(); roomSubscription = null; }
  if (currentRoomCode && !isHost && currentPlayerId) {
    // 普通成员离开：从服务器移除自己（释放名额）
    try { await supabase.from('players').delete().eq('id', currentPlayerId); } catch (e) {}
    localStorage.removeItem('ts_player_' + currentRoomCode);
  } else if (currentRoomCode && isHost) {
    // 房主离开：保留服务器房间与自身的占位，仅本地退出，可重新进入恢复房主身份（方案 Y）
    try { localStorage.setItem('ts_current_room', currentRoomCode); } catch (e) {}
  }
  currentRoomCode = null;
  currentPlayerId = null;
  currentPlayerName = '';
  currentPlayers = [];
  localStorage.removeItem('ts_spy_teams');
  localStorage.removeItem('ts_last_result');
  const ri = document.getElementById('roomCodeInput');
  if (ri) ri.value = '';
  const pi = document.getElementById('playerNameInput');
  if (pi) pi.value = '';
  showTeamsplitView('create');
  showToast(isHost ? '已离开房间（房间已保留，可重新进入）' : '已离开房间', 2000);
}

async function initTeamSplitView() {
  if (isLeaving) {
    isLeaving = false;
    return;
  }
  await getUserId();
  await cleanupOldRooms();
  const ri = document.getElementById('roomCodeInput');
  if (ri) ri.value = '';
  const pi = document.getElementById('playerNameInput');
  if (pi) {
    const savedName = localStorage.getItem('ts_player_name') || '';
    pi.value = savedName;
  }
  const rs = document.getElementById('playerRankSelect');
  if (rs && !rs.value) {
    const savedRank = localStorage.getItem('ts_player_rank') || '';
    rs.value = savedRank;
  }
  if (!currentRoomCode) {
    const savedRoom = localStorage.getItem('ts_current_room');
    if (savedRoom) currentRoomCode = savedRoom;
  }
  if (currentRoomCode) {
    showTeamsplitView('lobby');
    const autoJoined = await tryAutoJoin(currentRoomCode);
    if (autoJoined) {
      await refreshPlayers();
      subscribeToRoom(currentRoomCode);
      localStorage.removeItem('ts_current_room');
      return;
    }
    currentRoomCode = null;
    localStorage.removeItem('ts_current_room');
  }
  const lastResult = localStorage.getItem('ts_last_result');
  if (lastResult) {
    try {
      const parsed = JSON.parse(lastResult);
      if (parsed.roomCode && parsed.teamA && parsed.teamB) {
        currentRoomCode = parsed.roomCode;
        // 恢复房主身份，使刷新后「重新分队」仍可用
        try {
          const rr = await supabase.from('rooms').select('host_user_id').eq('code', currentRoomCode).single();
          if (rr.data) currentHostUserId = rr.data.host_user_id || null;
        } catch (e) {}
        document.getElementById('teamAPlayers').innerHTML = parsed.teamA.map(teamRow).join('');
        document.getElementById('teamBPlayers').innerHTML = parsed.teamB.map(teamRow).join('');
        showTeamsplitView('result');
        localStorage.removeItem('ts_last_result');
        return;
      }
    } catch (e) {}
    localStorage.removeItem('ts_last_result');
  }
  if (roomSubscription) { roomSubscription.unsubscribe(); roomSubscription = null; }
  currentRoomCode = null;
  currentPlayerId = null;
  currentPlayers = [];
  showTeamsplitView('create');
}

function copyRoomCode() {
  if (!currentRoomCode) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(currentRoomCode).then(function() {
      showToast('房间码已复制: ' + currentRoomCode, 2000);
    }).catch(function() {
      fallbackCopy(currentRoomCode);
    });
  } else {
    fallbackCopy(currentRoomCode);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('房间码已复制: ' + text, 2000);
  } catch (e) {
    showToast('复制失败，请手动复制', 2000);
  }
  document.body.removeChild(ta);
}

window.copyRoomCode = copyRoomCode;
window.initTeamSplitView = initTeamSplitView;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.autoJoinLobby = autoJoinLobby;
window.joinLobby = joinLobby;
window.doSplit = doSplit;
window.resetSplit = resetSplit;
window.leaveRoom = leaveRoom;

// ========== 内鬼模式桥接 ==========
let spyTeamA = [], spyTeamB = [];

function openSpyMode() {
  const spyData = localStorage.getItem('ts_spy_teams');
  if (!spyData) { showToast('请先完成分队', 2000); return; }
  try {
    const parsed = JSON.parse(spyData);
    spyTeamA = parsed.teamA || [];
    spyTeamB = parsed.teamB || [];
  } catch (e) { showToast('分队数据异常', 2000); return; }
  if (spyTeamA.length < 2 || spyTeamB.length < 2) {
    showToast('每队至少需要2人才能开启内鬼模式', 3000); return;
  }
  // 渲染队伍预览
  const listA = document.getElementById('spyTeamAList');
  const listB = document.getElementById('spyTeamBList');
  if (listA) listA.innerHTML = spyTeamA.map(function(p) {
    var r = p.rank || 0;
    var tag = r ? '<span class="teamsplit-rank-tag">' + getRankName(r) + '</span>' : '';
    return '<div class="spy-team-member" data-pid="' + p.id + '">' + escapeHtml(p.name) + tag + '</div>';
  }).join('');
  if (listB) listB.innerHTML = spyTeamB.map(function(p) {
    var r = p.rank || 0;
    var tag = r ? '<span class="teamsplit-rank-tag">' + getRankName(r) + '</span>' : '';
    return '<div class="spy-team-member" data-pid="' + p.id + '">' + escapeHtml(p.name) + tag + '</div>';
  }).join('');

  // 显示内鬼面板
  document.getElementById('teamsplitResult').style.display = 'none';
  document.getElementById('teamsplitSpy').style.display = '';
  // 初始化内鬼模式逻辑(需等待 DOM 渲染)
  setTimeout(function() {
    if (window.initSpyMode) {
      window.initSpyMode({
        roomCode: currentRoomCode,
        userId: currentUserId,
        playerId: currentPlayerId,
        hostUserId: currentHostUserId,
        teamA: spyTeamA,
        teamB: spyTeamB
      });
    }
  }, 50);
}

function closeSpyMode() {
  if (window.leaveSpyMode) window.leaveSpyMode();
  document.getElementById('teamsplitSpy').style.display = 'none';
  document.getElementById('teamsplitResult').style.display = '';
}

window.openSpyMode = openSpyMode;
window.closeSpyMode = closeSpyMode;

// 供 app.js 的 switchModule 在切换模块时退订 Realtime 频道，避免连接泄漏（遗留 #7）
window.cleanupTeamSplitChannel = function() {
  if (roomSubscription) { roomSubscription.unsubscribe(); roomSubscription = null; }
};
