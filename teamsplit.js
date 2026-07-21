// ========== 内战分队模块 ==========
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/+esm';
const supabase = createClient('https://scoatqhpwkfhhinjviqr.supabase.co', 'sb_publishable_HRVWyVg47KyE2WJV7zLkSQ_Ap-y7AK-');

let currentRoomCode = null;
let currentPlayerId = null;
let currentUserId = null;
let currentHostUserId = null;
let roomSubscription = null;
let isLeaving = false;
let currentPlayers = [];

// ========== 匿名认证 ==========
async function getUserId() {
  if (currentUserId) return currentUserId;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      currentUserId = session.user.id;
      return currentUserId;
    }
  } catch (e) {}
  try {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    currentUserId = data.user.id;
    return currentUserId;
  } catch (e) {
    return null;
  }
}

// ========== 工具函数 ==========
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function showTeamsplitView(view) {
  const createEl = document.getElementById('teamsplitCreate');
  const lobbyEl = document.getElementById('teamsplitLobby');
  const resultEl = document.getElementById('teamsplitResult');
  const spyEl = document.getElementById('teamsplitSpy');
  if (createEl) createEl.style.display = 'none';
  if (lobbyEl) lobbyEl.style.display = 'none';
  if (resultEl) resultEl.style.display = 'none';
  if (spyEl) spyEl.style.display = 'none';
  if (view === 'create' && createEl) createEl.style.display = '';
  else if (view === 'lobby' && lobbyEl) lobbyEl.style.display = '';
  else if (view === 'result' && resultEl) resultEl.style.display = '';
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
    // 房主自动加入
    autoJoinLobby();
  } catch (e) {
    showToast('创建房间失败: ' + e.message, 3000);
  }
}

async function joinRoom() {
  const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!code) { showToast('请输入房间码', 2000); return; }
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
  var rankSel = document.getElementById('playerRankSelect');
  var rank = rankSel ? rankSel.value : '';
  if (!rank) { showToast('请选择你的段位', 2000); return; }
  rank = parseInt(rank);
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
    if (rankSel) rankSel.value = '';
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
  let rank = rankSel ? rankSel.value : '';
  if (!rank) { showToast('请选择你的段位', 2000); return; }
  rank = parseInt(rank);
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
    document.getElementById('playerNameInput').value = '';
    if (rankSel) rankSel.value = '';
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
      const removed = currentPlayers.find(function(p) { return p.id === oldRow.id; });
      currentPlayers = currentPlayers.filter(function(p) { return p.id !== oldRow.id; });
      updatePlayerList(currentPlayers);
      if (removed && removed.id !== currentPlayerId) {
        showToast('\u300c' + removed.name + '\u300d\u5df2\u88ab\u79fb\u51fa\u623f\u95f4', 2000);
      }
      if (currentPlayerId && oldRow.id === currentPlayerId) {
        showToast('\u4f60\u5df2\u88ab\u623f\u4e3b\u79fb\u51fa\u623f\u95f4', 3000);
        if (roomSubscription) { roomSubscription.unsubscribe(); roomSubscription = null; }
        if (currentRoomCode) localStorage.removeItem('ts_player_' + currentRoomCode);
        currentRoomCode = null;
        currentPlayerId = null;
        showTeamsplitView('create');
      }
    }
  } catch (e) {
    refreshPlayers();
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
    await supabase.from('rooms').update({ status: 'done' }).eq('code', currentRoomCode);
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
  if (roomSubscription) { roomSubscription.unsubscribe(); roomSubscription = null; }
  if (currentRoomCode) {
    // 房主离开 → 解散房间
    if (currentHostUserId && window._currentUser && currentHostUserId === window._currentUser.id) {
      try { await supabase.from('rooms').update({ status: 'done' }).eq('code', currentRoomCode); } catch (e) {}
    }
    if (currentPlayerId) {
      try {
        await supabase.from('players').delete().eq('id', currentPlayerId);
      } catch (e) {}
      localStorage.removeItem('ts_player_' + currentRoomCode);
    }
  }
  currentRoomCode = null;
  currentPlayerId = null;
  currentPlayers = [];
  localStorage.removeItem('ts_spy_teams');
  localStorage.removeItem('ts_last_result');
  const ri = document.getElementById('roomCodeInput');
  if (ri) ri.value = '';
  const pi = document.getElementById('playerNameInput');
  if (pi) pi.value = '';
  showTeamsplitView('create');
  showToast('已离开房间', 2000);
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
  if (currentRoomCode) {
    showTeamsplitView('lobby');
    const autoJoined = await tryAutoJoin(currentRoomCode);
    if (autoJoined) {
      await refreshPlayers();
      return;
    }
    currentRoomCode = null;
  }
  const lastResult = localStorage.getItem('ts_last_result');
  if (lastResult) {
    try {
      const parsed = JSON.parse(lastResult);
      if (parsed.roomCode && parsed.teamA && parsed.teamB) {
        currentRoomCode = parsed.roomCode;
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
    return '<div class="spy-team-member" data-pid="' + p.id + '">' + escapeHtml(p.name) + '</div>';
  }).join('');
  if (listB) listB.innerHTML = spyTeamB.map(function(p) {
    return '<div class="spy-team-member" data-pid="' + p.id + '">' + escapeHtml(p.name) + '</div>';
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
