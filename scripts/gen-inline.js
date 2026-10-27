'use strict';
/**
 * 生成内联模块（提交到仓库，供 EdgeOne 云函数打包使用）：
 * - server/src/db/migrations.generated.js ：把 migrations/*.sql 内联成 JS 模块
 * - server/src/db/sql-wasm.b64.js        ：把 sql.js 的 wasm 内联成 base64（云函数环境读不到包内文件）
 * - server/src/db/sql-wasm-loader.js     ：把 sql.js 的 loader 内联进仓库（仅 46KB）
 *
 * 为什么要有 loader：
 *   sql.js 整个 npm 包约 30MB（含 asm 调试版、zip、浏览器版等用不到的文件），
 *   而云函数实际只需要 dist/sql-wasm.js（46KB）+ wasm 二进制。
 *   wasm 已内联为 base64，loader 也随仓库提交后，生产依赖即可去掉 sql.js，
 *   云函数代码包从 ~50MB 降到 ~10MB，冷启动解压与加载显著加快。
 *
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

/**
 * 生成 sql.js loader：把 node_modules/sql.js/dist/sql-wasm.js 复制到 server/src/db/。
 * loader 本身是 UMD 模块，module.exports = initSqlJs，运行时传入内联的 wasmBinary 即可，
 * 不再依赖 sql.js 包存在（生产依赖中已移除 sql.js）。
 */
function genSqlLoader() {
  const src = path.join(ROOT, 'node_modules/sql.js/dist/sql-wasm.js');
  if (!fs.existsSync(src)) {
    console.warn('未找到 sql-wasm.js（先 npm install），跳过 loader 内联');
    return;
  }
  const body = fs.readFileSync(src, 'utf8');
  const out = `'use strict';
// 本文件由 scripts/gen-inline.js 自动生成（sql.js 的 WASM loader，MIT 许可，来自 sql.js 1.15.1 dist/sql-wasm.js）。
// 作用：生产环境无需安装整个 sql.js 包（~30MB），云函数代码包体积大幅下降，冷启动更快。
/* eslint-disable */
${body}
`;
  fs.writeFileSync(path.join(DB_DIR, 'sql-wasm-loader.js'), out);
  console.log('sql-wasm-loader.js ←', (body.length / 1024).toFixed(0), 'KB');
}

genMigrations();
genWasm();
genSqlLoader();
