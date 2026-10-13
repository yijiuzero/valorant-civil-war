# 内鬼身份保密修复 · 前端配套说明

> 配套脚本：`migrate-spy-secrets.sql`
> 执行顺序：**先改前端 → 再执行 SQL 脚本**
> 若先执行 SQL 而前端未改，内鬼面板会拿不到身份数据（功能会坏）。

---

## 一、为什么必须改前端

原架构把内鬼身份放在 `rooms.spy_state` 里：

```
rooms.spy_state = { phase, players[], tasks, team_a_spy_name, team_b_spy_name, ... }
```

问题是这个字段**客户端完全可见**：
- `GET /rest/v1/rooms?select=spy_state` 能直接读（RLS 收紧前对全体登录用户开放）
- Realtime 的 `postgres_changes` 推送 `payload.new`（整行），**不受 SELECT 策略裁剪**

所以只在数据库层加权限没有用——**必须让内鬼身份不出现在客户端能拿到的数据里**。

---

## 二、新架构

```
rooms.spy_state     → { phase, players[], tasks }        ← 客户端可见，但不含内鬼身份
spy_identities 表   → { team_a_spy_id, team_b_spy_name } ← 仅房间成员可读
```

判定「我是不是内鬼」由服务端完成：

```js
// 不再：客户端比对 team_a_spy_name（需要身份下发，等于泄露）
// 改为：问服务端要"我的身份"
const { data } = await sb.rpc('lobby_get_my_spy', { p_code: code });
// 返回：{ phase, is_spy, team, task, players }
//        ↑ 只有自己的身份，没有别人的
```

揭晓时（`lobby_reveal_spy`）服务端才把内鬼姓名写回 `spy_state`——**此刻公开是设计意图**。

---

## 三、前端需要改的地方（spy-mode.js）

### 3.1 `renderSpyLobby` 的内鬼判定（第 383 行附近）

**改前**（依赖客户端持有身份字段）：
```js
var isSpy = (myName === lobbyState.team_a_spy_name || myName === lobbyState.team_b_spy_name);
```

**改后**（用 RPC 返回的 `is_spy`）：
```js
var isSpy = myIdentity.is_spy === true;
```

### 3.2 任务读取

**改前**：
```js
var idx = lobbyState.tasks && lobbyState.tasks[myName];
```

**改后**（`lobby_get_my_spy` 已直接返回 `task` 索引）：
```js
var t = myIdentity.task != null ? window.spyTasks[myIdentity.task] : null;
```

### 3.3 新增：订阅时同步拉取自己身份

Realtime 事件到达后（队伍/玩家变化），需要重新确认自己身份：

```js
async function refreshMyIdentity() {
  if (!lobbyRoomCode) return;
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.rpc('lobby_get_my_spy', { p_code: lobbyRoomCode });
    if (error) { console.warn('[spy] 拉取身份失败', error); return; }
    if (data) { myIdentity = data; renderSpyLobby(); }
  } catch (e) {
    console.warn('[spy] 拉取身份异常', e);
  }
}
```

在 `lobby_start_spy` 成功回调、以及 Realtime 的 `payload.new` 回调里各调一次。

### 3.4 模块变量

```js
let myIdentity = null;   // { phase, is_spy, team, task, players }
```

记得在 `resetSpyIdentity()` 里一并清空（否则换号会残留上一位的身份）。

### 3.5 揭晓视图

揭晓时 `phase === 'revealed'`，此时服务端已把 `team_a_spy_name` 写回 `spy_state`，
**原有揭晓渲染逻辑无需改动**——它读的就是 `lobbyState.team_a_spy_name`。

---

## 四、验证清单

执行 SQL 脚本后依次检查：

| # | 操作 | 期望 |
|---|------|------|
| 1 | 未登录执行 `GET /rest/v1/rooms?select=code,status,spy_state` | 只返回空数组或无权访问（**不再返回全库房间**） |
| 2 | 登录后 `GET /rest/v1/rooms?select=spy_state` | 只能看到自己是成员的房间 |
| 3 | 登录后 `GET /rest/v1/spy_identities?select=*` | 只能看到自己是成员的房间身份 |
| 4 | 建房 → 分队 → 开始内鬼 | `rooms.spy_state` 中**不含** `team_a_spy_name` / `team_b_spy_name` |
| 5 | 同房间另一台浏览器观察 | 无法在 Console 或网络请求中看到内鬼是谁 |
| 6 | 房主点揭晓 | 全员正常看到内鬼姓名与任务（揭晓功能不受影响） |
| 7 | 点「再来一局」重置 | 身份被清空，可重新开始 |

---

## 五、回滚方案

若上线后发现问题，可执行：

```sql
-- 回滚 rooms 读策略
DROP POLICY IF EXISTS "Allow read members only" ON rooms;
DROP POLICY IF EXISTS "Allow read for authenticated" ON rooms;
CREATE POLICY "Allow read for authenticated" ON rooms
  FOR SELECT USING (auth.role() = 'authenticated');

-- 把身份搬回 spy_state（按当时的具体情况补充 UPDATE）
-- DROP TABLE IF EXISTS public.spy_identities;
```

**但注意**：回滚等于恢复内鬼身份泄露，请优先排查问题而非直接回滚。