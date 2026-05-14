#!/usr/bin/env node
/**
 * Chrome Web Store 发版打包脚本。
 *
 * 与现有 `scripts/zip.mjs` 的差异：
 *   - 强制 STORE=1：触发 vite.config.ts 的"生产档"开关，开启 minify、关闭 sourcemap
 *   - 打包前清空 dist/，避免 vite/@crxjs 的增量缓存把旧文件带进来
 *   - 上架前合规校验：
 *       · 不能包含任何 *.map（防止源码外泄）
 *       · 不能包含 *.ts / *.tsx（理论上 vite 不会输出，作为护栏）
 *       · 单个 zip 必须 ≤ 10 MiB（Chrome Web Store 商品包硬上限是 2 GB，
 *         但 ≤ 10 MiB 是健康的扩展规模，超过几乎一定有问题）
 *       · manifest.json 必须存在且 manifest_version === 3
 *   - 输出文件名带语义化版本号：dist-zip/store/prompt-extracto-store-vX.Y.Z.zip
 *   - 同时输出 SHA256，方便填写到 Release Notes / 上架 changelog
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const distDir = join(root, 'dist');
const outDir = join(root, 'dist-zip', 'store');

const MAX_ZIP_BYTES = 10 * 1024 * 1024;

function log(msg) {
  console.log(`[release-store] ${msg}`);
}

function fatal(msg) {
  console.error(`\n[release-store] ✗ ${msg}\n`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

// 1) 清理 dist/
if (existsSync(distDir)) {
  log('清理旧的 dist/ ...');
  rmSync(distDir, { recursive: true, force: true });
}

// 2) STORE=1 构建
log(`生产构建（STORE=1，npm run build） ... v${pkg.version}`);
execSync('npm run build', {
  stdio: 'inherit',
  env: { ...process.env, STORE: '1', NODE_ENV: 'production' },
});

if (!existsSync(distDir)) fatal('构建失败：dist/ 不存在');

// 3) 上架合规校验
log('合规校验 dist/ 内容 ...');
const allFiles = walk(distDir);
const violations = [];

for (const f of allFiles) {
  const rel = relative(distDir, f).replace(/\\/g, '/');
  if (/\.map$/i.test(rel)) violations.push(`含 sourcemap：${rel}`);
  if (/\.(ts|tsx)$/i.test(rel)) violations.push(`含 TS 源文件：${rel}`);
}

const manifestPath = join(distDir, 'manifest.json');
if (!existsSync(manifestPath)) violations.push('缺少 manifest.json');
else {
  const m = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  if (m.manifest_version !== 3) violations.push(`manifest_version 必须为 3，当前 ${m.manifest_version}`);
  if (m.version !== pkg.version)
    violations.push(`manifest.version (${m.version}) 与 package.json (${pkg.version}) 不一致`);
  for (const ic of [16, 32, 48, 128]) {
    const ip = join(distDir, 'icons', `icon-${ic}.png`);
    if (!existsSync(ip)) violations.push(`缺少图标：icons/icon-${ic}.png`);
  }
}

if (violations.length) {
  console.error('\n[release-store] 发现以下上架合规问题：');
  for (const v of violations) console.error('  -', v);
  fatal('请先修复上述问题再发版。');
}
log(`✓ 共 ${allFiles.length} 个文件，全部通过合规校验`);

// 4) 打 zip
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const zipName = `prompt-extracto-store-v${pkg.version}.zip`;
const zipPath = join(outDir, zipName);
if (existsSync(zipPath)) rmSync(zipPath, { force: true });

log(`打包 zip ... ${relative(root, zipPath)}`);
if (process.platform === 'win32') {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${distDir}/*' -DestinationPath '${zipPath}' -Force"`,
    { stdio: 'inherit' }
  );
} else {
  execSync(`cd "${distDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
}

if (!existsSync(zipPath)) fatal('zip 文件未生成');

// 5) 大小 + SHA256
const zipSize = statSync(zipPath).size;
if (zipSize > MAX_ZIP_BYTES) {
  fatal(
    `zip 体积 ${(zipSize / 1024 / 1024).toFixed(2)} MiB 超过自检上限 ${MAX_ZIP_BYTES / 1024 / 1024} MiB，请检查是否误打入了大文件`
  );
}

const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex');

console.log('');
console.log('=========== 上架包就绪 ===========');
console.log(`版本    : v${pkg.version}`);
console.log(`文件    : ${relative(root, zipPath)}`);
console.log(`大小    : ${(zipSize / 1024).toFixed(1)} KiB`);
console.log(`SHA-256 : ${sha256}`);
console.log('');
console.log('下一步：');
console.log('  1) 打开 https://chrome.google.com/webstore/devconsole');
console.log('  2) 「新增项目」上传上面的 zip');
console.log('  3) 把 store-listing/ 下的中英文文案复制粘贴到对应表单字段');
console.log('  4) 上传 store-assets/ 下的宣传图与截图');
console.log('  5) 隐私政策 URL 填：');
console.log('     https://raw.githubusercontent.com/xiaotao-02/Prompt-extraction/main/PRIVACY.md');
console.log('==================================');
