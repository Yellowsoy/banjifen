'use strict';
/**
 * EdgeOne 云函数环境标记。必须作为云函数入口的第一个 import 执行，
 * 先于 config/db 加载，使持久化切换到 Blob 模式、跳过本地文件系统操作。
 */
process.env.EO_PERSIST = process.env.EO_PERSIST || 'blob';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
module.exports = {};
