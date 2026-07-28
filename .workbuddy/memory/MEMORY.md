# 项目惯例

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

## DB 层坑（易误判为前端 bug）
- `rooms` 表有 `BEFORE UPDATE` 触发器 `trg_spy_room_update`（`check_spy_room_update` 函数，定义在 init-spy-db.sql）。该函数用 `uid text := auth.uid()::text` 后拿 `OLD.host_user_id = uid` 比较——`host_user_id` 是 UUID 列，会抛 `operator does not exist: uuid = text`，**杀掉所有 rooms 的 UPDATE**（建房间 INSERT 不受影响）。任何"内鬼模式改库后 UI 假死"先查这个触发器。
- 定位 DB 层 bug 的利器：用 anon key + supabase-js 实测 `.update()`，看返回 error（比只看 JS 快）。Realtime 是否开启可用"先订阅再 INSERT 看事件是否送达"隔离验证。
- SQL 改动（触发器/RLS）需用户到 Supabase SQL Editor 重新执行 init-spy-db.sql 才生效，代码 push 不会自动改库。
