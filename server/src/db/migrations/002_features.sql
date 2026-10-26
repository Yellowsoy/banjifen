-- 002_features.sql —— 学生档案扩展、全量操作日志、成绩对外查询
-- 说明：本迁移只做「加法」（新增列 / 新表），不会破坏已有数据，可安全重复执行。
PRAGMA foreign_keys = ON;

/* ============ 1. 学生档案扩展（家长联系方式等基本信息） ============ */
ALTER TABLE students ADD COLUMN student_no        TEXT DEFAULT '';  -- 学号
ALTER TABLE students ADD COLUMN birthday          TEXT DEFAULT '';  -- 出生日期 YYYY-MM-DD
ALTER TABLE students ADD COLUMN address           TEXT DEFAULT '';  -- 家庭住址
ALTER TABLE students ADD COLUMN guardian_name     TEXT DEFAULT '';  -- 家长姓名
ALTER TABLE students ADD COLUMN guardian_phone    TEXT DEFAULT '';  -- 家长联系电话
ALTER TABLE students ADD COLUMN guardian_relation TEXT DEFAULT '';  -- 与本人关系（父/母/爷爷…）
ALTER TABLE students ADD COLUMN guardian_alt_phone TEXT DEFAULT ''; -- 备用联系电话
ALTER TABLE students ADD COLUMN note              TEXT DEFAULT '';  -- 备注

CREATE INDEX IF NOT EXISTS idx_students_no ON students (class_id, student_no);

/* ============ 2. 全量操作日志（超管可追溯每一步、每个人、每个账号） ============ */
CREATE TABLE IF NOT EXISTS operation_logs (
  id           TEXT PRIMARY KEY,
  created_at   INTEGER NOT NULL,               -- 操作时间
  actor_id     TEXT DEFAULT '',                -- 操作者账号 id
  actor_name   TEXT DEFAULT '',                -- 操作者姓名
  actor_role   TEXT DEFAULT '',                -- 操作者角色（super_admin/owner/teacher/cadre）
  class_id     TEXT DEFAULT '',                -- 所属班级 id
  class_name   TEXT DEFAULT '',                -- 所属班级名称快照
  module       TEXT NOT NULL,                  -- 业务模块：auth/class/members/super/backup/query
  action       TEXT NOT NULL,                  -- 动作：student.create / points.apply …
  target_type  TEXT DEFAULT '',                -- 目标类型：student/account/class/gift/exam …
  target_id    TEXT DEFAULT '',                -- 目标 id
  target_name  TEXT DEFAULT '',                -- 目标名称快照
  summary      TEXT DEFAULT '',                -- 一句话摘要（给超管直接阅读）
  amount       TEXT DEFAULT '',                -- 关联数量：如 ±3 分 / 影响 12 人
  result       TEXT NOT NULL DEFAULT 'success',-- success | failed
  status_code  INTEGER DEFAULT 0,              -- HTTP 状态码
  detail       TEXT DEFAULT '',                -- 完整上下文 JSON（请求参数、before/after 快照等）
  ip           TEXT DEFAULT '',                -- 来源 IP
  user_agent   TEXT DEFAULT ''                 -- 浏览器标识
);
CREATE INDEX IF NOT EXISTS idx_oplogs_time   ON operation_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_oplogs_class  ON operation_logs (class_id, created_at);
CREATE INDEX IF NOT EXISTS idx_oplogs_actor  ON operation_logs (actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_oplogs_module ON operation_logs (module, action);

/* ============ 3. 成绩对外查询（免登录公开口令） ============ */
CREATE TABLE IF NOT EXISTS query_tokens (
  id          TEXT PRIMARY KEY,
  class_id    TEXT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,             -- 公开查询口令
  name        TEXT DEFAULT '',                  -- 用途备注（如：期末成绩查询）
  scope       TEXT NOT NULL DEFAULT 'scores',   -- scores | points | all
  mode        TEXT NOT NULL DEFAULT 'name_no',  -- name_no（学号+姓名）| phone（家长手机号后4位）| none
  enabled     INTEGER NOT NULL DEFAULT 1,
  expires_at  INTEGER,                          -- 为空表示长期有效
  created_by  TEXT DEFAULT '',
  created_at  INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_query_token_class ON query_tokens (class_id, created_at);
