-- 001_init.sql —— 数据结构 v2（权限模型：超级管理员 / 班主任 / 老师 / 班干部）
-- 说明：v2 与 v1（含推广员、会员续费）不兼容；旧数据文件需删除后重新初始化。
PRAGMA foreign_keys = ON;

-- 班级：一个班级 = 一份独立的数据空间（学生、积分、商城、成绩、排座）
CREATE TABLE IF NOT EXISTS classes (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  school         TEXT DEFAULT '',
  grade          TEXT DEFAULT '',
  badge          TEXT DEFAULT '',
  owner_id       TEXT,                                  -- 班主任账号 id
  cadre_limit_per INTEGER NOT NULL DEFAULT 5,           -- 班干部单次加减分上限
  cadre_limit_day INTEGER NOT NULL DEFAULT 20,          -- 班干部每日加减分绝对值上限
  created_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  deleted_reason TEXT
);

-- 账号：超级管理员 + 班级成员（班主任 / 老师 / 班干部）
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN ('super_admin', 'class')),
  role          TEXT NOT NULL CHECK (role IN ('super_admin', 'owner', 'teacher', 'cadre')),
  class_id      TEXT REFERENCES classes (id) ON DELETE CASCADE,
  username      TEXT NOT NULL UNIQUE,                   -- 登录账号（手机号或自定义）
  phone         TEXT DEFAULT '',                        -- 手机号（仅超级管理员可见/可改）
  name          TEXT NOT NULL,                          -- 姓名
  pwd_hash      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  note          TEXT,
  deleted_at    INTEGER,
  deleted_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_accounts_class ON accounts (class_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts (role, deleted_at);

-- 会话：刷新令牌服务端存储，支持轮换与吊销
CREATE TABLE IF NOT EXISTS auth_sessions (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL,
  class_id   TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON auth_sessions (account_id);

-- 学生
CREATE TABLE IF NOT EXISTS students (
  id         TEXT PRIMARY KEY,
  class_id   TEXT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  group_name TEXT DEFAULT '',
  sex        TEXT DEFAULT '',
  position   TEXT DEFAULT '',
  points     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_students_class ON students (class_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_students_group ON students (class_id, group_name);

-- 积分流水：operator_* 记录「谁加的」，班干部操作可追溯
CREATE TABLE IF NOT EXISTS point_logs (
  id            TEXT PRIMARY KEY,
  class_id      TEXT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL,
  student_name  TEXT NOT NULL,
  delta         INTEGER NOT NULL,
  reason        TEXT DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'manual',         -- manual | batch | redeem | reset | import
  operator_id   TEXT DEFAULT '',
  operator_name TEXT DEFAULT '',
  operator_role TEXT DEFAULT '',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_class ON point_logs (class_id, created_at);
CREATE INDEX IF NOT EXISTS idx_logs_student ON point_logs (class_id, student_id);

-- 快捷加减分规则
CREATE TABLE IF NOT EXISTS quick_rules (
  id         TEXT PRIMARY KEY,
  class_id   TEXT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  score      INTEGER NOT NULL,
  sort_no    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rules_class ON quick_rules (class_id, sort_no);

-- 积分商城
CREATE TABLE IF NOT EXISTS gifts (
  id         TEXT PRIMARY KEY,
  class_id   TEXT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  cost       INTEGER NOT NULL,
  icon       TEXT DEFAULT '',
  stock      INTEGER,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_gifts_class ON gifts (class_id, deleted_at);

CREATE TABLE IF NOT EXISTS redemptions (
  id           TEXT PRIMARY KEY,
  class_id     TEXT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  gift_id      TEXT NOT NULL,
  gift_name    TEXT NOT NULL,
  cost         INTEGER NOT NULL,
  student_id   TEXT NOT NULL,
  student_name TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redemptions_class ON redemptions (class_id, created_at);

-- 考试与成绩
CREATE TABLE IF NOT EXISTS exams (
  id         TEXT PRIMARY KEY,
  class_id   TEXT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  full_score REAL NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_exams_class ON exams (class_id, deleted_at);

CREATE TABLE IF NOT EXISTS scores (
  id         TEXT PRIMARY KEY,
  class_id   TEXT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  exam_id    TEXT NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  score      REAL NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (exam_id, student_id)
);

-- 排座方案
CREATE TABLE IF NOT EXISTS seat_plans (
  class_id     TEXT PRIMARY KEY REFERENCES classes (id) ON DELETE CASCADE,
  cols         INTEGER NOT NULL DEFAULT 8,
  rows         INTEGER NOT NULL DEFAULT 7,
  scheme       TEXT DEFAULT 'points',
  seats        TEXT NOT NULL DEFAULT '[]',
  angle        TEXT NOT NULL DEFAULT 'teacher',
  confirmed_at INTEGER,
  updated_at   INTEGER
);

-- 回收站：清空/删除前的数据快照
CREATE TABLE IF NOT EXISTS recycle (
  id          TEXT PRIMARY KEY,
  class_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,                            -- clear_points | clear_all | account
  title       TEXT,
  payload     TEXT NOT NULL,
  operator_id TEXT DEFAULT '',
  created_at  INTEGER NOT NULL,
  restored_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_recycle_class ON recycle (class_id, created_at);

-- 超级管理员操作审计
CREATE TABLE IF NOT EXISTS admin_audit (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT NOT NULL,
  actor_name  TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT DEFAULT '',
  detail      TEXT DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON admin_audit (created_at);
