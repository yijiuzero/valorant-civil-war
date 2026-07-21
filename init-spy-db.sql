-- ============================================================
-- 内鬼模式 · Supabase 数据库初始化脚本
-- 在 Supabase SQL Editor 中执行本脚本
-- ============================================================

-- 1. rooms 表新增 spy_state 字段
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS spy_state JSONB DEFAULT NULL;

-- 2. 允许所有已认证用户读取和更新 rooms（内鬼模式信任制）
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
