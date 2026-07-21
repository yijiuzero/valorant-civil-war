-- ============================================================
-- 内鬼模式 · Supabase 数据库初始化脚本
-- 在 Supabase SQL Editor 中执行本脚本
-- ============================================================

-- 1. rooms 表新增 spy_state 字段
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS spy_state JSONB DEFAULT NULL;

-- 2. 允许所有已认证用户读取和更新 rooms（内鬼模式信任制）
-- ⚠️ 安全说明：
--   以下 RLS 策略适用于小群熟人场景（云南瓦搭群），不适用于公开部署。
--   当前策略：任何已登录用户可读取、更新、插入任意 rooms 记录。
--
--   如需加强安全性（推荐），可按以下方向改造：
--   a) SELECT: 允许已认证用户读取所有房间（维持现状）
--   b) UPDATE: 仅允许 host_user_id 匹配的用户更新，或 players 数组中的用户更新
--   c) INSERT: 仅允许 host_user_id = auth.uid() 的用户插入
--   d) DELETE: 添加明确的删除策略（仅允许 host 或 RLS 策略不允许删除）
--
--   当前 trust model 由应用层（前端逻辑）控制权限（isHost() / isSpyHost() 判定），
--   恶意用户仍可通过 Supabase API 直接绕过前端校验。请评估风险后决定是否升级。
-- ============================================================
DROP POLICY IF EXISTS "Allow read for authenticated" ON rooms;
CREATE POLICY "Allow read for authenticated"
  ON rooms FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow update spy_state for authenticated" ON rooms;
CREATE POLICY "Allow update spy_state for authenticated"
  ON rooms FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 3. (可选) 如有需要，允许插入
DROP POLICY IF EXISTS "Allow insert for authenticated" ON rooms;
CREATE POLICY "Allow insert for authenticated"
  ON rooms FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- 4. 可选：升级版 RLS（注释掉，需要时取消注释并执行）
-- DROP POLICY IF EXISTS "Restrict insert to own user" ON rooms;
-- CREATE POLICY "Restrict insert to own user"
--   ON rooms FOR INSERT
--   WITH CHECK (auth.uid() = host_user_id);
--
-- DROP POLICY IF EXISTS "Restrict update to host" ON rooms;
-- CREATE POLICY "Restrict update to host"
--   ON rooms FOR UPDATE
--   USING (auth.uid() = host_user_id)
--   WITH CHECK (auth.uid() = host_user_id);
