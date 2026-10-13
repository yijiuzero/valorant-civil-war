# 项目惯例

> **2026-10-13 更新**：V4.6.0 已修复下列 P0 与多数 P1。标注「✅已修」的条目仅记录根因与修法，**改同类代码时仍需注意**；标注「⏳待执行」的需用户手动操作。
> 完整审计报告见 `AUDIT_2026-10-13.md`（及 AUDIT_SPY_MODE.md / AUDIT_app_app-data_2026-10-13.md）。

## ✅已修 P0-0：人机验证可脚本爆破（V4.6.0）
- 根因：原出题 `Math.random()*20+1` 两位数加减法，答案取值域仅 **-19~40 共 60 个整数**，anon key 在前端可无限次调用 verify → 单次注册最多 60 次请求即可爆破。
- 修法：三数两运算符（a,b,c 各 1~99）使答案域升到 **489 种** + nonce 尝试次数限制 `MAX_ATTEMPTS=3`（验过即废）。
- **⚠️ 关键教训**：中途第一版改法失败——把减法改 `Math.max-min` 取绝对值后，答案被压缩到 **0~50（51 种）反而比原来更差**。**破解成本取决于「答案取值的种数」，与题目形态数无关**（题目从800 种涨到 16000 种毫无意义）。设计这类题时务必先算答案域。
- ⏳ 待执行：需 `supabase functions deploy turnstile-verify` 才生效。

## ✅已修 P0-1：存储型 XSS（V4.6.0）
- **根因**：`esc()` / `escapeHtml()` 原用 `div.textContent → innerHTML`，**只转义 `& < >`，不转义 `" '`**；昵称被拼进**双引号属性** `data-name="..."`（spy-mode.js:344），昵称含 `"` 即可闭合属性注入 `on*` 事件处理器。
- 已验证修复后：恶意昵称被完全转义，且经浏览器实体反转义能精确还原原值（分队 `find(x => x.name === name)` 姓名比对无回归）。
- **修法**：全站统一属性安全版本 `String(s == null ? '' : s).replace(/[&<>"']/g, c => ({...}[c]))`。**改任何新的转义函数都必须同时转义引号**，否则下一个把它拼进属性的人会重新引入漏洞。
- 同类已补：`spy-mode.js` 的 `t.title`/`t.desc`（服务端数据流直接进 innerHTML）。

## 🔴 P0-2 待修：内鬼身份可被任意读取（方案已就绪，⏳待执行 SQL）
- `rooms` 表 RLS 读策略 `USING (auth.role()='authenticated')` 对全体登录用户开放，**无成员校验**。实测 anon key 直接 `GET /rest/v1/rooms?select=code,status,spy_state` 返回 **HTTP 200 全库房间**。
- `spy_state` 明文存 `team_a_spy_name`/`team_b_spy_name` → 任何用户可读走内鬼身份。内鬼模式核心玩法安全性已破。
- 房间码本身安全（crypto.getRandomValues + 32 字符集，6 位~10^9），但**不需要猜码**，策略直接吐全库。
- **⚠️ Realtime 同样泄露**：`spy-mode.js` 订阅把 `payload.new.spy_state` 整行落地，而 Postgres Changes **不受 SELECT 策略裁剪** → 收紧 RLS 不足以修复，**必须把内鬼身份移出 `spy_state`**。
- **✅ 前后端方案均已写好（V4.6.0）**：`migrate-spy-secrets.sql` + `migrate-spy-secrets-前端说明.md` + spy-mode.js 改造（commit 1cda9ae）。核心：内鬼身份移入**独立表 `spy_identities`**（RLS 行级隔离，不在 Realtime 推送范围）+ `lobby_get_my_spy(p_code)` 只返回"我是否内鬼+我的任务"。
- **✅ 架构提醒（已踩过的坑）**：前端 `myIdentity` 声明必须在**文件顶部**，否则 `refreshBridgeIdentity`（靠前）引用会TDZ；两条路径（Lobby / teamsplit 桥接）**刻意用两个查询函数**，复用 `lobbyRoomCode` 会污染 lobby 专属状态。
- **⚠️ 现只剩执行 SQL**：脚本含 7 个函数（新增 `spy_reveal_bridge` 供桥接路径揭晓），前端已全部接好并带降级兼容。
- 附带未修：`lobby_start_spy` 的 tasks 仍按 name 为键，重名玩家任务互相覆盖；`spy_state` 被两条路径整体覆盖会互相摧毁。

## P1 跨文件缺陷（V4.6.0 已修多数）
- **✅昵称冒名**：`teamsplit.js` 的 autoJoinLobby 已改为按 `user_id` 认领，同名不同人明确拒绝（原按昵称认领可抢走他人玩家行）。
- **✅ 段位 desync**：已引入 `window.setCurrentUserRank()` 统一 setter，teamsplit 两处写入改为经它回写 auth.js 的 currentUser。
- **✅ 登出残留**：已接入 `supabase.auth.onAuthStateChange`（此前全项目零监听），SIGNED_OUT 时广播各模块清理。
- **✅ 段位分队 1v5**：已改为人数优先决策，实测「1赋能+5黑铁」→ 3v3；`rank=0`（新用户默认无段位）不再全塞进同一队。
- **✅ 抽取按钮永久灰化**：`visibilitychange` 已改传 `true`。
- **✅ 隐私模式全站白屏**：app.js 全部 localStorage 改走 `lsGet`/`lsSet`/`lsRemove`（内部 try/catch）。
- ✅ 系统主题偏好已用上 `matchMedia` 结果并注册 change 监听；特工文案已 30→29。
- **⏳ spy_state 双向摧毁待修**：`teamsplit.js` 写 `{split}`、`spy-mode.js` 写 `{phase,team_*_spy,tasks,revealed}`，**双方均整体覆盖、无字段合并** → 后写者赢，另一方数据消失。修法：改 `jsonb_set` 定点更新或统一走 RPC 在单事务内合并。
- `supabase/functions/turnstile-verify/index.ts:30-37` 出题是**两位数加减法**（`Math.random()*20+1`，运算符 ±）。实测答案空间仅 **−19~40 共 60 个整数**，题目形态仅 800 种。
- anon key 硬编码在前端、verify 可无限次调用 → **单次注册最多 60 次请求**即可脚本爆破，注册门禁形同虚设。HMAC 设计本身正确（答案不下发、签名校验无误），**问题是题目太简单**。
- 另：减法可出**负数答案**（`3 - 17 = ?` → -14），占 1/3，若输入框无非负约束会误判。
- 修法：三数两运算符（答案空间升万级）+ 失败 N 次锁 nonce + 按 IP 限流（10次/分）+ 题目侧保证 `a >= b` 或答案非负 + 输入框 `type="number"`。

## 🔧 架构性根因（V4.6.0 已根治，但机制需记住）
项目普遍采用「模块级变量 + 全局 window 变量」**双份状态，但只有一处被同步**，这是反复出 bug 的共同上游：
| 状态 | 副本 A | 副本 B | 同步方 | 后果 |
|---|---|---|---|---|
| 登录用户 | `teamsplit.js:9` `currentUserId`（永不清空） | `window._currentUser`（auth.js:225 清空） | 只有 B | 换号后无法建房/加入 |
| 房主身份 | `isCurrentUserHost():127`（读A） | `leaveRoom:518`（读B） | 无人 | 同文件两处判定矛盾 |
| 段位 | `window._currentUserRank`（teamsplit 写） | `currentUser.user_metadata.rank`（auth.js 写） | 只有 auth.js | 侧边栏/内鬼房间段位回退为 0 |
- **典型对照**：`auth.js:315-319` 是**正确范式**（判 error → 回写 `currentUser = data.user` → 再同步 window）；`teamsplit.js:236` 是**错误范式**（一行 try/catch、只写 window、不回写 currentUser，且 `updateUser` 不抛异常使 catch 成死代码）。改任何段位/身份写入都应对齐 auth.js 的写法。
- **根治方向**：① 身份只留单一权威源（auth.js 的 `currentUser`），其余位置读取而非缓存副本；② **接入 `supabase.auth.onAuthStateChange`（全项目当前零监听）** 在 SIGNED_OUT 时统一广播清理，替代 auth.js 手动逐个调模块（每加一个模块就漏一个）；③ 段位等资料一律走 auth.js 统一 setter，禁止其他模块直写 `window._currentUser*`。
- 其中 ② 能一次性消解：换号残留、房主判定矛盾、订阅不退订、段位 desync 等一批问题，**性价比最高**。
- **高危耦合（易随 DOM 调整静默失效）**：`auth.js:203` `updateSidebar()` 开头 `if (!entry) return;` 决定 `syncCurrentUser()` 是否执行 → 决定 `window._currentUser` 是否清理 → 决定 `leaveRoom:518` 能否正确判房主。即"侧边栏某元素是否存在"间接控制全站登出清理。**登出清理必须显式实现，不得依赖 updateSidebar 副作用**。

## RPC 身份校验的隐性依赖（重要）
- `lobby_add_player` / `lobby_remove_player` / `lobby_set_player_team` 函数体内**无 `auth.uid()` 校验**，仅靠 `check_spy_room_update` BEFORE UPDATE 触发器在语句层兜住。
- 实测证明触发器拦得住（SECURITY DEFINER 也绕不过 BEFORE UPDATE 触发器）。但若有人 DROP TRIGGER、或 RPC 改成"先SELECT 后UPDATE"不触发 UPDATE 语句，防线立即失效。建议在函数体内补显式调用者校验，不依赖单一防线。
- 对比：`lobby_start_spy`/`reveal`/`reset` 三者**已有**显式房主校验，`kick_player` 也有。

## 版本号规范
- Bug 修复 → +0.0.1（如 V3.6.0 → V3.6.1）
- 功能/需求更新 → +0.1.0（如 V3.6.0 → V3.7.0）
- 版本号位置：index.html（侧边栏 + 首页副标题）+ PROJECT_CONTEXT.md（标题 + 版本历史）
- 缓存参数 `?v=` 不需要跟版本号绑定，只有 JS 文件有改动时才递增
- 每次修改后必须维护版本号，提交时一并 push
- PROJECT_CONTEXT.md 现在随代码一起推送（已修正 .gitignore 规则顺序：将 `!PROJECT_CONTEXT.md` 移到 `*_*.md` 之后，此前该文件因带下划线被 `*_*.md` 匹配且否定规则排在前面而被误忽略）
- 改完自检通过后直接 commit + push，无需询问用户
- Git push 代理：`-c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897`

## 提交前自检
- 新增 UI 面板/视图后，grep 所有 `style.display = ''` 位置，确保"返回"和"面板切换"函数都处理了新面板的 hide
- 每次编辑后跑 `node --check` 确认无语法错误
- 禁止 edit 时多留/少留花括号

## Supabase 项目暂停（2026-10-13 确认）
- 项目 ref `scoatqhpwkfhhinjviqr`，项目名 valorant-civil-war，被 free tier 自动暂停，**域名从 DNS 摘除 → NXDOMAIN**，不是 DNS 污染。
- 症状链路：curl/浏览器报 `getaddrinfo failed` / `ERR_NAME_NOT_RESOLVED`，Clash 全局模式也无效（DNS 层面就断了）；`supabase.com` / `api.supabase.com` 仍正常，可据此区分「项目挂了」与「网络挂了」。
- **判定口诀**：项目子域名 NXDOMAIN + 主域正常 = 项目暂停/删除，别去折腾 Clash 规则。
- 数据安全，可恢复至 **2027-11-09**，之后不可恢复但数据仍可下载。free tier 长期不活跃会暂停（周级）。
- 恢复后必查：触发器 `check_spy_room_update` 是否为 `OLD.host_user_id::text = uid` 新版（暂停前是否重跑过 SQL 编辑器存疑）；turnstile-verify Edge Function 是否仍在。
- **已于 2026-10-13 恢复并实测全通**，详见当日日志。恢复是分阶段瞬态：DNS 活 → 521 → PGRST205 全表查不到 → 登录 500 → 约 2 分钟自愈。**遇到中间态别急着报"表丢了"**，等几分钟重测。
- RPC 函数探测必须带正确参数名（`p_code` 等），空 `{}` 报 PGRST202 是签名不匹配，不是函数缺失；带参后拿到 `P0001 房间不存在或已关闭` 才说明函数体正常。
- 本机路由器 DNS（192.168.77.1 H3C）缓存滞后，公共 DNS 已正常但 nslookup 仍可能报 NXDOMAIN → `ipconfig /flushdns`。

## DB 层坑（易误判为前端 bug）
- `rooms` 表有 `BEFORE UPDATE` 触发器 `trg_spy_room_update`（`check_spy_room_update` 函数，定义在 init-spy-db.sql）。该函数用 `uid text := auth.uid()::text` 后拿 `OLD.host_user_id = uid` 比较——`host_user_id` 是 UUID 列，会抛 `operator does not exist: uuid = text`，**杀掉所有 rooms 的 UPDATE**（建房间 INSERT 不受影响）。任何"内鬼模式改库后 UI 假死"先查这个触发器。
- 定位 DB 层 bug 的利器：用 anon key + supabase-js 实测 `.update()`，看返回 error（比只看 JS 快）。Realtime 是否开启可用"先订阅再 INSERT 看事件是否送达"隔离验证。
- SQL 改动（触发器/RLS）需用户到 Supabase SQL Editor 重新执行 init-spy-db.sql 才生效，代码 push 不会自动改库。
