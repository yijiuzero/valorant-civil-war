# VALORANT 战术工具集 · 项目上下文

> **版本**: V4.5.1
> **作者**: zer0
> **面向用户**: 云南瓦搭群
> **仓库**: https://github.com/yijiuzero/valorant-civil-war
> **最后更新**: 2026-07-27
> **说明**：本文件现已随代码推送到 GitHub（2026-07-23 起，用户要求纳入版本管理）

---

## 一、项目概述

这是一个为《无畏契约》（VALORANT）内战设计的**纯前端战术工具集网页应用**。无需构建工具、无需后端服务器，直接打开 `index.html` 即可使用。

---

## 二、文件结构

```
valorant-civil-war/
├── index.html           # 页面结构（导航 + 6 个模块容器 + 登录弹窗）
├── app.js               # 核心逻辑：选图、特工、转盘、模块切换、主题、登录守卫
├── app-data.js          # 静态数据：地图（13张）、特工（30个）、挑战规则、内鬼任务（12条）
├── auth.js              # 登录/注册模块（Supabase Auth 昵称注册 + session 管理）
├── spy-mode.js          # 内鬼模式（teamsplit桥接 + 在线Lobby房间 + 任务分配）
├── teamsplit.js         # 内战分队模块（Supabase 房间 + 段位 + 登录接入）
├── styles.css           # 全部样式（暗色/亮色 + 响应式 768/640/420px）
├── init-spy-db.sql      # 内鬼模式 Supabase RLS 策略初始化脚本
├── check-db.js          # 数据库清理/检查脚本
├── .gitignore           # 忽略规则（PROJECT_CONTEXT.md 现已纳入跟踪，随代码推送）
└── PROJECT_CONTEXT.md    # 本文件，现已随代码推送
```

---

## 三、模块说明

### 1. 首页（Home）
- 展示 5 个功能卡片，点击跳转对应模块
- 副标题含版本号（`from zer0 · V4.3.2`），侧边栏底部也有

### 2. 随机选图（Wheel）
- 13 张地图（Ascent ~ Summit，含 Corrode），支持 Ban 机制
- 可选抽取数量 1~5，Fisher-Yates 洗牌算法
- 背景图随抽中地图变化

### 3. 随机特工（Agent）
- 30 个特工，按角色分类（决斗者/先锋/控场者/哨卫）
- 支持按角色筛选 + 选择抽取数量
- **冠军阵容模式**：每个位置各出一人
- 图标来自 `media.valorant-api.com`

### 4. 内战专用（Stats / 转盘）
- 老虎机风格的随机挑战规则抽取器
- 13 条挑战规则，缓动动画（先快后慢），保留最近 20 条历史记录

### 5. 内战分队（TeamSplit）
- 通过 **Supabase** 实现多人在线房间，**强制登录**（未登录自动弹窗）
- 创建房间 → 获得 6 位房间码 → 分享加入 → 选段位即自动加入
- **段位系统**：玩家选段位（1-9），按段位平衡分队
- **房主系统**：创建者为房主，可踢人、分队、重新分队
- **登录接入**：自动取 `_currentUserDisplayName` 作为玩家名，免手动输入
- **内鬼桥接**：分队完成后可开启内鬼模式（`initSpyMode` 桥接）

### 6. 内鬼模式（Spy）
- **入口守卫**：必须登录才能进入
- **在线 Lobby**：创建房间 → 群友加入 → 房主手动分配 A/B 队 → 开始内鬼
- **全员任务**：所有人分配随机任务（12 条，无技能依赖），扰乱视野
- **内鬼机制**：每队随机 1 名内鬼，揭晓后展示全员任务列表
- **Supabase Realtime**：大厅实时同步玩家加入/离开/状态变更
- **断线重连**：游戏中途退出可重新加入恢复身份

---

## 四、分队模块架构（teamsplit.js）

### 数据模型
- **rooms 表**: `{ id, code, status: 'waiting'|'done'|'lobby', host_user_id, spy_state(JSONB), created_at }`
- **players 表**: `{ id, room_code, name, rank(1-9), user_id, created_at }`
- ⚠️ **项目有两套"players"，不要混淆**（无需统一，各有硬道理）：
  - **`players` 独立表**（内战分队 `teamsplit.js` 专用）：需频繁 CRUD——查成员列表、按 user_id 查自己、踢人删行、房主退出删自己。依赖多维度行级查询能力。
  - **`rooms.spy_state.players` JSONB 数组**（内鬼模式 `spy-mode.js` 专用）：玩家嵌在游戏状态里，房间关了整体带走，无需额外清理。权限由 `check_spy_room_update` 触发器精确控制（非房主仅可追加自己到数组）。
  - **段位（rank）存储位置不同**：内战分队 rank 存 `players.rank`（独立表列）；内鬼模式 rank 存 `rooms.spy_state.players[x].rank`（JSONB 内）；用户默认段位存 Supabase Auth 内置表 `auth.users.raw_user_meta_data.rank`。

### Supabase 配置
- URL: `https://scoatqhpwkfhhinjviqr.supabase.co`
- 使用 JS CDN ESM 导入，`<script type="module">`
- Realtime 频道: `room_{code}`
- **Auth**: 使用主登录模块（auth.js），session 由 `window._currentUser` 管理
- **RLS**: 详见 `init-spy-db.sql`

### UI 三视图
1. **create**: 创建房间按钮 + 输入房间码加入
2. **lobby**: 房间码显示 + 玩家列表（段位图标）+ 选段位自动加入 + 分队按钮
3. **result**: A/B 队结果展示 + 重新分队 + 离开 + 开启内鬼模式

### 核心功能
- **getUserId()**: 从 `window._currentUser` 读取登录用户 ID
- **createRoom**: 生成房间码 → 写入 host_user_id → 自动以登录名加入
- **joinRoom**: 验证房间码 → 自动恢复身份 → 选段位即加入
- **autoJoinLobby()**: 使用 `_currentUserDisplayName` 自动加入（选段位触发）
- **joinLobby()**: 兼容手动按钮（fallback 到 display name）
- **tryAutoJoin()**: 通过 `user_id` 匹配恢复身份
- **doSplit(mode)**: mode='rank' 段位贪心平衡；mode='random' Fisher-Yates
- **kickPlayer**: 房主踢人
- **leaveRoom**: 删除玩家记录 → 取消订阅
- **resetSplit**: 恢复 waiting 状态 → 回大厅
- **cleanupOldRooms**: 清理过期房间

### 登录接入
- `getUserId()` 从 `window._currentUser.id` 获取，不再用匿名登录
- 加入时自动以 `_currentUserDisplayName` 作为玩家名
- 名字输入框隐藏，段位选择器触发 `autoJoinLobby()`

### 关键变量
- `currentRoomCode`: 当前房间码
- `currentPlayerId`: 当前玩家 ID（players 表主键）
- `currentUserId`: 当前用户 ID（Supabase auth user id）
- `currentHostUserId`: 房主用户 ID（rooms.host_user_id）
- `currentPlayers`: 当前玩家列表缓存
- `isLeaving`: 标记正在离开（防止 initTeamSplitView 重置状态）
- `roomSubscription`: Supabase Realtime 订阅引用

### 房主判定逻辑
- `isCurrentUserHost()`: `currentUserId === currentHostUserId`
- 房主信息持久化在 `rooms.host_user_id`，刷新后可恢复
- 房主徽章显示在玩家列表中（`p.user_id === currentHostUserId`）

### 段位系统
- rank 1-9（黑铁~赋能）
- `rank * 3` → Valorant API tier for current season UUID `564d8e28-c226-3180-6285-e48a390db8b1`
- 图标 API: `https://media.valorant-api.com/competitivetiers/{seasonUuid}/{rank*3}/smallicon.png`
- 段位名称：黑铁、青铜、白银、黄金、铂金、钻石、超凡、神话、赋能

### localStorage 键
- `ts_player_{roomCode}`: 玩家 ID（按房间码存储）
- `ts_player_name`: 玩家名字（预填）
- `ts_player_rank`: 玩家段位（预填）
- `ts_last_result`: 上次分队结果（刷新后恢复）
- `ui-theme`: 主题偏好（dark/light）

---

## 五、登录模块架构（auth.js）

### 设计
- 昵称注册 + 密码，`toEmail("昵称")` 生成虚拟邮箱 `{slug}@val-game.com`
- 中文昵称 → hash → `u{hash}@val-game.com`
- 登录时反转：输入昵称 → `toEmail` → Supabase `signInWithPassword`
- 注册时 `display_name` 存入 `user_metadata`，侧边栏读取

### 关键变量
- `window._currentUser`: 当前 Supabase user 对象
- `window._currentUserDisplayName`: 当前用户 display_name

### 守卫
- `switchModule` 对 spy/teamsplit 检查 `window._currentUser`
- 未登录自动弹出 `authOverlay` + toast 提示
- 侧边栏 🔒 图标在登录后自动隐藏

---

## 六、内鬼模块架构（spy-mode.js）

### 双入口
1. **Teamsplit 桥接**：分队完成 → `initSpyMode(ctx)` → Supabase Realtime 同步
2. **在线 Lobby**：独立创建房间（`createSpyLobby` / `joinSpyLobby`）

### Lobby 流程
```
创建房间 → 生成6位码 → 群友登录加入 → 实时列表同步
→ 房主手动分配A/B队 → 开始内鬼 → 全员任务分配
→ 各自查看身份 → 房主揭晓 → 全员任务公开
```

### 数据流
- `rooms.spy_state(JSONB)` 存储全部游戏状态
- Realtime 频道: `lobby_{code}` 监听 UPDATE 事件
- `isHost()` 通过 `lobbyState.host_user_id === window._currentUser.id` 动态判定（V4.2.3 起由 display_name 比较改为 user_id 比较，防昵称伪造）
- **原子操作（V4.2.19 起）**：所有对 `spy_state` 的写入操作（加入/离开/分队/开始/揭晓/重置）均通过 `supabase.rpc()` 调用 Postgres 原子函数完成，使用 `SELECT ... FOR UPDATE` 行级锁消除并发竞态

### 任务系统
- 12 条任务，无技能依赖（已删友军火力/战术性失误）
- `startLobbySpy` 给所有玩家随机分配任务
- 内鬼看到内鬼面板 + 任务，非内鬼看到"你不是内鬼" + 挑战任务
- 揭晓后全员任务列表（内鬼红底标记 🕵️）

---

## 七、技术决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 框架 | 无（原生 JS） | 简单页面，无需构建 |
| 后端 | Supabase | 免费、实时、无需自建 |
| 主题 | CSS 变量 + theme-dark 类 | 支持系统偏好检测 |
| 洗牌算法 | Fisher-Yates | 公平随机 |
| 模块切换 | display:none/'' | 保留状态，切换不清空 |
| 身份系统 | Supabase Auth 昵称注册 | 昵称即账号，session 持久化 |
| 内鬼虚拟邮箱 | `{昵称}@val-game.com` | 复用 Auth，保证唯一 |
| 房主判定 | `host_user_id === window._currentUser.id` | 防昵称伪造（V4.2.3 起废弃 display_name 比较） |

---

## 八、已完成

### 核心功能
- [x] 随机选图（Ban 机制、动画、结果展示）
- [x] 随机特工（角色筛选、冠军阵容）
- [x] 内战转盘（动画、历史记录、切模块自动停止）
- [x] 分队模块基础流程（创建/加入/分队/离开）
- [x] 分队模块修复：加入流程合并 → 拆回两步（V2.1.2~V2.1.5）
- [x] 分队模块修复：切换页签后保留房间状态
- [x] 分队模块修复：创建者自动加入
- [x] 分队模块修复：resetSplit 恢复房间状态
- [x] 分队模块修复：结果页添加离开按钮
- [x] 分队模块修复：移除不存在的 temp_id 字段
- [x] 分队模块：段位系统（rank 1-9、段位选择、段位图标）
- [x] 分队模块：按段位平衡分队（贪心算法）
- [x] 分队模块：房主系统（房主标识、房主权限）
- [x] 分队模块：踢人功能
- [x] 分队模块：被踢玩家 toast 提示 + 自动返回
- [x] 分队模块：随机分队模式（Fisher-Yates）
- [x] 分队模块：分队按钮禁用（防并发）
- [x] 分队模块：joinLobby 检查房间 done 状态
- [x] 分队模块：房间超时清理（24h done / 2h waiting）
- [x] 分队模块：点击房间码复制（含 fallback）
- [x] 分队模块：玩家加入/离开 toast 通知
- [x] 分队模块：刷新页面恢复分队结果
- [x] 分队模块：防止同一房间重名
- [x] 分队模块：缓存破坏参数 `?v=` 随文件改动递增（当前 app-data.js?v=9 / auth.js?v=25 / teamsplit.js?v=16 / spy-mode.js?v=18 / app.js?v=11 / styles.css?v=14）
- [x] 暗色/亮色主题切换（localStorage 持久化）

### 身份系统改造（V3.4.0）
- [x] 身份系统：匿名登录（supabase.auth.signInAnonymously）
- [x] 房主系统：rooms.host_user_id 持久化判定（替代 deviceId）
- [x] 数据库变更：rooms 表 host_user_id 列 + players 表 user_id 列
- [x] 分队模块：自动恢复身份（tryAutoJoin 用 user_id 匹配）
- [x] 移除 deviceId 方案，全面切换为 user_id

### 移动端适配（V3.4.0）
- [x] 移动端适配：侧边栏→底部导航栏（768px/640px/420px 三断点响应式）
- [x] 编码修复：app-data.js / styles.css 添加 UTF-8 BOM 解决中文乱码
- [x] body overflow 改为 overflow-x:hidden（768px 断点开放 overflow-y:auto）
- [x] 触摸目标 ≥44px（mc-btn、ac-btn、ac-mode-btn、teamsplit-kick-btn）
- [x] 版本号移动端可见（首页副标题 + 侧边栏底部双端显示）

### Bug 修复（V3.6.1）
- [x] showToast 重叠消失（清除旧定时器）
- [x] stopChallenge 重复定义（合并为一个）
- [x] spinChallenge 切模块不停（tick 内检查 machineSpinning）
- [x] joinLobby 未检查房间 done 状态
- [x] doSplit 分队过程按钮未禁用（防并发）
- [x] copyRoomCode 无 fallback（execCommand 兜底）
- [x] stopAgentSpin 中 btn 变量名错误
- [x] overscroll-behavior 防止移动端下拉刷新误触
- [x] :focus-visible 焦点环（键盘导航友好）
- [x] #themeToggle 样式从 inline 移入 CSS
- [x] 移除 content-layer 入场动画（避免闪烁）
- [x] 清理临时文件（fix.js、fix-toast.js、fix-spinbtn.js、git_query.js）

### 其他
- [x] GitHub 仓库初始化并推送
- [x] Git 代理配置（127.0.0.1:7897）

### 前端可访问性维护（V3.14.0）
- [x] 键盘导航：导航项/首页卡片/内鬼入口/房间码复制支持 Enter/Space 激活（全局 keydown 委托 `[role="button"][tabindex]`）
- [x] 尊重系统「减少动效」偏好（`@media (prefers-reduced-motion: reduce)` 全局关闭动画/过渡）
- [x] 登录弹窗焦点管理：打开聚焦昵称输入框、Esc 关闭并返还焦点到侧边栏登录入口；`role="dialog" aria-modal`
- [x] 无障碍属性：toast `role="status" aria-live="polite"`、切换模块设 `aria-current="page"`、内鬼 Lobby 复制按钮 `aria-label`

### 移动端分队修复（V3.15.0）
- [x] 内鬼 Lobby 每张玩家卡片加 A队/B队 点击分配按钮（触屏/鼠标/键盘通用，原生 `<button>`）
- [x] 已分配按钮显示 ✓，再点即取消分配（`updatePlayerTeam(name, null)` toggle）
- [x] 复用 `.spy-team-btn` / `-a` / `-b` 样式，桌面 HTML5 拖拽保留作增强
- [x] 修复手机端 HTML5 拖拽不触发导致无法分队、内鬼流程卡死的问题
- [x] 名字从卡片 `data-name` 读取，避免拼入 onclick 字符串（XSS/引号安全）

### 人机验证接入（V4.2.9 起为自研轻量验证）
- [x] 原 Cloudflare Turnstile 在国内（昆明）常加载失败、且需第三方 CDN，V4.2.9 起替换为**自研轻量人机验证**
- [x] 无第三方 CDN 依赖，纯前端 + Supabase Edge Function（`turnstile-verify`，函数名历史遗留但逻辑已换），国内 100% 可达
- [x] 校验逻辑（无状态 HMAC 方案）：①challenge 时服务端生成算术题，对「答案|时间戳|随机值」做 HMAC-SHA256 签名（**答案不下发前端**）；②verify 时前端提交答案，服务端用该答案重算 HMAC 与带来的签名比对，一致即通过；③题目 5 分钟有效期防重放。攻击者无密钥无法伪造签名绕过 → 防裸奔
- [x] HMAC 密钥复用 Supabase 自动注入的 `SUPABASE_SERVICE_ROLE_KEY`，**无需额外 set secret**
- [x] Edge Function 部署：`supabase functions deploy turnstile-verify`（已于 2026-07-23 部署，线上冒烟测试 200 通过；**后续修改 index.ts 后需重新 deploy 才生效**）

### 并发安全修复（V4.2.19）
- [x] 内鬼 Lobby 并发竞态修复：原 `joinSpyLobby`/`updatePlayerTeam`/`leaveLobbyRoom`/`startLobbySpy`/`lobbyRevealSpies`/`resetLobbySpy` 全部采用 read-modify-write 模式操作 `spy_state` JSONB，并发操作会互相覆盖导致数据丢失
- [x] 新增 6 个 Postgres 原子函数（`lobby_add_player`/`lobby_remove_player`/`lobby_set_player_team`/`lobby_start_spy`/`lobby_reveal_spy`/`lobby_reset_spy`），前端通过 `supabase.rpc()` 调用，Postgres 端用 `SELECT ... FOR UPDATE` 行级锁保证原子性
- [x] `lobby_remove_player` 内置房主转移逻辑：房主离开时自动把 `host_user_id` 移交给首个剩余玩家，无人则关闭房间
- [x] `lobby_start_spy` 在服务端随机选内鬼 + 分配任务，不再信任客户端 Math.random()
- [x] players 表新增 `(room_code, user_id)` 唯一约束，防止同一用户在同一房间产生多行
- [x] Realtime 订阅同步 `host_user_id` 到 `lobbyState`，确保房主转移对所有客户端生效

---

## 九、待办 / 已知问题

**【已修复 V4.2.7】侧边栏「修改段位」按钮**（原「未修复」项，经代码+CSS 核对确认已可用）：
- 结论：代码逻辑与 CSS 均正常。`updateSidebar()` 用 innerHTML 重建后用 `getElementById('btnOpenRankEdit').addEventListener('click', openRankEdit)` 绑定；`openRankEdit` 取 `rankEditOverlay` 显示弹窗；`.auth-rankedit-btn`/`.auth-user-actions` 无 pointer-events 遮挡、布局为纵向 flex + 按钮独占一行（V4.2.5 已修挤压问题）。
- 文档「未修复」标注为过时描述，无需改动代码。

**被踢玩家提示**：V4.2.16 起采用「Realtime 广播 player_kicked + postgres_changes DELETE 双通道」兜底——被踢者本人走 DELETE 通道、其余客户端走广播通道，二者独立互不影响，可靠性较纯 DELETE 显著提升；极端网络抖动下仍可能漏提示，但双通道设计已大幅降低概率。

**房间人数上限**：Supabase free tier 50 channel clients。房间频道 `room_{code}`，单个房间 ≤50 并发。当前无需提升。

**超时清理**：`cleanupOldRooms()` 在 `initTeamSplitView()` 中运行（rooms 完成 >24h / 等待 >2h）。Lobby 房间无同类清理。

**已知低危问题（暂不修复）**：
- `app.js` 多处 innerHTML 拼接未转义（当前数据为硬编码常量，无用户输入入口，无实际风险）
- 注册/登录接口无限流（Supabase 自带限速，小群内使用风险可忽略）
- `doSplit` 随机模式使用 `Math.random()`（娱乐场景，不影响安全）

---

## 十、Git 规范

- 分支: main（默认直接提交，不另开 feature 分支）
- 提交风格: 前缀: 简短描述（如 fix:、feat:、chore:）
- Remote: origin → https://github.com/yijiuzero/valorant-civil-war.git
- **PROJECT_CONTEXT.md 现已随代码推送到 GitHub**（2026-07-23 起；.gitignore 已调整，将 `!PROJECT_CONTEXT.md` 例外移到 `*_*.md` 之后使其生效）
- **Git 代理**: `http://127.0.0.1:7897`（Clash 等本地代理）

---

## 十一、快速上手

```bash
# 克隆
git clone https://github.com/yijiuzero/valorant-civil-war.git

# 打开（无需构建）
start index.html
# 或直接在浏览器中打开 index.html
```

---


## 十二、版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| V4.2.19 | 2026-07-24 | 并发安全修复（+0.0.1）：内鬼 Lobby read-modify-write 竞态修复。新增 6 个 Postgres 原子函数（lobby_add_player/remove/set_team/start_spy/reveal/reset），前端改用 RPC + FOR UPDATE 行级锁，消除并发数据丢失。lobby_remove_player 内置房主转移逻辑。players 表加 (room_code, user_id) 唯一约束。需到 Supabase 重新执行 init-spy-db.sql |
| V4.2.18 | 2026-07-23 | Bug修复（+0.0.1）：内鬼模式分队/开始/揭晓/重开全部失效的**真凶定位与修复**。根因在 init-spy-db.sql 的 rooms 表触发器 `trg_spy_room_update`（`check_spy_room_update` 函数）：第69行 `uid text := auth.uid()`，随后 `OLD.host_user_id = uid` 拿 UUID 列 `host_user_id` 与 text 变量做 `=` 比较，Postgres 抛 `operator does not exist: uuid = text`。该触发器是 BEFORE UPDATE 且仅 UPDATE 触发→建房间(INSERT)正常、但任何 UPDATE（分队 updatePlayerTeam、开始 startLobbySpy、桥接分配 assignSpies、揭晓、重开）全被杀→行未变→无 Realtime 事件→UI 假死（这也解释了 V4.2.17 只补 window 暴露无效）。修复：① 触发器第69行改为 `OLD.host_user_id::text = uid`（UUID 列转 text 比较）；② 前端 spy-mode.js 给 updatePlayerTeam/startLobbySpy/lobbyRevealSpies/resetLobbySpy 加乐观重渲染（update 成功后本地 renderSpyLobby，不再唯 Realtime 回推），updatePlayerTeam 补 try/catch 提示。需到 Supabase 重新执行 init-spy-db.sql 让触发器生效。缓存参数 spy-mode17→18 |
| V4.2.17 | 2026-07-23 | Bug修复（+0.0.1）：内鬼独立房间分队失效——`renderSpyLobby` 的 A/B 卡片按钮用内联 `onclick="assignTeamFromCard(this,...)"`，但 spy-mode.js 是 ES module、该函数未挂到 window，点 A/B 直接 ReferenceError「点不动」；同时 `dragStart` 用 `e.target.dataset.name` 取值，抓取点为卡片内层 span/按钮时取不到名字、拖拽空值被 drop 守卫静默丢弃。修复：① window 暴露列表补 `assignTeamFromCard`；② dragStart 改为从抓取点向上 `closest('.spy-drag-card')` 读 `data-name`，拖拽稳定可用。缓存参数 spy-mode16→17 |
| V4.2.16 | 2026-07-23 | 需求（+0.1.0）：内战分队「玩家被房主踢出时广播提示」。subscribeToRoom 新增 Realtime 广播监听 player_kicked/player_left；kickPlayer 踢人时先广播「X 已被房主踢出房间」再删行，其余客户端据此显示明确踢人提示（与普通离开的「X 已离开房间」区分）；被踢者本人由 postgres_changes DELETE 兜底「你已被房主移出房间」（靠 currentPlayerName 自比避免收到自己的广播）；普通成员 leaveRoom 改为退订前先广播 player_left。缓存参数 teamsplit15→16 |
| V4.2.15 | 2026-07-23 | 安全加固&修复（+0.0.1）：①P0 补 players 表 RLS（init-spy-db.sql 新增 ENABLE RLS + 读/插/改/删策略，房主可删本房间玩家、玩家仅管自己行，堵住"任意登录用户可增删改查全库 players"的高危缺口，需到 Supabase 重新执行脚本生效）。②P1 内战分队房主离开语义修正（原"标 done+删自己行"导致房间半死、其余9人卡死；改为方案Y：房主离开仅本地退出、保留服务器房间与自身占位，可重新进入恢复房主身份，localStorage 存 ts_current_room 凭证，initTeamSplitView 恢复时补订阅）。③P2 Edge Function 去明文 fallback（缺失 SERVICE_ROLE_KEY 时 fail-closed 拒绝服务，不再用已知密钥伪造 HMAC）。④P2 切模块退订 Realtime 频道（switchModule 调 cleanupTeamSplitChannel/cleanupSpyChannel，修遗留 #7 连接泄漏）。缓存参数 app10→11、teamsplit14→15 |
| V4.2.14 | 2026-07-23 | Bug修复（+0.0.1）：修改段位弹窗**嵌套**修复。Console 诊断确认——rankEditOverlay.parentElement.id='authOverlay'，即 rankEditOverlay 被误包在 authOverlay 内（authOverlay 的 `</div>` 在 line 370 后缺失）。openRankEdit 设 authOverlay.display='none' → 子元素 rankEditOverlay 被父级隐藏。修复：补缺失的 `</div>` 令二者为平级兄弟，position:fixed 独立生效。缓存参数 auth24→25 |根因①（真 bug）：updateSidebar 先用 window._currentUserRank 旧值拼段位文本、最后才 syncCurrentUser 更新——顺序竞态致 UI 显示过期；initAuth 改用 sb.auth.getUser() 从服务端取最新 user_metadata（getSession 返回的是本地缓存、可能缺 rank），重登能显示而刷新不能的根因。jsdom 复现 stale session（缺 rank）场景：修复前段位文本=「未设置」、修复后=R5。②修改段位弹窗点击：jsdom 严格派发 click 验证 popup 由 none→'' 正常打开，代码逻辑无问题，用户侧点不开归因浏览器顽固缓存（需硬刷新拿 auth24）。缓存参数 auth23→24 |jsdom 仿真定位——rankEditOverlay 与 authOverlay 共用 z-index:9999 且前者 DOM 靠后，doSignOut 未关 rankEditOverlay 致状态泄漏；退出再登录时两弹窗同开、rankEditOverlay 盖在登录框上，表现为「登录后弹出修改段位框」。修复：openRankEdit 开时关 authOverlay、toggleAuthOverlay 开时关 rankEditOverlay、doSignOut/onAuthSuccess 均关 rankEditOverlay（互斥）；缓存参数 auth22→23 |——app-data.js 的 Supabase 单例由「缓存结果」改为「同步缓存 Promise 并存到 window」，修复 auth.js/teamsplit.js 并行 top-level await 时二次 createClient 的竞态；缓存参数 app-data8→9 |
| V4.2.10 | 2026-07-23 | Bug修复（+0.0.1）：修改段位点不开——代码逻辑/CSP/CSS 均正常（jsdom 严格模拟点击 PASS），根因疑为浏览器顽固缓存或 inline 被拦截极端情况；auth.js 顶层新增 document 级 click 事件委托兜底（免疫 innerHTML 重建绑定时序与 inline 拦截），bump 缓存参数 auth21→22 强制刷新。缓存参数 auth21→22 |
| V4.2.9 | 2026-07-23 | 替换人机验证（+0.0.1）：Cloudflare Turnstile 国内不可达 → 自研轻量验证。前端 auth.js 移除 Turnstile 挂件，改为调 Edge Function `turnstile-verify` 的 challenge/verify 两步（HMAC-SHA256 服务端校验，答案不下发前端，防裸奔）；index.html 删除 Cloudflare api.js、版本号 V4.2.8→V4.2.9、auth20→21。Edge Function 已重写（无状态 HMAC，复用 SUPABASE_SERVICE_ROLE_KEY 无需 set secret），需 `supabase functions deploy turnstile-verify` 生效 |
| V4.2.8 | 2026-07-23 | Bug修复（+0.0.1）：①修改段位点不开——jsdom 实测确认代码链路正常（非代码 bug），根因为浏览器缓存旧 auth.js；改为 inline onclick="openRankEdit()" 兜底 + 缓存参数 auth19→20 强制刷新。②注册人机验证不可见加固——error-callback 与脚本未加载时显示明确中文提示（域名未在 Cloudflare 允许列表 / 国内网络限制），新增 6 秒看门狗避免静默死循环「请等待人机验证完成」；不降级安全策略（仍强制验证）。缓存参数 auth19→20 |
| V4.2.7 | 2026-07-22 | 安全修复（+0.0.1）：①内鬼 RLS 残留口子——init-spy-db.sql 触发器补 `created_at` 禁止改动检查，堵住"任意登录用户改 created_at + 删任意 lobby 房间"的攻击链（需到 Supabase 重新执行该脚本生效）。②内战分队双 Supabase 实例统一为全局 `_getSupabase()`，移除 `signInAnonymously` 匿名 fallback，消除 session / 房主身份判定不一致隐患。③同步文档（遗留清单 #1/#2/#5/#6 标记已修复、PROJECT_CONTEXT 缓存参数与过时脚注更新）。缓存参数 teamsplit13→14 |
| V4.2.6 | 2026-07-22 | Bug修复（+0.0.1）：注册时人机验证不可见——① Turnstile 改 size:'compact'（可见组件，用户知道在验证）；② 注册时检测 window.turnstile 是否加载，未加载则提示「人机验证未加载，请检查网络后刷新页面重试」。缓存参数 auth18→19 |
| V4.2.5 | 2026-07-22 | Bug修复（+0.0.1）：侧边栏「修改段位」按钮点不动——auth-user-actions 在桌面端改为纵向 flex 排列（flex-direction:column），修改段位按钮独占一行、宽度 100%，不再被昵称长度挤压。缓存参数 css13→14 |
| V4.2.4 | 2026-07-22 | 安全修复（+0.0.1）：①M-1 用户枚举——统一注册/登录错误提示为「昵称或密码错误」，不再通过响应差异暴露账户是否存在。②M-3 不安全随机数——teamsplit.js 与 spy-mode.js 房间码生成改用 crypto.getRandomValues()，消除 Math.random() 可预测风险。缓存参数 auth17→18、spy-mode15→16、teamsplit12→13 |
| V4.2.3 | 2026-07-22 | 安全修复（+0.0.1）：①内鬼模式房主身份伪造——isHost() 从 display_name 比较改为 user_id 比较，创建房间时存储 host_user_id，防止恶意玩家通过注册相同昵称接管房间。②auth.js 侧边栏 innerHTML XSS——将 userDisplayName 通过 innerHTML 注入改为 textContent + createElement 注入，消除自 XSS 风险。缓存参数 auth16→17、spy-mode14→15 |
| V4.2.0 | 2026-07-22 | 需求：注册后可修改段位——侧边栏登录区新增「修改段位」入口并显示当前段位；新增独立弹窗（rankEditOverlay）选段位，保存走 supabase.auth.updateUser({data:{rank}}) 并刷新 window._currentUserRank；不动登录/注册流程；版本号 V4.1.3→V4.2.0（+0.1.0 新能力）、缓存参数 auth15/css12 |
| V4.1.3 | 2026-07-22 | 安全：init-spy-db.sql RLS 修正——member self join 策略改为粗粒度放行，非房主"仅可往 spy_state.players 追加自己"的精确校验移入触发器 trg_spy_room_update（绕过策略表达式 NEW/OLD 作用域限制，修复部署 42P01 错误）；新增 DELETE 策略仅允许删除 lobby 状态且超过 2h 的过期房间（对应前端清理逻辑）；版本号 V4.1.2→V4.1.3（+0.0.1 部署脚本 bug 修复） |
| V4.1.2 | 2026-07-22 | 安全：init-spy-db.sql rooms 表 RLS 收紧（ENABLE RLS + host-only 增改 + 成员自助加入策略），修复任意登录用户可篡改任意房间的漏洞；前端代码未变；版本号 V4.1.1→V4.1.2（+0.0.1） |
| V4.1.1 | 2026-07-22 | 维护：内鬼模式 playing/revealed 视图（所有人任务列表、揭晓内鬼名）补全段位展示；老账号兜底选段位后隐藏房间内段位下拉（display:none 复位）；房间码拼 onclick 加 esc() 防御；版本号 V4.1.0→V4.1.1、缓存参数递增 |
| V4.1.0 | 2026-07-22 | 段位体系接入注册：注册表单新增段位下拉（9档，仅注册显示），rank 写入 Supabase Auth user_metadata；内战分队移除房间内段位下拉，加入房间直接用注册段位（老账号无段位时回退显示下拉并最佳努力持久化）；内鬼模式 players 写入 rank 并在 Lobby 卡片/分队预览展示段位（仅展示，不改分配逻辑）；teamsplit.js 暴露 getRankName/getRankIcon 供内鬼复用；版本号与缓存参数更新 |
| V4.0.0 | 2026-07-22 | 重构修复：app.js 加 defer 修复静默登录恢复失效（脚本加载顺序）；teamsplit.js 订阅 rooms 表变更并写入 spy_state.split，修复分队/重开结果不实时同步给其他玩家；刷新后从 rooms 恢复 host_user_id 使「重新分队」可用；joinRoom 房间码校验；spy-mode.js joinSpyLobby 房间码校验防止 XSS；auth.js 移除错误回显中的内部邮箱、注册存在时不再暴露昵称已注册 |
| V3.16.1 | 2026-07-21 | 审计修复：teamsplit.js 三个 const→let（kickBtn/rank/dupQuery 运行时 TypeError）；Turnstile Edge Function 空 secret 提前检查；spy-mode.js 新增 Lobby 房间自动清理（>2h）；switchModule spy 重置入口视图；spinChallenge 添加 5 秒超时保护；init-spy-db.sql 添加 RLS 安全说明与升级政策 |
| V3.16.0 | 2026-07-21 | 注册入口接入 Cloudflare Turnstile 人机验证（Invisible 模式）：前端挂件 + Supabase Edge Function `turnstile-verify` 服务端校验 token；仅注册（signup）触发，登录不触发；Secret Key 由 Supabase 项目密钥管理，不进入前端 |
| V3.15.0 | 2026-07-21 | 内鬼模式分队修复：每张玩家卡片加 A队/B队 点击分配按钮（触屏/鼠标/键盘通用，active 再点取消分配），复用 .spy-team-btn 样式；解决手机端 HTML5 拖拽不可用导致无法分队、内鬼流程卡死的问题；版本号与缓存参数更新 |
| V3.14.0 | 2026-07-21 | 前端可访问性维护：导航/首页卡片/内鬼入口/房间码支持键盘 Enter/Space 激活；尊重系统「减少动效」偏好；登录弹窗焦点管理与 Esc 关闭；toast/弹窗 ARIA 属性；版本号与缓存参数更新 |
| V3.13.0 | 2026-07-21 | 内鬼 Lobby 分队由 A/B 按钮改为 HTML5 拖拽分配（待分配/A队/B队 三栏拖拽，仅桌面端可用） |
| V3.12.2 | 2026-07-21 | 移动端全模块响应式优化（间谍入口/Lobby/揭晓/分队/登录弹窗，640px+420px双断点） |
| V3.12.1 | 2026-07-21 | 审计修复：段位分队const→let、autoJoined未定义、删死HTML面板、侧边栏🔒、删initStandaloneView废调用 |
| V3.12.0 | 2026-07-21 | 内战分队接入登录（autoJoinLobby取displayName、选段位即加入、隐藏名字输入框） |
| V3.11.1 | 2026-07-21 | 揭晓内鬼时公开所有玩家任务列表（内鬼红底🕵️标记） |
| V3.11.0 | 2026-07-21 | 删友军火力/战术性失误（技能依赖）、新增脚步混乱/假动作；给所有玩家分配任务扰乱视野 |
| V3.10.1 | 2026-07-21 | 游戏中退出后可重新加入（新玩家仍拒绝） |
| V3.10.0 | 2026-07-21 | spy-mode.js审计清理：1034→417行(-60%)、删手动组队/快速创建/publishSpy/joinSpyRoom/独立游戏面板 |
| V3.9.11 | 2026-07-21 | 内鬼分配真实任务；揭晓界面显示任务；废弃teams阶段 |
| V3.9.8 | 2026-07-21 | 房主判断改用isHost()动态比较；离开时从服务器移除玩家 |
| V3.9.7 | 2026-07-21 | 去掉rooms表不存在的type列引用 |
| V3.9.5 | 2026-07-21 | Lobby手动分配A/B队（去掉随机分队） |
| V3.9.0 | 2026-07-21 | 在线Lobby房间——创建/加入/分队/开始内鬼（Supabase Realtime） |
| V3.8.1 | 2026-07-21 | 首页+内鬼入口卡片重组；快速创建房间（已废弃） |
| V3.8.0 | 2026-07-21 | 手动组队支持发布到线上 + 凭房间码加入 |
| V3.7.5 | 2026-07-21 | 中文昵称存入user_metadata.display_name；侧边栏显示原始昵称 |
| V3.7.0 | 2026-07-21 | Supabase Auth 昵称注册/登录模块（auth.js） |
| V3.6.1 | 2026-07-20 | Bug修复（内鬼查看身份后无法返回、B队内鬼标签错误、变量命名歧义） |
| V3.6.0 | 2026-07-20 | 内鬼模式支持独立手动组队（localStorage驱动）；双入口架构 |
| V4.5.1 | 2026-07-28 | Bug 修复（+0.0.1）：上线前全检修复 5 个 P0 阻塞项。包含：lobby_start_spy/reveal/reset 房主校验、players 表 RLS DELETE 安全漏洞、teamsplit.js 死代码清理、app.js init() DOM 防御、auth.js 注册后登录误导 |
| V4.5.0 | 2026-07-28 | 需求（+0.1.0）：UI 全面优化方案（方案C）三阶段全部完成 + 批量细节打磨（三批打包）。包含：品牌氛围增强、核心体验重设计、全面视觉重构、模块切换过渡、空/错误/加载态、触屏修复、网络检测、内鬼揭晓延迟、拖拽高亮、自定义滚动条等。版本号 V4.4.0→V4.5.0 |
| V4.4.0 | 2026-07-28 | 需求（+0.1.0）：UI 全面优化方案（方案C）规划并纳入 PROJECT_CONTEXT.md。分三阶段迭代：A 品牌氛围增强 → B 核心体验重设计 → C 全面视觉重构。版本号 V4.3.2→V4.4.0 |
| V4.3.2 | 2026-07-27 | 版本号升级（V4.2.19 → V4.3.2）。审计后确认并发安全修复稳定，无其他重大问题。更新版本号至 index.html、PROJECT_CONTEXT.md |

---

## 十三、UI 全面优化方案（方案C）

> **状态**: 规划中
> **目标**: 从"功能原型"升级为"品牌级产品"，建立 VALORANT 竞技调性
> **策略**: 分阶段迭代，每阶段独立可交付

### 核心问题诊断

| # | 问题 | 影响 |
|---|------|------|
| 1 | **品牌调性缺失** | 圆角卡片+系统字体+柔和阴影 = 通用 admin，缺乏 VALORANT 竞技张力 |
| 2 | **体验时刻平淡** | 抽奖揭晓只是淡入，缺乏"哇"的仪式感 |
| 3 | **模块切换生硬** | `display:none` 直接切，无过渡动画 |
| 4 | **信息架构** | "内战专用"命名模糊，分队→内鬼 4 层嵌套太深 |

### 阶段一：品牌氛围增强（A 优先）

**目标**: 不改变布局结构，只强化视觉表现力。低成本、高回报。

| 任务 | 内容 | 预估 |
|------|------|------|
| 字体升级 | 标题引入 VALORANT 风格字体（Tungsten / DIN Condensed web 替代），正文保持系统字体 | 0.5 天 |
| 氛围背景 | 暗色模式加微妙噪点/网格纹理，模块切换时背景色微妙过渡 | 0.5 天 |
| 卡片悬浮态 | 地图卡片 hover 红色辉光边框，特工卡片 hover 角色色溢出 | 0.5 天 |
| 关键动画 | 抽中地图"卡片飞入"动画，内鬼揭晓"翻转揭示"效果 | 1 天 |

**交付物**: 字体文件/链接、CSS 变量扩展、关键帧动画库

### 阶段二：核心体验重设计（B 核心）

**目标**: 重新设计 3 个核心"体验时刻"，建立仪式感。

| 任务 | 内容 | 预估 |
|------|------|------|
| 抽地图仪式 | 所有地图快速闪烁 → 聚光灯打到选中 → 选中地图放大+边框发光从中央弹出 | 1 天 |
| 分队结果 | A/B 队从屏幕两侧滑入，中间 VS 辉光，队员名依次弹出 | 0.5 天 |
| 内鬼揭晓 | 全员头像排列 → 内鬼头像翻转/高亮揭示 → 红色闪烁警告 | 1 天 |
| 转盘升级 | 老虎机外观重设计（金属质感+霓虹边框），结果揭晓动效 | 0.5 天 |

**交付物**: 3 个核心模块的 HTML/CSS/JS 重构

### 阶段三：全面视觉重构（C 长期）

**目标**: 信息架构到视觉表现全面升级。

| 任务 | 内容 | 预估 |
|------|------|------|
| 侧边栏重构 | VALORANT 风格图标（不用 emoji）、红色锐利切角指示器、玩家卡片（段位+头像） | 1 天 |
| 首页 Hero | 全屏背景、大型悬停卡片（hover 显示玩法预览）、最近活动/统计 | 1 天 |
| 动效系统 | 模块切换 shared element transition、统一"抽奖揭晓"动画语言、滚动视差 | 1 天 |
| 移动端打磨 | 全模块响应式精细调整、触摸手势优化 | 0.5 天 |
| 登录/弹窗 | 弹窗 VALORANT 风格重设计、段位选择器组件化 | 0.5 天 |

**交付物**: 完整设计系统、组件库、动效规范

### 时间总览

| 场景 | 时间 |
|------|------|
| 全职投入 | 8-12 天 |
| 业余推进（每天 2-3h） | 3-4 周 |

### 执行原则

1. **每阶段独立可交付** — 阶段一完成即可发布，不憋大招
2. **CSS 优先，JS 不动** — 方案 A/B 阶段只改样式，逻辑层不动
3. **渐进增强** — 动画全部加 `@media (prefers-reduced-motion: reduce)` 兜底
4. **移动端优先测试** — 每阶段完成后真机验证

### 当前进度

- [x] 阶段一：品牌氛围增强
- [x] 阶段二：核心体验重设计
- [x] 阶段三：全面视觉重构
- [x] 批量细节打磨（三批打包）
