// ========== 内鬼模式模块 ==========
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/+esm';
const supabase = createClient('https://scoatqhpwkfhhinjviqr.supabase.co', 'sb_publishable_HRVWyVg47KyE2WJV7zLkSQ_Ap-y7AK-');

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
    const result = await supabase.from('rooms').select('spy_state').eq('code', spyRoomCode).single();
    spyState = (result.data && result.data.spy_state) || null;
    renderCurrentPhase();
  } catch (e) {
    spyState = null;
    renderSpyInit();
  }
}

function subscribeSpyState() {
  if (spyChannel) spyChannel.unsubscribe();
  spyChannel = supabase.channel('spy_' + spyRoomCode)
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
    const result = await supabase.from('rooms').update({ spy_state: newState }).eq('code', spyRoomCode);
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
    await supabase.from('rooms').update({ spy_state: revealed }).eq('code', spyRoomCode);
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

// 暴露到 window
window.initSpyMode = initSpyMode;
window.assignSpies = assignSpies;
window.revealSpies = revealSpies;
window.leaveSpyMode = leaveSpyMode;
