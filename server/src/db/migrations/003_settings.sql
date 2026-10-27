-- 003 全局平台设置（键值对）
-- 用于存放跨班级的开关/配置，例如「成绩自助查询总开关」。
-- 只做加法，可安全重复执行。

CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_settings_key ON platform_settings (key);
