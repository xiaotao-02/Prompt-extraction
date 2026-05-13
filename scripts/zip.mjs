import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const distDir = join(root, 'dist');
const outDir = join(root, 'dist-zip');

if (!existsSync(distDir)) {
  console.error('dist/ 不存在，请先执行 npm run build');
  process.exit(1);
}

if (!existsSync(outDir)) mkdirSync(outDir);

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const zipName = `${pkg.name}-v${pkg.version}.zip`;
const zipPath = join(outDir, zipName);

try {
  // Windows PowerShell Compress-Archive
  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${distDir}/*' -DestinationPath '${zipPath}' -Force"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`cd "${distDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
  }
  console.log(`\n✓ 打包完成：${relative(root, zipPath)}`);
} catch (e) {
  console.error('打包失败：', e);
  // 兜底：打印 dist 目录内容
  walk(distDir).forEach((p) => console.log(' -', relative(distDir, p)));
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
