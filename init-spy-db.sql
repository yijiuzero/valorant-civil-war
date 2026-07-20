-- ============================================================
-- 内鬼模式 · Supabase 数据库初始化脚本
-- 在 Supabase SQL Editor 中执行本脚本
-- ============================================================

-- 1. rooms 表新增 spy_state 字段
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS spy_state JSONB DEFAULT NULL;

-- 2. (可选) 允许所有已认证用户读取 spy_state（信任制模型）
--    如需更严格的控制，可替换为仅允许房间成员读取
DROP POLICY IF EXISTS "Allow read spy_state for authenticated" ON rooms;
CREATE POLICY "Allow read spy_state for authenticated"
  ON rooms FOR SELECT
  USING (auth.role() = 'authenticated');
