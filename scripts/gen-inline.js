'use strict';
/**
 * 生成内联模块（提交到仓库，供 EdgeOne 云函数打包使用）：
 * - server/src/db/migrations.generated.js ：把 migrations/*.sql 内联成 JS 模块
 * - server/src/db/sql-wasm.b64.js        ：把 sql.js 的 wasm 内联成 base64（云函数环境读不到包内文件）
 * 用法：node scripts/gen-inline.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_DIR = path.join(ROOT, 'server/src/db/migrations');
const DB_DIR = path.join(ROOT, 'server/src/db');

function genMigrations() {
  const files = fs
    .readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const entries = files.map((f) => `  ${JSON.stringify(f)}: ${JSON.stringify(fs.readFileSync(path.join(MIGRATION_DIR, f), 'utf8'))}`);
  const out = `'use strict';
// 本文件由 scripts/gen-inline.js 自动生成，请勿手工编辑；修改 migrations/*.sql 后重新生成。
module.exports = {
${entries.join(',\n')},
};
`;
  fs.writeFileSync(path.join(DB_DIR, 'migrations.generated.js'), out);
  console.log('migrations.generated.js ←', files.join(', '));
}

function genWasm() {
  const wasmPath = path.join(ROOT, 'node_modules/sql.js/dist/sql-wasm.wasm');
  if (!fs.existsSync(wasmPath)) {
    console.warn('未找到 sql-wasm.wasm（先 npm install），跳过 wasm 内联');
    return;
  }
  const b64 = fs.readFileSync(wasmPath).toString('base64');
  const out = `'use strict';
// 本文件由 scripts/gen-inline.js 自动生成（sql.js WebAssembly 二进制，base64），请勿手工编辑。
module.exports = { data: '${b64}' };
`;
  fs.writeFileSync(path.join(DB_DIR, 'sql-wasm.b64.js'), out);
  console.log('sql-wasm.b64.js ←', (b64.length / 1024 / 1024).toFixed(2), 'MB(base64)');
}

genMigrations();
genWasm();
