-- 005_sso_session.sql —— 会话来源标记（单点退出用）
-- 说明：只做加法，可安全重复执行（迁移表保证每个版本只跑一次）。
--
-- 背景：本站同时支持「账号密码」与「统一身份认证」两种登录。
--   via='sso'   → 父域 sso_token 消失（用户在任何站点点了退出）时立即失效
--   via='local' → 账号密码是独立凭据，不受统一身份认证退出影响

ALTER TABLE auth_sessions ADD COLUMN via TEXT DEFAULT 'local';

CREATE INDEX IF NOT EXISTS idx_sessions_via ON auth_sessions (via);
