'use strict';
/**
 * 启动入口：
 * 1) 校验配置（config.js 中失败即抛错）
 * 2) 初始化数据库 + 迁移
 * 3) 写入种子数据（管理员 / 演示班级）
 * 4) 启动 HTTP 服务，注册优雅停机
 */
const { config } = require('./config');
const { logger } = require('./core/logger');

async function main() {
  const db = require('./db');
  await db.init();
  require('./seed').runSeed({ silent: true });

  const { createApp } = require('./app');
  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info('服务已启动', {
      port: config.port,
      env: config.env,
      url: `http://localhost:${config.port}`,
      db: config.dbFile,
    });
  });

  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    logger.info('收到退出信号，开始优雅停机', { signal });
    const timer = setTimeout(() => {
      logger.error('停机超时，强制退出');
      process.exit(1);
    }, 10_000);
    timer.unref();
    server.close(() => {
      try {
        db.close();
      } catch (err) {
        logger.error('关闭数据库失败', { err: err.message });
      }
      logger.info('已安全退出');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('未处理的 Promise 拒绝', { reason: String(reason) });
  });
  process.on('uncaughtException', (err) => {
    logger.error('未捕获异常', { err: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.error('启动失败', { err: err.message, stack: err.stack });
  process.exit(1);
});
