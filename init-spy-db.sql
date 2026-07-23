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
--     （该精确校验由触发器 trg_spy_room_update 把关，策略只做粗粒度放行）
--   - 任意已登录用户可删除 "lobby 状态且超过 2 小时" 的过期房间（前端清理逻辑对应）
-- 这样修复了"任意登录用户可改任意房间"的漏洞，同时不破坏内鬼 lobby 的加入流程
-- （joinSpyLobby 正是往 players 追加自己，被触发器精确放行）。
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

-- 更新（成员自助加入）：粗粒度放行，精确校验交给触发器
DROP POLICY IF EXISTS "Allow member self join" ON rooms;
CREATE POLICY "Allow member self join"
  ON rooms FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 删除（清理过期 lobby）：任意已登录可删 "lobby 且 >2h" 的房间
DROP POLICY IF EXISTS "Allow cleanup old lobbies" ON rooms;
CREATE POLICY "Allow cleanup old lobbies"
  ON rooms FOR DELETE
  USING (
    auth.role() = 'authenticated'
    AND status = 'lobby'
    AND created_at < (now() - interval '2 hours')
  );

-- 触发器：非房主 UPDATE 只允许"往 spy_state.players 追加自己"
-- （NEW / OLD 在触发器函数内正常可用，绕过策略表达式的作用域限制）
DROP TRIGGER IF EXISTS trg_spy_room_update ON rooms;
DROP FUNCTION IF EXISTS public.check_spy_room_update() CASCADE;

CREATE OR REPLACE FUNCTION public.check_spy_room_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  uid text := auth.uid()::text;
  old_is_host boolean := (OLD.host_user_id::text = uid);
  old_in_players boolean;
  new_in_players boolean;
BEGIN
  -- 房主：放行任何改动
  IF old_is_host THEN
    RETURN NEW;
  END IF;
  -- 非房主：以下字段一律禁止改动
  IF NEW.host_user_id IS DISTINCT FROM OLD.host_user_id THEN
    RAISE EXCEPTION '无权限修改房主';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION '无权限修改房间状态';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION '无权限修改房间码';
  END IF;
  -- 禁止改动 created_at：否则非房主可把 lobby 房间的 created_at 改到 2h 前，
  -- 再利用 "Allow cleanup old lobbies" 删除策略炸掉任意在线内鬼 Lobby 房间
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION '无权限修改创建时间';
  END IF;
  IF COALESCE(NEW.spy_state - 'players', '{}'::jsonb) IS DISTINCT FROM COALESCE(OLD.spy_state - 'players', '{}'::jsonb) THEN
    RAISE EXCEPTION '无权限修改内鬼数据';
  END IF;
  -- 仅允许：旧 players 没有自己、新 players 有自己，且其它玩家不变
  SELECT count(*) > 0 INTO old_in_players FROM jsonb_array_elements(OLD.spy_state->'players') p WHERE p->>'user_id' = uid;
  SELECT count(*) > 0 INTO new_in_players FROM jsonb_array_elements(NEW.spy_state->'players') p WHERE p->>'user_id' = uid;
  IF old_in_players THEN
    RAISE EXCEPTION '你已在房间中';
  END IF;
  IF NOT new_in_players THEN
    RAISE EXCEPTION '只能加入自己';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(NEW.spy_state->'players') p WHERE p->>'user_id' <> uid)
     <> (SELECT count(*) FROM jsonb_array_elements(OLD.spy_state->'players') p WHERE p->>'user_id' <> uid) THEN
    RAISE EXCEPTION '无权限修改其它玩家';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_spy_room_update
  BEFORE UPDATE ON rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.check_spy_room_update();

-- ============================================================
-- 3. players 表行级安全（此前完全遗漏：任何持有 anon/publishable key 的登录用户
--    可对全库 players 表做任意 SELECT/INSERT/UPDATE/DELETE，高危。已在 V4.2.15 补上）
--   - 登录用户可读所有玩家（加入/展示需要）
--   - 玩家只能插入/更新/删除"自己"的行（user_id = auth.uid()）
--   - 房主可删除本房间的任意玩家行（踢人，靠 rooms.host_user_id 子查询判定）
-- 重新执行本脚本后生效。
-- ============================================================
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "players readable by authenticated" ON players;
CREATE POLICY "players readable by authenticated"
  ON players FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "players insert self" ON players;
CREATE POLICY "players insert self"
  ON players FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "players update self" ON players;
CREATE POLICY "players update self"
  ON players FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "players delete self" ON players;
CREATE POLICY "players delete self"
  ON players FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "players delete by host" ON players;
CREATE POLICY "players delete by host"
  ON players FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM rooms r
      WHERE r.code = players.room_code
        AND r.host_user_id = auth.uid()
    )
  );
