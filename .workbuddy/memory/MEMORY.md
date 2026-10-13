# 项目惯例

## 🔴🔴 P0-0待修：人机验证可脚本爆破（2026-10-13，实测）
- `supabase/functions/turnstile-verify/index.ts:30-37` 出题是**两位数加减法**（`Math.random()*20+1`，运算符 ±）。实测答案空间仅 **−19~40 共 60 个整数**，题目形态仅 800 种。
- anon key 硬编码在前端、verify 可无限次调用 → **单次注册最多 60 次请求**即可脚本爆破，注册门禁形同虚设。HMAC 设计本身正确（答案不下发、签名校验无误），**问题是题目太简单**。
- 另：减法可出**负数答案**（`3 - 17 = ?` → -14），占 1/3，若输入框无非负约束会误判。
- 修法：三数两运算符（答案空间升万级）+ 失败 N 次锁 nonce + 按 IP 限流（10次/分）+ 题目侧保证 `a >= b` 或答案非负 + 输入框 `type="number"`。

## 🔴🔴 P0-1 待修：存储型 XSS（2026-10-13 审计发现，已实测复现）
- **根因**：`esc()`（spy-mode.js:5-9）用 `div.textContent → innerHTML` 转义，**只转义 `& < >`，不转义 `" '`**。
- **注入点**：spy-mode.js:344 等多处把 `esc(p.name)` 直接拼进**双引号属性** `data-name="..."`；昵称含 `"` 即可闭合属性、注入 `on*` 事件处理器。
- **存储型**：昵称经 `lobby_add_player`（无成员校验）写入 `spy_state.players[].name`，渲染时全房触发 → 攻击者一个恶意昵称即可打同房所有人（尤其房主）。后果：读 `localStorage` 的 Supabase token → **冒充房主**踢人/揭晓内鬼/改队伍。
- **修法（改动极小，优先做）**：全站统一 esc 实现，补 `.replace(/"/g,'&quot;').replace(/'/g,'&#39;')`；或属性值改 `dataset`+`addEventListener`。
- **范围更正**：别以为 teamsplit.js 已安全——`escapeHtml()`（teamsplit.js:60-64）同样只转义 `& < > " '`，只是它用于 **HTML 内容上下文**（恰好安全），而非属性上下文；真正 100% 安全的只有 app.js 的 6 处 innerHTML（硬编码常量）。
- **同类待查**：`assignTeamFromCard(this,'...')`、`getRankIcon`（URL 未encode）、`spy-mode.js:397-399/431-432/439-440`（`t.title`/`t.desc` 未转义，当前硬编码故无害）。

## 🔴 P0-2 待修：内鬼身份可被任意读取（2026-10-13 审计发现，实测确认）
- `rooms` 表 RLS 读策略 `USING (auth.role()='authenticated')` 对全体登录用户开放，**无成员校验**。实测 anon key 直接 `GET /rest/v1/rooms?select=code,status,spy_state` 返回 **HTTP 200 全库房间**。
- `spy_state` 明文存 `team_a_spy_name`/`team_b_spy_name` → 任何用户可读走内鬼身份。内鬼模式核心玩法安全性已破。
- 房间码本身安全（crypto.getRandomValues + 32 字符集，6 位~10^9），但**不需要猜码**，策略直接吐全库。
- **内鬼判定用 display_name 而非 user_id**（`spy-mode.js:383`）。V4.2.3 已把房主判定改user_id，内鬼判定遗漏。
- **⚠️ Realtime 同样泄露**：`:52-59`/`:253-263` 订阅把 `payload.new.spy_state` 整行落地，而 Postgres Changes **不受 SELECT 策略裁剪** → 收紧 RLS 不足以修复，**必须把内鬼身份移出 `spy_state`**（方案 A 是唯一有效解）。
- **附带 P1**：`lobby_start_spy` 的 tasks 按 name 为键（SQL 335-340 行 + `spy-mode.js:403`），重名玩家任务互相覆盖、且重名时两人都会被判内鬼。建议连同 P0 一并把键改user_id。

## 🔧 架构性根因（2026-10-13 审计归纳，修复时优先处理）
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

## P1 跨文件缺陷（2026-10-13 补，均已复核）
- **昵称冒名抢身份**：`teamsplit.js:243-254` 查到同名行直接 `currentPlayerId = existing.id` 认领，**不比对 user_id** → 用别人昵称加入即可抢走其玩家行。修法：认领前须 `eq('user_id', getUserId())`。
- **`spy_state` 互相摧毁**：`teamsplit.js:472` 写 `{split}`、`spy-mode.js:100-104` 写 `{phase,team_*_spy,tasks,revealed}`，**双方均整体覆盖、无字段合并** → 后写者赢，另一方数据消失（内鬼桥接后结果页白屏）。修法：改 `jsonb_set` 定点更新或统一走 RPC 在单事务内合并。
- **登出残留**：`doSignOut()`（auth.js:88-94）只清模块内 `currentUser`，**全项目无 `onAuthStateChange`**（grep 零命中）→ `window._currentUser` 残留、守卫误判为已登录、Realtime 不退订、换号会闪现上一位用户的内鬼面板。修法：加 `resetSpyIdentity()`/`resetTeamSplitIdentity()`（清订阅+状态）并在 doSignOut 调用。
- **段位 desync**：见上方架构根因表。`teamsplit.js:236/287` 只写 window 不回写 `currentUser`，任一次 `syncCurrentUser()` 即回退为 0，并经 `spy-mode.js:206` 污染内鬼房间落库 rank=0。修法：对齐 `auth.js:315-319` 范式或走统一 setter。

## P1 待修（2026-10-13 审计，已复核）
- **退出登录残留**：`doSignOut()`（auth.js:88-94）只清模块内 `currentUser`，**全项目无 `onAuthStateChange` 监听**（grep 零命中）→ `window._currentUser` 残留旧对象、`switchModule` 登录守卫误判为已登录、Realtime 订阅不退订、`lobbyState` 不清。修法：统一 `window.resetSpyIdentity()` 清订阅+状态，勿只委托 `unsubscribe`。
- **段位分队无人数约束**（teamsplit.js:456-465）：只比段位和，实测可出 **1 vs 5**；且`rank=0`（新用户默认无段位）因 `sumB += 0` 永不增长而**全被塞进 B 队**。修法：`teamA.length` 优先于分数决策。
- **抽取按钮永久灰化**（app.js:498-500）：`visibilitychange` 传 `false` 导致 `if(resetButtons)` 整段跳过恢复，与 V4.5.25 同类。改传 `true`。
- **隐私模式全站白屏**（app.js:423/433）：`localStorage` 无 try/catch，抛异常被 init 的 catch 吞掉致其后全部初始化未执行。teamsplit.js:536 已有兜底，app.js 漏了。
- **系统主题偏好被丢弃**（app.js:424-425）：`matchMedia` 结果 `d` 从未使用，无本地偏好时恒强制暗色。
- **特工数量 29 vs 文案 30**：`app-data.js` 实测 29 条（8/7/7/7），`index.html` 与 `PROJECT_CONTEXT.md:24/:49` 写 30。

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
