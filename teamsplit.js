// ========== 内战分队模块 ==========
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/+esm';
const supabase = createClient('https://scoatqhpwkfhhinjviqr.supabase.co', 'sb_publishable_HRVWyVg47KyE2WJV7zLkSQ_Ap-y7AK-');

let currentRoomCode = null;
let currentPlayerId = null;
let roomSubscription = null;
let isLeaving = false;
let currentPlayers = [];
let deviceId = null;

function getDeviceId() {
  if (deviceId) return deviceId;
  deviceId = localStorage.getItem('ts_device_id');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem('ts_device_id', deviceId);
  }
  return deviceId;
}

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

function updatePlayerList(players) {
  var list = document.getElementById('playerList');
  var count = document.getElementById('playerCount');
  if (!list || !count) return;
  currentPlayers = players || [];
  var hostId = getHostId(currentPlayers);
  var isHost = isCurrentUserHost(currentPlayers);
  count.textContent = players.length;
  list.innerHTML = players.map(function(p) {
    var cls = p.id === currentPlayerId ? ' self' : '';
    var hostBadge = p.id === hostId ? '<span class="teamsplit-host-badge">房主</span>' : '';
    var kickBtn = '';
    if (isHost && p.id !== currentPlayerId && p.id !== hostId) {
      kickBtn = '<button class="teamsplit-kick-btn" data-pid="' + p.id + '" title="踢出玩家">&times;</button>';
    }
    return '<div class="teamsplit-player-chip' + cls + '">' + escapeHtml(p.name) + hostBadge + kickBtn + '</div>';
  }).join('');
  // 绑定踢人按钮事件
  list.querySelectorAll('.teamsplit-kick-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var pid = this.dataset.pid;
      var target = currentPlayers.find(function(p) { return p.id === pid; });
      if (target && confirm('确定要踢出「' + target.name + '」吗？')) {
        kickPlayer(pid);
      }
    });
  });
  // 检测自己是否被踢
  if (currentPlayerId && players.length > 0 && !players.some(function(p) { return p.id === currentPlayerId; })) {
    currentPlayerId = null;
    if (currentRoomCode) localStorage.removeItem('ts_player_' + currentRoomCode);
    showToast('你已被房主移出房间', 3000);
  }
  updateHostControls(isHost, currentPlayers.length);
}

function getHostId(players) {
  return players && players.length > 0 ? players[0].id : null;
}

function isCurrentUserHost(players) {
  return !!currentPlayerId && currentPlayerId === getHostId(players || currentPlayers);
}

function updateHostControls(isHost, playerCount) {
  var splitBtn = document.getElementById('btnDoSplit');
  if (splitBtn) {
    splitBtn.disabled = playerCount < 2 || !isHost;
    splitBtn.textContent = isHost ? '开始分队' : '仅房主可开始分队';
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
    // 清理已完成的旧房间（>24h）
    var oldDone = await supabase.from('rooms').select('code').eq('status', 'done').lt('created_at', oneDayAgo);
    if (oldDone.data && oldDone.data.length > 0) {
      var doneCodes = oldDone.data.map(function(r) { return r.code; });
      await supabase.from('players').delete().in('room_code', doneCodes);
      await supabase.from('rooms').delete().in('code', doneCodes);
    }
    // 清理超时的等待中房间（>2h 无人使用）
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
    await cleanupOldRooms();
    var result = await supabase.from('rooms').insert({ code: code, status: 'waiting' }).select().single();
    if (result.error) throw result.error;
    currentRoomCode = code;
    document.getElementById('roomCodeDisplay').textContent = code;
    showTeamsplitView('lobby');
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
    await cleanupOldRooms();
    var result = await supabase.from('rooms').select('*').eq('code', code).eq('status', 'waiting').single();
    if (result.error || !result.data) throw new Error('房间不存在或已开始');
    currentRoomCode = code;
    document.getElementById('roomCodeDisplay').textContent = code;
    showTeamsplitView('lobby');
    subscribeToRoom(code);
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
  try {
    // 检查同一房间内是否有同名玩家
    var dupResult = await supabase.from('players').select('id,name').eq('room_code', currentRoomCode).ilike('name', name);
    if (dupResult.data && dupResult.data.length > 0) {
      var dupNames = dupResult.data.map(function(p) { return p.name; });
      showToast('名字「' + dupNames[0] + '」已被使用，换一个吧', 3000);
      return;
    }
    var insertResult = await supabase.from('players').insert({ room_code: currentRoomCode, name: name }).select().single();
    if (insertResult.error) throw insertResult.error;
    currentPlayerId = insertResult.data.id;
    localStorage.setItem('ts_player_' + currentRoomCode, currentPlayerId);
    localStorage.setItem('ts_player_name', name);
    document.getElementById('playerNameInput').value = '';
    showToast('已加入分队', 2000);
    refreshPlayers();
  } catch (e) {
    showToast('加入失败: ' + e.message, 3000);
  }
}

async function tryAutoJoin(code) {
  var savedId = localStorage.getItem('ts_player_' + code);
  if (!savedId) return false;
  try {
    var result = await supabase.from('players').select('*').eq('id', savedId).eq('room_code', code).single();
    if (result.error || !result.data) {
      localStorage.removeItem('ts_player_' + code);
      return false;
    }
    currentPlayerId = savedId;
    return true;
  } catch (e) {
    return false;
  }
}

function subscribeToRoom(code) {
  if (roomSubscription) roomSubscription.unsubscribe();
  roomSubscription = supabase.channel('room_' + code)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: 'room_code=eq.' + code }, function() {
      refreshPlayers();
    })
    .subscribe();
}

async function refreshPlayers() {
  if (!currentRoomCode) return;
  try {
    var result = await supabase.from('players').select('*').eq('room_code', currentRoomCode).order('created_at');
    if (result.data) updatePlayerList(result.data);
  } catch (e) {}
}

async function doSplit() {
  if (!currentRoomCode) return;
  try {
    var result = await supabase.from('players').select('*').eq('room_code', currentRoomCode).order('created_at');
    var players = result.data;
    if (!players || players.length < 2) { showToast('至少需要2人', 2000); return; }
    currentPlayers = players;
    if (!isCurrentUserHost(players)) { showToast('只有房主可以开始分队', 2000); return; }
    var shuffled = players.slice().sort(function() { return Math.random() - 0.5; });
    var half = Math.ceil(shuffled.length / 2);
    var teamA = shuffled.slice(0, half);
    var teamB = shuffled.slice(half);
    document.getElementById('teamAPlayers').innerHTML = teamA.map(function(p) { return '<div class="teamsplit-player-row">' + escapeHtml(p.name) + '</div>'; }).join('');
    document.getElementById('teamBPlayers').innerHTML = teamB.map(function(p) { return '<div class="teamsplit-player-row">' + escapeHtml(p.name) + '</div>'; }).join('');
    showTeamsplitView('result');
    await supabase.from('rooms').update({ status: 'done' }).eq('code', currentRoomCode);
  } catch (e) {
    showToast('分队失败: ' + e.message, 3000);
  }
}

async function resetSplit() {
  if (!currentRoomCode) return;
  try {
    var result = await supabase.from('players').select('*').eq('room_code', currentRoomCode).order('created_at');
    var players = result.data || [];
    currentPlayers = players;
    if (!isCurrentUserHost(players)) { showToast('只有房主可以重新分队', 2000); return; }
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
    var result = await supabase.from('players').delete().eq('id', playerId).eq('room_code', currentRoomCode);
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
  await cleanupOldRooms();
  var ri = document.getElementById('roomCodeInput');
  if (ri) ri.value = '';
  var pi = document.getElementById('playerNameInput');
  if (pi) {
    var savedName = localStorage.getItem('ts_player_name') || '';
    pi.value = savedName;
  }
  if (currentRoomCode) {
    showTeamsplitView('lobby');
    var autoJoined = await tryAutoJoin(currentRoomCode);
    if (autoJoined) {
      await refreshPlayers();
      subscribeToRoom(currentRoomCode);
      return;
    }
    currentRoomCode = null;
  }
  if (roomSubscription) { roomSubscription.unsubscribe(); roomSubscription = null; }
  currentRoomCode = null;
  currentPlayerId = null;
  currentPlayers = [];
  showTeamsplitView('create');
}

window.initTeamSplitView = initTeamSplitView;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.joinLobby = joinLobby;
window.doSplit = doSplit;
window.resetSplit = resetSplit;
window.leaveRoom = leaveRoom;

