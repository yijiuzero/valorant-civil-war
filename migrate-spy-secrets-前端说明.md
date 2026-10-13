# 内鬼身份保密修复 · 前端配套说明

> 配套脚本：`migrate-spy-secrets.sql`
> **执行顺序：先改前端（已完成）→ 再执行 SQL 脚本**
> 前端改动已完成并提交（见 spy-mode.js），现在可以执行 SQL 脚本了。

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
rooms.spy_state      → { phase, players[], tasks }            ← 客户端可见，但不含内鬼身份
spy_identities 表    → { team_a_spy_id, team_b_spy_name }     ← 仅房间成员可读
```

判定「我是不是内鬼」由服务端完成：

```js
// 不再：客户端比对 team_a_spy_name（需要身份下发，等于泄露）
// 改为：问服务端要"我的身份"
const { data } = await sb.rpc('lobby_get_my_spy', { p_code: code });
// 返回：{ phase, is_spy, team, task, players }
//        ↑ 只有自己的身份，没有别人的
```

揭晓时服务端才把内鬼姓名写回 `spy_state`——**此刻公开是设计意图**。

---

## 三、前端改动清单（已完成）

### 3.1 新增全局变量（文件顶部）

```js
let myIdentity = null;   // { phase, is_spy, team, task, players }
```

### 3.2 两条路径各自的身份查询

| 路径 | 函数 | 用哪个房间码 |
|---|---|---|
| 在线 Lobby | `refreshMyIdentity()` | `lobbyRoomCode` |
| 内战分队桥接 | `refreshBridgeIdentity()` | `spyRoomCode` |

**刻意分成两个函数**：最初想共用，但桥接路径若复用 `lobbyRoomCode` 会污染 lobby 专属状态（`lobbyChannel` 等），且存在 TDZ 风险。分开后互不干扰。

### 3.3 内鬼判定改为服务端下发

**改前**（客户端持有身份字段）：
```js
var isSpy = (myName === lobbyState.team_a_spy_name || myName === lobbyState.team_b_spy_name);
```
**改后**：
```js
var isSpy = !!(myIdentity && myIdentity.is_spy === true);
```

### 3.4 任务读取改为服务端下发

**改前**：客户端按昵称查表 `lobbyState.tasks[myName]`
**改后**：`myIdentity.task`（服务端已直接返回索引）

### 3.5 触发时机（共 5 处）

| 时机 | 函数 |
|---|---|
| 开始内鬼成功后 | `startLobbySpy` / `assignSpies` |
| Realtime 事件到达 | `subscribeSpyLobby` 回调 / `subscribeSpyState` 回调 |
| 加入房间后 | `joinSpyLobby` |
| 进入桥接模式 | `initSpyMode` |
| 揭晓 / 重置 / 离开 | 清空 `myIdentity = null` |

### 3.6 桥接路径的额外改造

`assignSpies`（原直写 `spy_state` 含身份）改为两步：

```js
// 1) 身份写入服务端独立表（仅房主可写，有 RLS 保护）
await sb.rpc('lobby_set_spy_identity', { p_code, p_spy_a_id, p_spy_b_id, p_spy_a_name, p_spy_b_name });
// 2) spy_state 只存 phase/tasks，不含任何内鬼标识
await sb.from('rooms').update({ spy_state: { phase, tasks, revealed } });
```

`revealSpies` 改调 `spy_reveal_bridge`（SQL 新增函数），由服务端把身份写回并置 revealed。

### 3.7 揭晓视图无需改动

揭晓时 `phase === 'revealed'`，服务端已把 `team_a_spy_name` 写回 `spy_state`，
**原有揭晓渲染逻辑正确，无需改动**。

### 3.8 过渡期兼容

所有新 RPC 调用都做了降级处理：SQL 脚本尚未执行时 RPC 不存在，
只打 `console.warn` 提示需先执行迁移脚本，不阻断旧流程。

---

## 四、验证清单

执行 SQL 脚本后依次检查：

| # | 操作 | 期望 |
|---|------|------|
| 1 | 未登录执行 `GET /rest/v1/rooms?select=code,status,spy_state` | 只返回空数组或无权访问（**不再返回全库房间**） |
| 2 | 登录后 `GET /rest/v1/rooms?select=spy_state` | 只能看到自己是成员的房间 |
| 3 | 登录后 `GET /rest/v1/spy_identities?select=*` | 只能看到自己是成员的房间身份 |
| 4 | 建房 → 分队 → 开始内鬼 | `rooms.spy_state` 中**不含** `team_*_spy_*` 字段 |
| 5 | 同房间另一台浏览器观察 | 无法在 Console 或网络请求中看到内鬼是谁 |
| 6 | 房主点揭晓 | 全员正常看到内鬼姓名与任务（揭晓功能不受影响） |
| 7 | 点「再来一局」重置 | 身份被清空，可重新开始 |
| 8 | 内战分队页「开启内鬼模式」 | 桥接路径同样正常，且 `spy_state` 不含身份 |

> **验证第 5 项的方法**：A 浏览器开房并开始内鬼，B 浏览器加入同一房间码，
> 然后在 B 的 Console 执行：
> ```js
> const sb = await window._getSupabase();
> (await sb.from('rooms').select('spy_state').eq('code','<房间码>').single()).data.spy_state
> ```
> 返回的对象里**不应出现** `team_a_spy_name` / `team_b_spy_name`。

---

## 五、回滚方案

若上线后发现问题，可执行：

```sql
-- 回滚 rooms 读策略
DROP POLICY IF EXISTS "Allow read members only" ON rooms;
CREATE POLICY "Allow read for authenticated" ON rooms
  FOR SELECT USING (auth.role() = 'authenticated');

-- 把身份搬回 spy_state（按当时的具体情况补充 UPDATE）
-- DROP TABLE IF EXISTS public.spy_identities;
```

**但注意**：回滚等于恢复内鬼身份泄露，请优先排查问题而非直接回滚。
回滚后前端会因 `lobby_get_my_spy` 不存在而降级（console 警告），内鬼面板将无法判定身份。