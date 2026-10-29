-- 004 站点访问统计（自建，超管后台展示真实 PV / UV / 今日 / 在线）
-- 设计要点：
--   1) 只记「去重后的日活」而非每次请求，避免把每张截图请求都当一次访问刷大数字；
--   2) 用 visitor_hash（IP + UA + 当天盐 的哈希）做匿名去重，不存原始 IP，符合隐私最小化；
--   3) 路径归一化后仅保留一级页面名，不记录查询串（家长查询口令在 URL 里，绝不能落库）。
-- 只做加法，可安全重复执行。

-- 每位访客每天一行：用于 UV / PV 统计
CREATE TABLE IF NOT EXISTS visit_daily (
  day         TEXT NOT NULL,             -- YYYY-MM-DD（服务器本地时区）
  visitor_hash TEXT NOT NULL,            -- 匿名访客指纹（不含原始 IP）
  first_at    INTEGER NOT NULL,          -- 当日首次访问时间
  last_at     INTEGER NOT NULL,          -- 当日最后访问时间
  hits        INTEGER NOT NULL DEFAULT 1,-- 当日该访客访问次数
  PRIMARY KEY (day, visitor_hash)
);

CREATE INDEX IF NOT EXISTS idx_visit_daily_day ON visit_daily (day);

-- 页面维度汇总：用于「热门页面」排行
CREATE TABLE IF NOT EXISTS visit_page (
  day       TEXT NOT NULL,
  path      TEXT NOT NULL,               -- 归一化后的页面路径，如 /index.html、/query.html
  pv        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);

CREATE INDEX IF NOT EXISTS idx_visit_page_day ON visit_page (day);
