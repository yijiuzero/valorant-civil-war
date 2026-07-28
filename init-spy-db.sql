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
-- 4. 原子化 Lobby 操作函数（消除 read-modify-write 竞态）
--    前端通过 supabase.rpc() 调用，Postgres 端在单事务内完成，
--    确保并发加入/离开不会互相覆盖。
--    SECURITY DEFINER 绕过 BEFORE UPDATE 触发器（这些函数由服务端精确控制）。
-- ============================================================

-- 4a. 原子追加玩家到 lobby 房间（刷新重连时按 user_id 去重）
DROP FUNCTION IF EXISTS public.lobby_add_player(text, text, text, integer);
CREATE OR REPLACE FUNCTION public.lobby_add_player(
  p_code     text,
  p_name     text,
  p_user_id  text,
  p_rank     integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_state jsonb;
  v_exists boolean;
BEGIN
  SELECT spy_state INTO v_state
  FROM rooms
  WHERE code = p_code AND status = 'lobby'
  FOR UPDATE;

  IF v_state IS NULL THEN
    RAISE EXCEPTION '房间不存在或已关闭';
  END IF;

  SELECT count(*) > 0 INTO v_exists
  FROM jsonb_array_elements(v_state->'players') p
  WHERE p->>'user_id' = p_user_id;

  IF v_exists THEN
    UPDATE rooms
    SET spy_state = jsonb_set(
      spy_state, '{players}',
      (SELECT jsonb_agg(
        CASE WHEN p->>'user_id' = p_user_id
          THEN jsonb_set(jsonb_set(p, '{name}', to_jsonb(p_name)), '{rank}', to_jsonb(p_rank))
          ELSE p
        END)
       FROM jsonb_array_elements(v_state->'players') p)
    )
    WHERE code = p_code
    RETURNING spy_state INTO v_state;
  ELSE
    IF jsonb_array_length(v_state->'players') >= 10 THEN
      RAISE EXCEPTION '房间已满（最多10人）';
    END IF;
    UPDATE rooms
    SET spy_state = jsonb_set(
      spy_state, '{players}',
      (v_state->'players') || jsonb_build_object(
        'name', p_name, 'user_id', p_user_id, 'team', null, 'rank', p_rank
      )
    )
    WHERE code = p_code
    RETURNING spy_state INTO v_state;
  END IF;

  RETURN v_state;
END;
$$;

-- 4b. 原子移除玩家（房主离开时自动转移给首个剩余玩家，无人则关闭）
DROP FUNCTION IF EXISTS public.lobby_remove_player(text, text);
CREATE OR REPLACE FUNCTION public.lobby_remove_player(
  p_code     text,
  p_user_id  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_state      jsonb;
  v_host       text;
  v_remaining  jsonb;
  v_new_host   text;
BEGIN
  SELECT spy_state, host_user_id INTO v_state, v_host
  FROM rooms
  WHERE code = p_code AND status = 'lobby'
  FOR UPDATE;

  IF v_state IS NULL THEN
    RAISE EXCEPTION '房间不存在或已关闭';
  END IF;

  SELECT jsonb_agg(p) INTO v_remaining
  FROM jsonb_array_elements(v_state->'players') p
  WHERE p->>'user_id' <> p_user_id;

  IF v_remaining IS NULL THEN
    v_remaining := '[]'::jsonb;
  END IF;

  v_state := jsonb_set(v_state, '{players}', v_remaining);

  IF v_host = p_user_id THEN
    IF jsonb_array_length(v_remaining) > 0 THEN
      v_new_host := v_remaining->0->>'user_id';
      UPDATE rooms
      SET spy_state = v_state, host_user_id = v_new_host
      WHERE code = p_code
      RETURNING spy_state INTO v_state;
    ELSE
      v_state := jsonb_set(v_state, '{phase}', '"closed"');
      UPDATE rooms
      SET spy_state = v_state
      WHERE code = p_code
      RETURNING spy_state INTO v_state;
    END IF;
  ELSE
    UPDATE rooms
    SET spy_state = v_state
    WHERE code = p_code
    RETURNING spy_state INTO v_state;
  END IF;

  RETURN jsonb_build_object(
    'spy_state', v_state,
    'host_user_id', COALESCE(v_new_host, v_host),
    'transferred', v_new_host IS NOT NULL
  );
END;
$$;

-- 4c. 原子设置玩家队伍（A/B/null）
DROP FUNCTION IF EXISTS public.lobby_set_player_team(text, text, text);
CREATE OR REPLACE FUNCTION public.lobby_set_player_team(
  p_code    text,
  p_user_id text,
  p_team    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_state jsonb;
BEGIN
  SELECT spy_state INTO v_state
  FROM rooms
  WHERE code = p_code AND status = 'lobby'
  FOR UPDATE;

  IF v_state IS NULL THEN
    RAISE EXCEPTION '房间不存在或已关闭';
  END IF;

  UPDATE rooms
  SET spy_state = jsonb_set(
    spy_state, '{players}',
    (SELECT jsonb_agg(
      CASE WHEN p->>'user_id' = p_user_id
        THEN jsonb_set(p, '{team}', CASE WHEN p_team IS NULL THEN 'null'::jsonb ELSE to_jsonb(p_team) END)
        ELSE p
      END)
     FROM jsonb_array_elements(v_state->'players') p)
  )
  WHERE code = p_code
  RETURNING spy_state INTO v_state;

  RETURN v_state;
END;
$$;

-- 4d. 原子开始内鬼（服务端随机选内鬼 + 分配任务，仅房主调用）
DROP FUNCTION IF EXISTS public.lobby_start_spy(text);
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
  v_spy_a_name text;
  v_spy_b_name text;
  v_tasks      jsonb;
  v_player     jsonb;
  v_total      integer;
BEGIN
  SELECT spy_state, host_user_id INTO v_state, v_host
  FROM rooms
  WHERE code = p_code AND status = 'lobby'
  FOR UPDATE;

  IF v_state IS NULL THEN
    RAISE EXCEPTION '房间不存在或已关闭';
  END IF;

  -- 仅房主可开始内鬼模式
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

  v_spy_a_name := v_team_a->(floor(random() * jsonb_array_length(v_team_a))::int)->>'name';
  v_spy_b_name := v_team_b->(floor(random() * jsonb_array_length(v_team_b))::int)->>'name';

  v_tasks := '{}'::jsonb;
  v_total := jsonb_array_length(v_state->'players');
  FOR i IN 0..v_total-1 LOOP
    v_player := v_state->'players'->i;
    v_tasks := jsonb_set(v_tasks, ARRAY[v_player->>'name'], to_jsonb(i % 12));
  END LOOP;

  v_state := jsonb_set(v_state, '{phase}', '"playing"');
  v_state := jsonb_set(v_state, '{team_a}', COALESCE(v_team_a, '[]'::jsonb));
  v_state := jsonb_set(v_state, '{team_b}', COALESCE(v_team_b, '[]'::jsonb));
  v_state := jsonb_set(v_state, '{team_a_spy_name}', to_jsonb(v_spy_a_name));
  v_state := jsonb_set(v_state, '{team_b_spy_name}', to_jsonb(v_spy_b_name));
  v_state := jsonb_set(v_state, '{tasks}', v_tasks);

  UPDATE rooms
  SET spy_state = v_state
  WHERE code = p_code
  RETURNING spy_state INTO v_state;

  RETURN v_state;
END;
$$;

-- 4e. 原子揭晓内鬼
DROP FUNCTION IF EXISTS public.lobby_reveal_spy(text);
CREATE OR REPLACE FUNCTION public.lobby_reveal_spy(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_state jsonb;
  v_host  uuid;
BEGIN
  SELECT spy_state, host_user_id INTO v_state, v_host
  FROM rooms
  WHERE code = p_code AND status = 'lobby'
  FOR UPDATE;

  IF v_state IS NULL THEN
    RAISE EXCEPTION '房间不存在或已关闭';
  END IF;

  -- 仅房主可揭晓内鬼
  IF v_host IS NULL OR v_host != auth.uid() THEN
    RAISE EXCEPTION '仅房主可揭晓内鬼';
  END IF;

  v_state := jsonb_set(v_state, '{phase}', '"revealed"');

  UPDATE rooms
  SET spy_state = v_state
  WHERE code = p_code
  RETURNING spy_state INTO v_state;

  RETURN v_state;
END;
$$;

-- 4f. 原子重置内鬼
DROP FUNCTION IF EXISTS public.lobby_reset_spy(text);
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
  FROM rooms
  WHERE code = p_code AND status = 'lobby'
  FOR UPDATE;

  IF v_state IS NULL THEN
    RAISE EXCEPTION '房间不存在或已关闭';
  END IF;

  -- 仅房主可重置内鬼
  IF v_host IS NULL OR v_host != auth.uid() THEN
    RAISE EXCEPTION '仅房主可重置内鬼';
  END IF;

  v_state := jsonb_set(v_state, '{phase}', '"lobby"');
  v_state := jsonb_set(v_state, '{team_a}', '[]'::jsonb);
  v_state := jsonb_set(v_state, '{team_b}', '[]'::jsonb);
  v_state := jsonb_set(v_state, '{team_a_spy_name}', 'null'::jsonb);
  v_state := jsonb_set(v_state, '{team_b_spy_name}', 'null'::jsonb);
  v_state := jsonb_set(v_state, '{tasks}', '{}'::jsonb);
  v_state := jsonb_set(v_state, '{players}',
    (SELECT jsonb_agg(jsonb_set(p, '{team}', 'null'::jsonb))
     FROM jsonb_array_elements(v_state->'players') p)
  );

  UPDATE rooms
  SET spy_state = v_state
  WHERE code = p_code
  RETURNING spy_state INTO v_state;

  RETURN v_state;
END;
$$;

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
    AND user_id != auth.uid()  -- 不能删除自己
  );

-- 安全踢人函数（security definer，严格校验房主身份）
DROP FUNCTION IF EXISTS public.kick_player(text, integer);
CREATE OR REPLACE FUNCTION public.kick_player(
  p_room_code text,
  p_player_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_host    uuid;
  v_target  jsonb;
BEGIN
  -- 查找房间
  SELECT host_user_id INTO v_host
  FROM rooms
  WHERE code = p_room_code;

  IF v_host IS NULL THEN
    RAISE EXCEPTION '房间不存在';
  END IF;

  -- 仅房主可踢人
  IF v_host != auth.uid() THEN
    RAISE EXCEPTION '仅房主可踢人';
  END IF;

  -- 查找目标玩家
  SELECT jsonb_build_object('id', id, 'name', name, 'user_id', user_id)
  INTO v_target
  FROM players
  WHERE id = p_player_id AND room_code = p_room_code;

  IF v_target IS NULL THEN
    RAISE EXCEPTION '玩家不存在';
  END IF;

  -- 不能踢自己
  IF (v_target->>'user_id')::text = auth.uid()::text THEN
    RAISE EXCEPTION '不能踢出自己';
  END IF;

  -- 执行删除
  DELETE FROM players WHERE id = p_player_id AND room_code = p_room_code;

  RETURN v_target;
END;
$$;

-- 唯一约束：防止同一用户在同一房间有多个玩家行（防前端竞态）
-- 唯一约束：防止同一用户在同一房间有多个玩家行（防前端竞态）
ALTER TABLE players DROP CONSTRAINT IF EXISTS uniq_player_room_user;
ALTER TABLE players ADD CONSTRAINT uniq_player_room_user
  UNIQUE (room_code, user_id);
