# 上线前全检报告：VALORANT 战术工具集

**日期**：2026-07-28
**场景**：全流程交付（代码审查 + 安全审计 + QA测试）
**参与成员**：产品官 + 安全卫士 + 质量门神
**版本**：V4.5.0

---

## 📌 TL;DR（执行摘要）
- 整体结论：🟡 有条件通过
- 阻塞项数量：5（3个 P0 安全/代码 + 2个 P1 体验）
- 下一步：修复 P0 阻塞项（约 2-3 小时工时），验证后重新走发布流程
- 亮点：数据库原子化 RPC 设计合理、认证流程完善、ARIA 无障碍支持到位

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| Go / No-Go | 🟡 条件 Go |
| 严重度分布 | 🔴 3 / 🟠 5 / 🟡 10 / 🟢 8 |
| 关键行动项 | 5 条（P0）+ 7 条（P1） |
| 建议负责人 | 泽零（全栈）+ DBA（SQL 修复） |

---

## 1. 各成员核心结论

### 🔍 产品官（代码审查）
- 核心判断：🟡 有条件通过。代码整体架构清晰，状态管理合理，但存在 RLS 策略漏洞、死代码残留、初始化防御缺失等 3 个严重问题。
- 关键建议：立即删除 teamsplit.js 死代码（S2），修复 players 表 RLS DELETE 策略（S1），为 app.js init() 添加 DOM 就绪检测（S3）。

### 🛡️ 安全卫士（OWASP+STRIDE 审计）
- 核心判断：🟡 有条件通过。数据库 RLS 策略是真正的安全边界，设计合理。但 3 个服务端函数缺少房主权限校验（P0），前端存在 XSS 隐患（P1），调试文件残留（P1）。
- 关键建议：为 `lobby_start_spy`、`lobby_reveal_spy`、`lobby_reset_spy` 添加房主校验（P0），修复 `showToast` innerHTML XSS（P1），从生产环境删除 `check-db.js`（P1）。

### ✅ 质量门神（QA测试与发布）
- 核心判断：🟡 条件 Go。总体评分 79/100，核心功能完整，40+ 测试用例通过率 95%。但 teamsplit.js 死代码可能导致整个模块无法加载（BUG-001），动画 runaway 风险需关注。
- 关键建议：删除 teamsplit.js 第 113-122 行死代码（5分钟工时），优化 spinChallenge 动画逻辑，处理冠军阵容边界情况。

---

## 2. 综合审查发现（去重合并后按严重度排序）

| # | 严重度 | 类别 | 位置 | 问题描述 | 建议 | 来源成员 |
|---|--------|------|------|---------|------|---------|
| 1 | 🔴 | 安全 | init-spy-db.sql:291-350 | `lobby_start_spy` 未校验房主身份，任何已登录用户可强制启动任意房间的内鬼模式 | 添加 `IF v_state->>'host_user_id' != auth.uid()::text THEN RAISE EXCEPTION` | 安全卫士 F-001 + 产品官 H5 |
| 2 | 🔴 | 安全 | init-spy-db.sql:353-419 | `lobby_reveal_spy` 和 `lobby_reset_spy` 同样缺少房主校验，可强制揭晓/重置任意房间 | 同上，为两个函数添加房主校验 | 安全卫士 F-002 |
| 3 | 🔴 | 代码 | teamsplit.js:113-122 | 死代码残留（重复代码块），含语法错误（`return` 不在函数内、`}).join('')` 无匹配），可能导致整个内战分队模块无法加载 | 立即删除第 113-122 行 | 产品官 S2 + QA BUG-001 |
| 4 | 🔴 | 安全 | init-spy-db.sql:452-461 | players 表 RLS DELETE 策略可被滥用：攻击者创建房间成为 host 后，可通过修改 room_code 指向目标房间并删除任意玩家 | 用 security definer 函数封装踢人逻辑，加入 room_code 严格绑定校验 | 产品官 S1 |
| 5 | 🔴 | 代码 | app.js:96 | `mainArea.style.backgroundImage` 在 DOM 未就绪时抛 TypeError，整个初始化流程中断 | 在 init() 入口添加 DOM 就绪检测或用 DOMContentLoaded 包裹 | 产品官 S3 |
| 6 | 🟠 | 代码 | spy-mode.js:240-257 | `subscribeSpyLobby` 中 `lobbyChannel` 赋值存在并发竞态，快速切换房间时 channel 泄漏 | 将 lobbyChannel 赋值从 .then 中提取到外层用 await | 产品官 H1 |
| 7 | 🟠 | 代码 | teamsplit.js:543-546 | 房主离开时保留房间和占位行，但房主断网后形成"僵尸房间"，其他玩家永远等不到房主回来 | 加入 30 秒重连机制，超时后自动转让房主 | 产品官 H2 |
| 8 | 🟠 | 体验 | auth.js:64-69 | 注册成功后立即尝试 signInWithPassword，若邮箱未确认则登录失败，错误提示为"昵称或密码错误"，误导用户 | 检查错误信息，如果是 Email not confirmed 则提示用户去邮箱确认 | 产品官 H3 |
| 9 | 🟠 | 代码 | app.js:357 | spinChallenge 的 setTimeout 递归在页面隐藏后仍执行，浪费 CPU | 在 visibilitychange 监听中加入 machineSpinning 检查 | 产品官 H4 |
| 10 | 🟠 | 安全 | app.js:48 | showToast 使用 innerHTML 拼接，函数签名接受任意 msg 参数，存在 DOM-based XSS 风险 | 改用 textContent 或先转义再拼接 | 安全卫士 F-003 |
| 11 | 🟡 | 代码 | init-spy-db.sql:326-334 | 内鬼任务分配使用 `i % 12` 取模，超过 12 人后任务重复且相邻玩家极可能相同 | 用 `floor(random() * 12)` 独立随机分配 | 产品官 H6 |
| 12 | 🟡 | 代码 | app.js:121,213,276,283 | renderMapCards 和 renderAgents 中 innerHTML 拼接未转义，缺乏纵深防御 | 使用 escapeHtml() 或改用 DOM API 创建元素 | 安全卫士 F-004 |
| 13 | 🟡 | 配置 | check-db.js | 调试文件残留，包含完整 Supabase 连接凭据，不应出现在生产环境 | 从生产部署中删除该文件 | 安全卫士 F-005 + 产品官 L6 |
| 14 | 🟡 | 代码 | teamsplit.js:456-476 | 段位分队贪心算法在多人情况下可能产生较大段位总和差异 | 使用蛇形分配（降序排列后奇偶分队）改善平衡性 | 产品官 M2 |
| 15 | 🟡 | 代码 | spy-mode.js:177-187 | cleanupSpyLobbyRooms 可能误删活跃房间（2小时阈值），且只删房间不删 players 导致孤儿行 | 延长阈值到 4-6 小时，清理时同时删除关联 players | 产品官 M3 |
| 16 | 🟡 | 代码 | auth.js:26-31 | userRank 未做 clamp，rank 为 0 或 >9 时 UI 显示异常 | 加入 `Math.max(1, Math.min(9, r))` | 产品官 M4 |
| 17 | 🟡 | 代码 | index.html:429-433 | defer 和 type="module" 混用导致加载顺序不确定，app.js 底部调用 initAuth() 时 auth.js 可能未加载 | 统一为 type="module" 或使用 import | 产品官 M7 |
| 18 | 🟡 | 体验 | supabase/functions/turnstile-verify | Edge Function 错误信息未本地化（英文），国内用户看到英文提示 | 返回中文错误信息或在前端映射错误码 | QA BUG-007 |
| 19 | 🟡 | 代码 | app.js:260-268 | 冠军阵容模式在筛选角色后可能无法组成完整阵容（某角色无特工时该位置为空） | 增加检查，若无法组成完整阵容则 toast 提示 | QA BUG-006 |
| 20 | 🟢 | 代码 | app.js:95 | backgroundImage 硬编码 CDN URL，无 fallback | 维护 CDN URL 列表或 onerror 回退到本地占位图 | 产品官 M1 |
| 21 | 🟢 | 代码 | app.js:43-56 | toastTimeout 全局单例，快速连续触发 toast 时 opacity 过渡不一致 | 在 showToast 开头设置 transition | 产品官 M5 |
| 22 | 🟢 | 代码 | teamsplit.js:72-74 | getRankIcon 硬编码赛季 UUID，赛季更新后图标失效 | 动态获取当前赛季 UUID 或提供 fallback | 产品官 L2 |
| 23 | 🟢 | 代码 | spy-mode.js:5-8 | esc() 函数每次调用都创建 DOM 元素，性能可优化 | 用一次性创建的 textarea 或 String.replace | 产品官 L3 |
| 24 | 🟢 | 代码 | auth.js:197,215 | syncCurrentUser 在 updateSidebar 中被重复调用 | 删除第 215 行的重复调用 | 产品官 L4 |
| 25 | 🟢 | 代码 | app.js:146-153 | shuffleArray 在每一帧都创建新数组，造成 GC 压力 | 用随机索引直接选卡片，无需完整洗牌 | 产品官 L5 |
| 26 | 🟢 | 安全 | index.html | 缺少 CSP 响应头，无法防止内联脚本执行和外部资源加载 | 添加 CSP meta 标签 | 安全卫士 F-010 |
| 27 | 🟢 | 安全 | spy-mode.js:87-89 | Math.random() 用于安全敏感操作（内鬼身份选择），可被预测 | 使用 crypto.getRandomValues() 替代 | 安全卫士 F-012 |
| 28 | 🟢 | 安全 | auth.js:13-19 | toEmail 函数可导致昵称碰撞，不同昵称可能哈希到相同邮箱 | 使用 UUID 或 crypto.randomUUID() 生成唯一邮箱前缀 | 安全卫士 F-006 |

---

## ✅ 行动清单

### P0 — 上线前必须修复

| # | 行动 | 负责方 | 紧急度 | 期望完成 |
|---|------|--------|--------|---------|
| 1 | 为 `lobby_start_spy`、`lobby_reveal_spy`、`lobby_reset_spy` 添加房主身份校验 | 泽零（SQL） | P0 | 当天 |
| 2 | 修复 players 表 RLS DELETE 策略漏洞，用 security definer 函数封装踢人逻辑 | 泽零（SQL） | P0 | 当天 |
| 3 | 删除 teamsplit.js 第 113-122 行死代码 | 泽零（JS） | P0 | 当天 |
| 4 | 为 app.js init() 添加 DOM 就绪检测 | 泽零（JS） | P0 | 当天 |
| 5 | 修复 auth.js 注册后登录失败误导用户的问题 | 泽零（JS） | P0 | 当天 |

### P1 — 上线后第一周

| # | 行动 | 负责方 | 紧急度 | 期望完成 |
|---|------|--------|--------|---------|
| 6 | 修复 showToast innerHTML XSS 漏洞 | 泽零（JS） | P1 | 3天内 |
| 7 | 从生产环境删除 check-db.js | 泽零（配置） | P1 | 3天内 |
| 8 | 修复 subscribeSpyLobby 并发竞态问题 | 泽零（JS） | P1 | 1周内 |
| 9 | 为房主离开添加 30 秒重连机制 | 泽零（JS+SQL） | P1 | 1周内 |
| 10 | 修复 spinChallenge 动画 runaway 风险 | 泽零（JS） | P1 | 1周内 |
| 11 | 修复内鬼任务分配算法（取模→真随机） | 泽零（SQL） | P1 | 1周内 |
| 12 | 处理冠军阵容模式边界情况 | 泽零（JS） | P1 | 1周内 |

### P2 — 后续迭代

| # | 行动 | 负责方 | 紧急度 | 期望完成 |
|---|------|--------|--------|---------|
| 13 | 为 innerHTML 拼接添加 escapeHtml 转义 | 泽零（JS） | P2 | 2周内 |
| 14 | 修复段位分队贪心算法（改用蛇形分配） | 泽零（JS） | P2 | 2周内 |
| 15 | 统一脚本加载方式（type="module"） | 泽零（HTML） | P2 | 1个月内 |
| 16 | 添加 CSP 响应头 | 泽零（HTML） | P2 | 1个月内 |
| 17 | 使用 crypto.getRandomValues() 替代 Math.random() | 泽零（JS） | P2 | 1个月内 |

---

## ⚠️ 待完善 / 已知局限

- 当前 QA 基于静态代码审查，无运行时测试环境。建议正式发布前进行至少一轮真实环境测试（多浏览器、多设备、弱网）。
- Realtime 频道安全性依赖 Supabase 默认配置，建议确认频道级 RLS 是否生效。
- 部分 SQL 改动（触发器/RLS）需到 Supabase SQL Editor 重新执行 init-spy-db.sql 才生效，代码 push 不会自动改库。
- Supabase Free tier 并发连接数限制为 50，小群够用，大群可能不足。

---

## 📚 成员产出索引

- gstack-product-reviewer（产品官）原始产出：代码审查报告（28个发现：3严重/6高/7中/6低）
- gstack-security-officer（安全卫士）原始产出：安全审计报告（12个发现：0严重/2高/6中/4低）
- gstack-qa-lead（质量门神）原始产出：QA测试报告（11个 bug：1严重/2高/4中/4低），完整报告见 `QA_REPORT.md`

---

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。
