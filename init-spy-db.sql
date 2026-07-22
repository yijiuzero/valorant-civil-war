-- ============================================================
-- 内鬼模式 · Supabase 数据库初始化脚本
-- 在 Supabase SQL Editor 中执行本脚本
-- ============================================================

-- 1. rooms 表新增 spy_state 字段
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS spy_state JSONB DEFAULT NULL;

-- 2. rooms 表行级安全（RLS）
-- 信任模型：host 控制 + 成员自助加入
--   - 任何已登录用户可读所有房间（房间列表 / 加入需要）
--   - 仅 host_user_id = auth.uid() 可插入自己创建的房间
--   - 仅 host_user_id = auth.uid() 可全量更新自己创建的房间
--   - 普通成员可"往 spy_state.players 追加自己"，但不能改动 host / status / 内鬼分配等其它字段
-- 这样修复了"任意登录用户可改任意房间"的漏洞，同时不破坏内鬼 lobby 的加入流程
-- （joinSpyLobby 正是往 players 追加自己，被 "Allow member self join" 策略精确放行）。
-- ============================================================
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read for authenticated" ON rooms;
CREATE POLICY "Allow read for authenticated"
  ON rooms FOR SELECT
  USING (auth.role() = 'authenticated');

-- 插入：只能创建自己是 host 的房间
DROP POLICY IF EXISTS "Allow insert for authenticated" ON rooms;
CREATE POLICY "Allow insert for authenticated"
  ON rooms FOR INSERT
  WITH CHECK (auth.uid() = host_user_id);

-- 更新（房主）：可全量修改自己创建的房间
DROP POLICY IF EXISTS "Allow update spy_state for authenticated" ON rooms;
CREATE POLICY "Allow update spy_state for authenticated"
  ON rooms FOR UPDATE
  USING (auth.uid() = host_user_id)
  WITH CHECK (auth.uid() = host_user_id);

-- 更新（成员自助加入）：仅允许往 spy_state.players 追加自己，其它字段不变
-- 防篡改 host_user_id / status / 内鬼分配结果，仅放行"新增一个自己的 players 项"
DROP POLICY IF EXISTS "Allow member self join" ON rooms;
CREATE POLICY "Allow member self join"
  ON rooms FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (
    NEW.host_user_id IS NOT DISTINCT FROM OLD.host_user_id
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.code = OLD.code
    AND COALESCE(NEW.spy_state - 'players', '{}'::jsonb) = COALESCE(OLD.spy_state - 'players', '{}'::jsonb)
    AND (SELECT count(*) FROM jsonb_array_elements(NEW.spy_state->'players') p WHERE p->>'user_id' = auth.uid()::text) = 1
    AND (SELECT count(*) FROM jsonb_array_elements(OLD.spy_state->'players') p WHERE p->>'user_id' = auth.uid()::text) = 0
  );
