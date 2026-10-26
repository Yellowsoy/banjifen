'use strict';
const { RateLimitError } = require('../core/errors');

/**
 * 极简固定窗口限流（单进程内存）。生产多实例部署时应替换为 Redis 实现，
 * 这里保持零依赖，够用于登录/注册等敏感接口的频率保护。
 */
function rateLimit({ windowMs = 60_000, max = 30, keyFn = (req) => req.ip, message } = {}) {
  const buckets = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, item] of buckets) {
      if (item.resetAt <= now) buckets.delete(key);
    }
  }, windowMs).unref?.();

  return (req, res, next) => {
    const key = String(keyFn(req) || 'anon');
    const now = Date.now();
    let item = buckets.get(key);
    if (!item || item.resetAt <= now) {
      item = { count: 0, resetAt: now + windowMs };
      buckets.set(key, item);
    }
    item.count += 1;
    if (item.count > max) {
      res.setHeader('retry-after', Math.ceil((item.resetAt - now) / 1000));
      return next(new RateLimitError(message));
    }
    return next();
  };
}

module.exports = { rateLimit };
