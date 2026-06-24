// ========== 内战分队模块 ==========
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/+esm';
const supabase = createClient('https://scoatqhpwkfhhinjviqr.supabase.co', 'sb_publishable_HRVWyVg47KyE2WJV7zLkSQ_Ap-y7AK-');

let currentRoomCode = null;
let currentPlayerId = null;
let roomSubscription = null;
let isLeaving = false;

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
  count.textContent = players.length;
  list.innerHTML = players.map(function(p) {
    var cls = p.id === currentPlayerId ? ' self' : '';
    return '<div class="teamsplit-player-chip' + cls + '">' + escapeHtml(p.name) + '</div>';
  }).join('');
  var splitBtn = document.getElementById('btnDoSplit');
  if (splitBtn) splitBtn.disabled = players.length < 2;
}

async function cleanupOldRooms() {
  try {
    var oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    var old = await supabase.from('rooms').select('code').eq('status', 'done').lt('created_at', oneDayAgo);
    if (old.data && old.data.length > 0) {
      var codes = old.data.map(function(r) { return r.code; });
      await supabase.from('players').delete().in('room_code', codes);
      await supabase.from('rooms').delete().in('code', codes);
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
    showToast('房间已创建，请输入你的名字 👇', 3000);
  } catch (e) {
    showToast('创建房间失败: ' + e.message, 3000);
  }
}

async function joinRoom() {
  var code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!code) { showToast('请输入房间码', 2000); return; }
  try {
    var result = await supabase.from('rooms').select('*').eq('code', code).eq('status', 'waiting').single();
    if (result.error || !result.data) throw new Error('房间不存在或已开始');
    currentRoomCode = code;
    document.getElementById('roomCodeDisplay').textContent = code;
    showTeamsplitView('lobby');
    subscribeToRoom(code);
    showToast('已加入房间，请输入你的名字', 2000);
  } catch (e) {
    showToast('加入房间失败: ' + e.message, 3000);
  }
}

async function joinLobby() {
  var name = document.getElementById('playerNameInput').value.trim();
  if (!name) { showToast('请输入你的名字', 2000); return; }
  if (!currentRoomCode) return;
  try {
    var insertResult = await supabase.from('players').insert({ room_code: currentRoomCode, name: name }).select().single();
    if (insertResult.error) throw insertResult.error;
    currentPlayerId = insertResult.data.id;
    localStorage.setItem('ts_player_' + currentRoomCode, currentPlayerId);
    document.getElementById('playerNameInput').value = '';
    showToast('已加入分队', 2000);
    refreshPlayers();
  } catch (e) {
    showToast('加入失败: ' + e.message, 3000);
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

function resetSplit() {
  supabase.from('rooms').update({ status: 'waiting' }).eq('code', currentRoomCode).then(function(){});
  showTeamsplitView('lobby');
  refreshPlayers();
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
  var ri = document.getElementById('roomCodeInput');
  if (ri) ri.value = '';
  var pi = document.getElementById('playerNameInput');
  if (pi) pi.value = '';
  if (currentRoomCode) {
    showTeamsplitView('lobby');
    await refreshPlayers();
    subscribeToRoom(currentRoomCode);
    return;
  }
  if (roomSubscription) { roomSubscription.unsubscribe(); roomSubscription = null; }
  currentRoomCode = null;
  currentPlayerId = null;
  showTeamsplitView('create');
}

window.initTeamSplitView = initTeamSplitView;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.joinLobby = joinLobby;
window.doSplit = doSplit;
window.resetSplit = resetSplit;
window.leaveRoom = leaveRoom;



