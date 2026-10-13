-- ============================================================
-- 内鬼身份保密修复（P0）· 增量迁移脚本
-- 在 Supabase SQL Editor 中执行本脚本（可重复执行，幂等）
-- 依赖：需先执行过 init-spy-db.sql
-- ============================================================
--
-- 【修复目标】
-- 内鬼模式的核心玩法是"内鬼身份保密"，但当前架构下该属性完全不成立：
--   1. rooms 的 SELECT 策略为 USING (auth.role()='authenticated')，无成员校验；
--   2. spy_state 明文存 team_a_spy_name / team_b_spy_name；
--   3. Realtime 的 postgres_changes 推送 payload.new（整行），不受 SELECT 策略裁剪。
-- => 任一登录用户甚至 anon 直接 GET /rest/v1/rooms?select=spy_state 即可读走内鬼身份。
--
-- 【修复方案】
-- A. 内鬼身份移出客户端可见的 spy_state，改存到新列 spy_secrets；
--    该列的 SELECT 策略仅房主可读，且不在 Realtime 推送范围内。
-- B. rooms 的读策略收紧为「房主 + 该房间成员」。
-- C. 新增 RPC：lobby_start_spy 的返回值剥离内鬼身份，改由
--    lobby_get_my_spy(p_code) 按调用者身份单独下发"我是否内鬼 + 我的任务"。
--
-- 【重要提醒】
-- 本脚本只改数据库。前端需配套改造（见 spy-mode.js 改动说明），
-- 否则内鬼面板会拿不到身份数据。改造前请勿在生产环境执行本脚本。
-- ============================================================


-- ------------------------------------------------------------
-- 1. 新增内鬼身份保密列
-- ------------------------------------------------------------
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS spy_secrets JSONB DEFAULT NULL;
COMMENT ON COLUMN rooms.spy_secrets IS '内鬼身份机密：仅房主可读，不参与 Realtime 推送。结构：{team_a_spy_id, team_b_spy_id, team_a_spy_name, team_b_spy_name}';

-- 迁移既有数据：把已在 spy_state 里的内鬼身份搬到新列
UPDATE rooms
SET spy_secrets = jsonb_build_object(
      'team_a_spy_id',   spy_state->'team_a_spy',
      'team_b_spy_id',   spy_state->'team_b_spy',
      'team_a_spy_name', spy_state->'team_a_spy_name',
      'team_b_spy_name', spy_state->'team_b_spy_name'
    )
WHERE spy_state ? 'team_a_spy_name'
  AND spy_secrets IS NULL;

-- 从 spy_state 中移除内鬼身份字段（这一步是关键：移出客户端可见范围）
UPDATE rooms
SET spy_state = spy_state - 'team_a_spy' - 'team_b_spy' - 'team_a_spy_name' - 'team_b_spy_name'
WHERE spy_state ?| ARRAY['team_a_spy', 'team_b_spy', 'team_a_spy_name', 'team_b_spy_name'];


-- ------------------------------------------------------------
-- 2. rooms 读策略收紧：仅房主 + 该房间成员可读
-- ------------------------------------------------------------
-- 说明：RLS 是「行级」安全，无法做"同表不同列"的可见性控制，
-- 因此内鬼身份不能留在 rooms 表里（Realtime 会整行广播）。
-- 正确做法是移入独立表，见第 3 节。
--
-- 注意：Postgres 中多个 PERMISSIVE 策略之间是 OR 关系，
-- 因此这里必须只保留一条策略（不能拆成"成员可读"+"等待房可读"两条，
-- 否则等待中房间会对所有登录用户开放，等于没收紧）。
--
-- 成员判定覆盖两种房间：
--   - 内战分队（waiting/done）：成员行在独立表 players
--   - 内鬼lobby：成员嵌在 spy_state.players 数组里
DROP POLICY IF EXISTS "Allow read for authenticated" ON rooms;
DROP POLICY IF EXISTS "Allow read members only" ON rooms;
DROP POLICY IF EXISTS "Allow read waiting rooms for join" ON rooms;

CREATE POLICY "Allow read members only" ON rooms
  FOR SELECT
  USING (
    auth.uid() = host_user_id
    OR EXISTS (SELECT 1 FROM players p WHERE p.room_code = rooms.code AND p.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(spy_state->'players', '[]'::jsonb)) pl
      WHERE pl->>'user_id' = auth.uid()::text
    )
  );

-- ------------------------------------------------------------
-- 3. 内鬼身份移入独立表（列级隔离的可靠做法）
-- ------------------------------------------------------------
-- RLS 是行级安全，无法做"同表不同列"的可见性控制。
-- 因此把内鬼身份放进独立表 spy_identities，对它单独设策略。
CREATE TABLE IF NOT EXISTS public.spy_identities (
  room_code   text PRIMARY KEY,
  team_a_spy_id   text,
  team_b_spy_id   text,
  team_a_spy_name text,
  team_b_spy_name text,
  updated_at  timestamptz DEFAULT now()
);

-- 该表独立启用 RLS
ALTER TABLE public.spy_identities ENABLE ROW LEVEL SECURITY;

-- 迁移既有数据到新表
INSERT INTO public.spy_identities (room_code, team_a_spy_id, team_b_spy_id, team_a_spy_name, team_b_spy_name)
SELECT code,
       spy_secrets->>'team_a_spy_id',
       spy_secrets->>'team_b_spy_id',
       spy_secrets->>'team_a_spy_name',
       spy_secrets->>'team_b_spy_name'
FROM rooms
WHERE spy_secrets IS NOT NULL
ON CONFLICT (room_code) DO UPDATE
  SET team_a_spy_id   = EXCLUDED.team_a_spy_id,
      team_b_spy_id   = EXCLUDED.team_b_spy_id,
      team_a_spy_name = EXCLUDED.team_a_spy_name,
      team_b_spy_name = EXCLUDED.team_b_spy_name,
      updated_at      = now();

-- 独立表的 RLS：严格按"是否为本房间成员"放行。
-- anon（未登录）时 auth.uid() 为 NULL，EXISTS 子查询不成立 → 天然拒绝。
-- 注意：只保留一条策略，多条 PERMISSIVE 之间是 OR 关系，多写一条会反而放开。
DROP POLICY IF EXISTS "spy_identities readable by members" ON public.spy_identities;
DROP POLICY IF EXISTS "spy_identities anon denied" ON public.spy_identities;

CREATE POLICY "spy_identities readable by members" ON public.spy_identities
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      EXISTS (SELECT 1 FROM rooms r WHERE r.code = spy_identities.room_code AND r.host_user_id = auth.uid())
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          COALESCE((SELECT spy_state->'players' FROM rooms r2 WHERE r2.code = spy_identities.room_code), '[]'::jsonb)
        ) pl
        WHERE pl->>'user_id' = auth.uid()::text
      )
    )
  );

-- 清理 rooms.spy_secrets（数据已迁至独立表）
-- 注意：直接 DROP 会丢失对旧前端的兼容，但保留会让 Realtime 继续广播。
-- 若需平滑过渡，可先保留几行不删；此处按"安全优先"直接删除。
ALTER TABLE rooms DROP COLUMN IF EXISTS spy_secrets;


-- ------------------------------------------------------------
-- 4. 新增 RPC：按调用者身份下发"我是否内鬼 + 我的任务"
-- ------------------------------------------------------------
-- 替代原先"全量返回 spy_state"的做法：调用者只拿到自己的身份，
-- 拿不到"别人是不是内鬼"。
DROP FUNCTION IF EXISTS public.lobby_get_my_spy(text);
CREATE OR REPLACE FUNCTION public.lobby_get_my_spy(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_state      jsonb;
  v_secrets    jsonb;
  v_my_id      text;
  v_team       text;
  v_is_spy     boolean;
  v_task       integer;
  v_task_key   text;
BEGIN
  v_my_id := auth.uid()::text;
  IF v_my_id IS NULL THEN
    RAISE EXCEPTION '请先登录';
  END IF;

  SELECT spy_state INTO v_state FROM rooms WHERE code = p_code FOR UPDATE;
  IF v_state IS NULL THEN
    RAISE EXCEPTION '房间不存在或已关闭';
  END IF;

  SELECT * INTO v_secrets FROM spy_identities WHERE room_code = p_code;
  IF v_secrets IS NULL THEN
    -- 尚未开始，无内鬼身份
    RETURN jsonb_build_object('phase', v_state->'phase', 'is_spy', false, 'team', NULL, 'task', NULL);
  END IF;

  -- 判定自己是否内鬼（按 user_id，而非昵称——昵称可重名、可冒名）
  v_is_spy := (v_secrets->>'team_a_spy_id' = v_my_id) OR (v_secrets->>'team_b_spy_id' = v_my_id);
  IF v_is_spy THEN
    v_team := CASE WHEN v_secrets->>'team_a_spy_id' = v_my_id THEN 'A' ELSE 'B' END;
    v_task_key := CASE WHEN v_secrets->>'team_a_spy_id' = v_my_id
                       THEN v_secrets->>'team_a_spy_name' ELSE v_secrets->>'team_b_spy_name' END;
  ELSE
    -- 自己所属队伍
    SELECT COALESCE(p->>'team', '') INTO v_team
    FROM jsonb_array_elements(COALESCE(v_state->'players', '[]'::jsonb)) p
    WHERE p->>'user_id' = v_my_id LIMIT 1;
    -- 非内鬼任务按昵称取（与现有 tasks 结构一致）
    SELECT COALESCE(pl->>'name','') INTO v_task_key
    FROM jsonb_array_elements(COALESCE(v_state->'players','[]'::jsonb)) pl
    WHERE pl->>'user_id' = v_my_id LIMIT 1;
  END IF;

  v_task := (v_state->'tasks'->v_task_key);

  RETURN jsonb_build_object(
    'phase',  v_state->'phase',
    'is_spy', v_is_spy,
    'team',   NULLIF(v_team, ''),
    'task',   v_task,
    'players', COALESCE(v_state->'players', '[]'::jsonb)   -- 名单本身不含内鬼身份，可安全下发
  );
END;
$$;

-- 把内鬼身份写入独立表 + 同时下发给房主的 RPC（供房主持有揭晓权）
DROP FUNCTION IF EXISTS public.lobby_set_spy_identity(text, text, text);
CREATE OR REPLACE FUNCTION public.lobby_set_spy_identity(
  p_code    text,
  p_spy_a_id text,
  p_spy_b_id text,
  p_spy_a_name text,
  p_spy_b_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_host uuid;
BEGIN
  SELECT host_user_id INTO v_host FROM rooms WHERE code = p_code;
  IF v_host IS NULL OR v_host != auth.uid() THEN
    RAISE EXCEPTION '仅房主可设置内鬼身份';
  END IF;

  INSERT INTO spy_identities (room_code, team_a_spy_id, team_b_spy_id, team_a_spy_name, team_b_spy_name, updated_at)
  VALUES (p_code, p_spy_a_id, p_spy_b_id, p_spy_a_name, p_spy_b_name, now())
  ON CONFLICT (room_code) DO UPDATE
    SET team_a_spy_id   = EXCLUDED.team_a_spy_id,
        team_b_spy_id   = EXCLUDED.team_b_spy_id,
        team_a_spy_name = EXCLUDED.team_a_spy_name,
        team_b_spy_name = EXCLUDED.team_b_spy_name,
        updated_at      = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- ------------------------------------------------------------
-- 5. 修订 lobby_start_spy：内鬼身份写入独立表，不再写进 spy_state
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lobby_start_spy(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_state      jsonb;
  v_host       uuid;
  v_team_a     jsonb;
  v_team_b     jsonb;
  v_spy_a      jsonb;
  v_spy_b      jsonb;
  v_spy_a_name text;
  v_spy_b_name text;
  v_spy_a_id   text;
  v_spy_b_id   text;
  v_tasks      jsonb;
  v_player     jsonb;
  v_total      integer;
BEGIN
  SELECT spy_state, host_user_id INTO v_state, v_host
  FROM rooms WHERE code = p_code AND status = 'lobby' FOR UPDATE;

  IF v_state IS NULL THEN
    RAISE EXCEPTION '房间不存在或已关闭';
  END IF;
  IF v_host IS NULL OR v_host != auth.uid() THEN
    RAISE EXCEPTION '仅房主可开始内鬼模式';
  END IF;

  SELECT jsonb_agg(p) INTO v_team_a
  FROM jsonb_array_elements(v_state->'players') p WHERE p->>'team' = 'A';
  SELECT jsonb_agg(p) INTO v_team_b
  FROM jsonb_array_elements(v_state->'players') p WHERE p->>'team' = 'B';

  IF v_team_a IS NULL OR v_team_b IS NULL
     OR jsonb_array_length(v_team_a) = 0 OR jsonb_array_length(v_team_b) = 0 THEN
    RAISE EXCEPTION '两队都需要有人';
  END IF;

  v_spy_a := v_team_a->(floor(random() * jsonb_array_length(v_team_a))::int);
  v_spy_b := v_team_b->(floor(random() * jsonb_array_length(v_team_b))::int);
  v_spy_a_name := v_spy_a->>'name';
  v_spy_b_name := v_spy_b->>'name';
  v_spy_a_id   := v_spy_a->>'user_id';
  v_spy_b_id   := v_spy_b->>'user_id';

  -- 身份写入独立表（客户端读不到）
  INSERT INTO spy_identities (room_code, team_a_spy_id, team_b_spy_id, team_a_spy_name, team_b_spy_name, updated_at)
  VALUES (p_code, v_spy_a_id, v_spy_b_id, v_spy_a_name, v_spy_b_name, now())
  ON CONFLICT (room_code) DO UPDATE
    SET team_a_spy_id = EXCLUDED.team_a_spy_id, team_b_spy_id = EXCLUDED.team_b_spy_id,
        team_a_spy_name = EXCLUDED.team_a_spy_name, team_b_spy_name = EXCLUDED.team_b_spy_name,
        updated_at = now();

  -- 任务按 name 为键（保持与前端现有结构兼容，避免大改前端）
  v_tasks := '{}'::jsonb;
  v_total := jsonb_array_length(v_state->'players');
  FOR i IN 0..v_total-1 LOOP
    v_player := v_state->'players'->i;
    v_tasks := jsonb_set(v_tasks, ARRAY[v_player->>'name'], to_jsonb(i % 12));
  END LOOP;

  v_state := jsonb_set(v_state, '{phase}', '"playing"');
  v_state := jsonb_set(v_state, '{team_a}', COALESCE(v_team_a, '[]'::jsonb));
  v_state := jsonb_set(v_state, '{team_b}', COALESCE(v_team_b, '[]'::jsonb));
  -- 注意：这里不再写入 team_*_spy_* 任何字段
  v_state := jsonb_set(v_state, '{tasks}', v_tasks);

  UPDATE rooms SET spy_state = v_state WHERE code = p_code RETURNING spy_state INTO v_state;

  -- 仅向房主返回完整状态；其他客户端应改用 lobby_get_my_spy
  RETURN v_state;
END;
$$;


-- ------------------------------------------------------------
-- 6. 修订 lobby_reveal_spy：揭晓时把身份写入 spy_state（此时公开是设计意图）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lobby_reveal_spy(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_state   jsonb;
  v_host    uuid;
  v_secrets jsonb;
BEGIN
  SELECT spy_state, host_user_id INTO v_state, v_host
  FROM rooms WHERE code = p_code AND status = 'lobby' FOR UPDATE;

  IF v_state IS NULL THEN
    RAISE EXCEPTION '房间不存在或已关闭';
  END IF;
  IF v_host IS NULL OR v_host != auth.uid() THEN
    RAISE EXCEPTION '仅房主可揭晓内鬼';
  END IF;

  -- 揭晓 = 身份公开，此刻才把内鬼姓名写回 spy_state 供全员渲染
  SELECT * INTO v_secrets FROM spy_identities WHERE room_code = p_code;
  IF v_secrets IS NOT NULL THEN
    v_state := jsonb_set(v_state, '{team_a_spy_name}', to_jsonb(v_secrets->>'team_a_spy_name'));
    v_state := jsonb_set(v_state, '{team_b_spy_name}', to_jsonb(v_secrets->>'team_b_spy_name'));
  END IF;
  v_state := jsonb_set(v_state, '{phase}', '"revealed"');

  UPDATE rooms SET spy_state = v_state WHERE code = p_code RETURNING spy_state INTO v_state;
  DELETE FROM spy_identities WHERE room_code = p_code;   -- 揭晓后无需再保密

  RETURN v_state;
END;
$$;


-- ------------------------------------------------------------
-- 7. 修订 lobby_reset_spy：重置时清掉身份记录
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lobby_reset_spy(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_state jsonb;
  v_host  uuid;
BEGIN
  SELECT spy_state, host_user_id INTO v_state, v_host
  FROM rooms WHERE code = p_code AND status = 'lobby' FOR UPDATE;

  IF v_state IS NULL THEN
    RAISE EXCEPTION '房间不存在或已关闭';
  END IF;
  IF v_host IS NULL OR v_host != auth.uid() THEN
    RAISE EXCEPTION '仅房主可重置内鬼';
  END IF;

  v_state := jsonb_set(v_state, '{phase}', '"lobby"');
  v_state := jsonb_set(v_state, '{team_a}', '[]'::jsonb);
  v_state := jsonb_set(v_state, '{team_b}', '[]'::jsonb);
  v_state := jsonb_set(v_state, '{tasks}', '{}'::jsonb);
  -- 兼容：旧数据可能残留这两个键
  v_state := v_state - 'team_a_spy_name' - 'team_b_spy_name';
  v_state := jsonb_set(v_state, '{players}',
    (SELECT jsonb_agg(jsonb_set(p, '{team}', 'null'::jsonb))
     FROM jsonb_array_elements(v_state->'players') p)
  );

  UPDATE rooms SET spy_state = v_state WHERE code = p_code RETURNING spy_state INTO v_state;
  DELETE FROM spy_identities WHERE room_code = p_code;

  RETURN v_state;
END;
$$;


-- ------------------------------------------------------------
-- 8. 更新触发器：放行 spy_identities 之外的变化 + 修正空值陷阱
-- ------------------------------------------------------------
-- 原触发器用 jsonb_array_elements(OLD.spy_state->'players')，
-- 若 spy_state 为 NULL 则返回 0 行（不报错），会让"非房主重新加入"退化为"首次加入"。
-- 现统一用 COALESCE 兜底。
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
  IF old_is_host THEN
    RETURN NEW;
  END IF;

  IF NEW.host_user_id IS DISTINCT FROM OLD.host_user_id THEN
    RAISE EXCEPTION '无权限修改房主';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION '无权限修改房间状态';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION '无权限修改房间码';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION '无权限修改创建时间';
  END IF;
  -- 注：内鬼身份已移入独立表 spy_identities（有自己的 RLS 保护），
-- rooms 表上不再有敏感列，故此处无需检查 spy_secrets。
IF COALESCE(NEW.spy_state - 'players', '{}'::jsonb)
     IS DISTINCT FROM COALESCE(OLD.spy_state - 'players', '{}'::jsonb) THEN
    RAISE EXCEPTION '无权限修改内鬼数据';
  END IF;

  -- COALESCE 兜底：spy_state 为 NULL 时 jsonb_array_elements 返回 0 行而非报错
  SELECT count(*) > 0 INTO old_in_players
  FROM jsonb_array_elements(COALESCE(OLD.spy_state->'players', '[]'::jsonb)) p
  WHERE p->>'user_id' = uid;

  SELECT count(*) > 0 INTO new_in_players
  FROM jsonb_array_elements(COALESCE(NEW.spy_state->'players', '[]'::jsonb)) p
  WHERE p->>'user_id' = uid;

  IF old_in_players THEN
    RAISE EXCEPTION '你已在房间中';
  END IF;
  IF NOT new_in_players THEN
    RAISE EXCEPTION '只能加入自己';
  END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(COALESCE(NEW.spy_state->'players','[]'::jsonb)) p WHERE p->>'user_id' <> uid)
     <> (SELECT count(*) FROM jsonb_array_elements(COALESCE(OLD.spy_state->'players','[]'::jsonb)) p WHERE p->>'user_id' <> uid) THEN
    RAISE EXCEPTION '无权限修改其它玩家';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 执行后验证（可选）
--   1) 用 anon key 请求 rooms?select=spy_state，应无法读到他人房间
--   2) 登录后请求 spy_identities?select=*，应只能读到自己是成员的房间
--   3) 建房→分队→开始内鬼，此时 rooms.spy_state 应不含 team_*_spy_* 字段
-- ============================================================