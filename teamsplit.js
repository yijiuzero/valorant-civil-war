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
  var createEl = document.getElementById('teamsplitCreate');
  var lobbyEl = document.getElementById('teamsplitLobby');
  var resultEl = document.getElementById('teamsplitResult');
  if (createEl) createEl.style.display = 'none';
  if (lobbyEl) lobbyEl.style.display = 'none';
  if (resultEl) resultEl.style.display = 'none';
  if (view === 'create' && createEl) createEl.style.display = '';
  else if (view === 'lobby' && lobbyEl) lobbyEl.style.display = '';
  else if (view === 'result' && resultEl) resultEl.style.display = '';
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getRankName(rank) {
  var names = ['', '黑铁', '青铜', '白银', '黄金', '铂金', '钻石', '超凡', '神话', '赋能'];
  return names[rank] || '';
}

function getRankIcon(rank) {
  var seasonUuid = window.VALORANT_SEASON_UUID || '564d8e28-c226-3180-6285-e48a390db8b1';
  var t = rank * 3;
  return 'https://media.valorant-api.com/competitivetiers/' + seasonUuid + '/' + t + '/smallicon.png';
}

// ========== UI 更新 ==========
function updatePlayerList(players) {
  var list = document.getElementById('playerList');
  var count = document.getElementById('playerCount');
  if (!list || !count) return;
  currentPlayers = players || [];
  var isHost = isCurrentUserHost();
  count.textContent = players.length;
  list.innerHTML = players.map(function(p) {
    var cls = p.id === currentPlayerId ? ' self' : '';
    var hostBadge = p.user_id === currentHostUserId ? '<span class="teamsplit-host-badge">房主</span>' : '';
    var pRank = p.rank || 0;
    var rankIcon = pRank ? '<img class="teamsplit-rank-icon" src="' + getRankIcon(pRank) + '" alt="' + getRankName(pRank) + '" title="' + getRankName(pRank) + '" loading="lazy">' : '';
    var kickBtn = '';
    if (isHost && p.id !== currentPlayerId) {
      kickBtn = '<button class="teamsplit-kick-btn" data-pid="' + p.id + '" title="踢出玩家">&times;</button>';
    }
    return '<div class="teamsplit-player-chip' + cls + '">' + rankIcon + escapeHtml(p.name) + hostBadge + kickBtn + '</div>';
  }).join('');
  list.querySelectorAll('.teamsplit-kick-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var pid = parseInt(this.dataset.pid);
      var target = currentPlayers.find(function(p) { return p.id === pid; });
      if (target && confirm('确定要踢出「' + target.name + '」吗？')) {
        kickPlayer(pid);
      }
    });
  });
  if (currentPlayerId && players.length > 0 && !players.some(function(p) { return p.id === currentPlayerId; })) {
    currentPlayerId = null;
    if (currentRoomCode) localStorage.removeItem('ts_player_' + currentRoomCode);
    showToast('你已被房主移出房间', 3000);
  }
  updateHostControls(isHost, currentPlayers.length);
}

function isCurrentUserHost() {
  return !!currentUserId && currentUserId === currentHostUserId;
}

function updateHostControls(isHost, playerCount) {
  var rankBtn = document.getElementById('btnDoSplitRank');
  var randomBtn = document.getElementById('btnDoSplitRandom');
  if (rankBtn) {
    rankBtn.disabled = playerCount < 2 || !isHost;
    rankBtn.textContent = isHost ? '段位分队 ⚖️' : '仅房主可分队';
  }
  if (randomBtn) {
    randomBtn.disabled = playerCount < 2 || !isHost;
    randomBtn.textContent = isHost ? '随机分队 🎲' : '仅房主可分队';
  }
  var resetBtn = document.getElementById('btnResetSplit');
  if (resetBtn) resetBtn.disabled = !isHost;
  var hostHint = document.getElementById('teamsplitHostHint');
  if (hostHint) {
    if (!currentPlayerId) hostHint.textContent = '加入后可查看房主权限';
    else hostHint.textContent = isHost ? '你是房主，可以开始或重新分队' : '仅房主可以开始或重新分队';
  }
}

async function cleanupOldRooms() {
  try {
    var oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    var twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    var oldDone = await supabase.from('rooms').select('code').eq('status', 'done').lt('created_at', oneDayAgo);
    if (oldDone.data && oldDone.data.length > 0) {
      var doneCodes = oldDone.data.map(function(r) { return r.code; });
      await supabase.from('players').delete().in('room_code', doneCodes);
      await supabase.from('rooms').delete().in('code', doneCodes);
    }
    var oldWaiting = await supabase.from('rooms').select('code').eq('status', 'waiting').lt('created_at', twoHoursAgo);
    if (oldWaiting.data && oldWaiting.data.length > 0) {
      var waitingCodes = oldWaiting.data.map(function(r) { return r.code; });
      await supabase.from('players').delete().in('room_code', waitingCodes);
      await supabase.from('rooms').delete().in('code', waitingCodes);
    }
  } catch (e) {}
}

async function createRoom() {
  var code = generateRoomCode();
  try {
    var userId = await getUserId();
    if (!userId) throw new Error('身份初始化失败，请刷新重试');
    var insertData = { code: code, status: 'waiting', host_user_id: userId };
    var result = await supabase.from('rooms').insert(insertData).select().single();
    if (result.error) throw result.error;
    currentRoomCode = code;
    currentPlayers = [];
    currentHostUserId = userId;
    var codeDisplay = document.getElementById('roomCodeDisplay');
    codeDisplay.textContent = code;
    codeDisplay.style.cursor = 'pointer';
    codeDisplay.title = '点击复制房间码';
    showTeamsplitView('lobby');
    updatePlayerList([]);
    subscribeToRoom(code);
    showToast('房间已创建，请输入你的名字', 3000);
  } catch (e) {
    showToast('创建房间失败: ' + e.message, 3000);
  }
}

async function joinRoom() {
  var code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!code) { showToast('请输入房间码', 2000); return; }
  try {
    await getUserId();
    var result = await supabase.from('rooms').select('*').eq('code', code).eq('status', 'waiting').single();
    if (result.error || !result.data) throw new Error('房间不存在或已开始');
    currentRoomCode = code;
    currentHostUserId = result.data.host_user_id || null;
    var codeDisplay = document.getElementById('roomCodeDisplay');
    codeDisplay.textContent = code;
    codeDisplay.style.cursor = 'pointer';
    codeDisplay.title = '点击复制房间码';
    showTeamsplitView('lobby');
    subscribeToRoom(code);
    await refreshPlayers();
    var autoJoined = await tryAutoJoin(code);
    if (autoJoined) {
      showToast('欢迎回来！已自动恢复身份', 2000);
    } else {
      showToast('已加入房间，请输入你的名字', 2000);
    }
  } catch (e) {
    showToast('加入房间失败: ' + e.message, 3000);
  }
}

async function joinLobby() {
  var name = document.getElementById('playerNameInput').value.trim();
  if (!name) { showToast('请输入你的名字', 2000); return; }
  if (!currentRoomCode) return;
  if (currentPlayerId) { showToast('你已经在房间中了', 2000); return; }
  var rankSel = document.getElementById('playerRankSelect');
  var rank = rankSel ? rankSel.value : '';
  if (!rank) { showToast('请选择你的段位', 2000); return; }
  rank = parseInt(rank);
  if (rank < 1 || rank > 9) { showToast('段位无效', 2000); return; }
  try {
    var userId = await getUserId();
    var savedId = localStorage.getItem('ts_player_' + currentRoomCode);
    var dupQuery = supabase.from('players').select('id,name').eq('room_code', currentRoomCode).ilike('name', name);
    if (savedId) dupQuery = dupQuery.neq('id', savedId);
    var dupResult = await dupQuery;
    if (dupResult.data && dupResult.data.length > 0) {
      showToast('名字「' + dupResult.data[0].name + '」已被使用，换一个吧', 3000);
      return;
    }
    var insertData = { room_code: currentRoomCode, name: name, rank: rank };
    if (userId) insertData.user_id = userId;
    var insertResult = await supabase.from('players').insert(insertData).select().single();
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
  var userId = await getUserId();
  if (!userId) return false;
  try {
    var result = await supabase.from('players').select('*').eq('user_id', userId).eq('room_code', code).single();
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: 'room_code=eq.' + code }, function() {
      handlePlayersChanged();
    })
    .subscribe(function(status) {
      if (status === 'SUBSCRIBED' && onReady) onReady();
    });
  startPolling();
}

var pollInterval = null;
function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(function() {
    if (currentRoomCode) refreshPlayers();
  }, 3000);
}
function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

async function refreshPlayers() {
  if (!currentRoomCode) return;
  try {
    var result = await supabase.from('players').select('*').eq('room_code', currentRoomCode).order('created_at');
    if (result.data) {
      var players = result.data;
      var removed = currentPlayers.filter(function(p) {
        return !players.some(function(np) { return np.id === p.id; });
      });
      removed.forEach(function(p) {
        if (p.id !== currentPlayerId) {
          showToast('「' + p.name + '」已被移出房间', 2000);
        }
      });
      updatePlayerList(players);
      if (currentPlayerId) {
        var stillHere = players.some(function(p) { return p.id === currentPlayerId; });
        if (!stillHere) {
          showToast('你已被房主移出房间', 3000);
          if (roomSubscription) { roomSubscription.unsubscribe(); roomSubscription = null; }
          stopPolling();
          if (currentRoomCode) localStorage.removeItem('ts_player_' + currentRoomCode);
          currentRoomCode = null;
          currentPlayerId = null;
          showTeamsplitView('create');
        }
      }
    }
  } catch (e) {}
}

async function handlePlayersChanged() {
  if (!currentRoomCode) return;
  await refreshPlayers();
}

async function doSplit(mode) {
  if (!currentRoomCode) return;
  try {
    if (!currentPlayers || currentPlayers.length < 2) { showToast('至少需要2人', 2000); return; }
    if (!isCurrentUserHost()) { showToast('只有房主可以开始分队', 2000); return; }
    if (!mode) mode = 'rank';
    var players = currentPlayers.slice();
    if (mode === 'random') {
      for (var i = players.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = players[i]; players[i] = players[j]; players[j] = tmp;
      }
    } else {
      players.sort(function(a, b) { return (b.rank || 0) - (a.rank || 0); });
    }
    var teamA = [], teamB = [];
    var sumA = 0, sumB = 0;
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      var r = p.rank || 0;
      if (mode === 'random') {
        if (teamA.length <= teamB.length) teamA.push(p);
        else teamB.push(p);
      } else {
        if (sumA <= sumB) { teamA.push(p); sumA += r; }
        else { teamB.push(p); sumB += r; }
      }
    }
    function teamRow(p) {
      var pr = p.rank || 0;
      return '<div class="teamsplit-player-row">' + escapeHtml(p.name) + (pr ? '<span class="teamsplit-rank-tag">' + getRankName(pr) + '</span>' : '') + '</div>';
    }
    document.getElementById('teamAPlayers').innerHTML = teamA.map(teamRow).join('');
    document.getElementById('teamBPlayers').innerHTML = teamB.map(teamRow).join('');
    showTeamsplitView('result');
    localStorage.setItem('ts_last_result', JSON.stringify({ roomCode: currentRoomCode, teamA: teamA, teamB: teamB }));
    await supabase.from('rooms').update({ status: 'done' }).eq('code', currentRoomCode);
  } catch (e) {
    showToast('分队失败: ' + e.message, 3000);
  }
}

async function resetSplit() {
  if (!currentRoomCode) return;
  try {
    var players = currentPlayers;
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
    var result = await supabase.from('players').delete().eq('id', parseInt(playerId)).eq('room_code', currentRoomCode);
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
  stopPolling();
  if (currentRoomCode && currentPlayerId) {
    try {
      await supabase.from('players').delete().eq('id', currentPlayerId);
    } catch (e) {}
    localStorage.removeItem('ts_player_' + currentRoomCode);
  }
  currentRoomCode = null;
  currentPlayerId = null;
  currentPlayers = [];
  var ri = document.getElementById('roomCodeInput');
  if (ri) ri.value = '';
  var pi = document.getElementById('playerNameInput');
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
  var ri = document.getElementById('roomCodeInput');
  if (ri) ri.value = '';
  var pi = document.getElementById('playerNameInput');
  if (pi) {
    var savedName = localStorage.getItem('ts_player_name') || '';
    pi.value = savedName;
  }
  var rs = document.getElementById('playerRankSelect');
  if (rs && !rs.value) {
    var savedRank = localStorage.getItem('ts_player_rank') || '';
    rs.value = savedRank;
  }
  if (currentRoomCode) {
    showTeamsplitView('lobby');
    var autoJoined = await tryAutoJoin(currentRoomCode);
    if (autoJoined) {
      await refreshPlayers();
      return;
    }
    currentRoomCode = null;
  }
  var lastResult = localStorage.getItem('ts_last_result');
  if (lastResult) {
    try {
      var parsed = JSON.parse(lastResult);
      if (parsed.roomCode && parsed.teamA && parsed.teamB) {
        currentRoomCode = parsed.roomCode;
        function teamRow(p) {
          var pr = p.rank || 0;
          return '<div class="teamsplit-player-row">' + escapeHtml(p.name) + (pr ? '<span class="teamsplit-rank-tag">' + getRankName(pr) + '</span>' : '') + '</div>';
        }
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
  navigator.clipboard.writeText(currentRoomCode).then(function() {
    showToast('房间码已复制: ' + currentRoomCode, 2000);
  }).catch(function() {
    showToast('复制失败，请手动复制', 2000);
  });
}

window.copyRoomCode = copyRoomCode;
window.initTeamSplitView = initTeamSplitView;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.joinLobby = joinLobby;
window.doSplit = doSplit;
window.resetSplit = resetSplit;
window.leaveRoom = leaveRoom;
