#!/usr/bin/env node
/**
 * 一键把本扩展加载到 Chrome / Edge（开发者模式 · 加载已解压扩展）。
 *
 * 等价于手动操作：
 *   1. 打开 chrome://extensions/
 *   2. 右上角开启「开发者模式」
 *   3. 点「加载已解压的扩展程序」并选择 dist/ 目录
 *
 * 用法：
 *   node scripts/install-to-chrome.mjs            # 默认：独立 profile（不影响主 Chrome）
 *   node scripts/install-to-chrome.mjs --build    # 启动前先 npm run build
 *   node scripts/install-to-chrome.mjs --browser=edge
 *   node scripts/install-to-chrome.mjs --use-default-profile  # 使用系统默认 profile（需先关闭 Chrome）
 *   CHROME_PATH=... node scripts/install-to-chrome.mjs        # 手动指定浏览器路径
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { homedir, platform } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = join(root, 'dist');
const profileDir = join(root, '.chrome-dev-profile');

const args = process.argv.slice(2);
const flags = {
  build: args.includes('--build'),
  useDefaultProfile: args.includes('--use-default-profile'),
  browser: (args.find((a) => a.startsWith('--browser='))?.split('=')[1] ?? 'chrome').toLowerCase(),
};

function log(msg) {
  console.log(`\x1b[36m[install]\x1b[0m ${msg}`);
}
function warn(msg) {
  console.warn(`\x1b[33m[install]\x1b[0m ${msg}`);
}
function err(msg) {
  console.error(`\x1b[31m[install]\x1b[0m ${msg}`);
}

function ensureDist() {
  const exists = existsSync(distDir) && readdirSync(distDir).length > 0;
  if (exists && !flags.build) return;

  if (!exists) log('未检测到 dist/，自动执行 npm run build...');
  else log('已指定 --build，重新执行 npm run build...');

  const npmCmd = platform() === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npmCmd, ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (r.status !== 0) {
    err('npm run build 失败，无法继续。');
    process.exit(r.status ?? 1);
  }

  if (!existsSync(join(distDir, 'manifest.json'))) {
    err('构建完成但 dist/manifest.json 不存在，请检查构建配置。');
    process.exit(1);
  }
}

function findBrowser() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const wantEdge = flags.browser === 'edge' || flags.browser === 'msedge';

  const candidates = [];

  if (platform() === 'win32') {
    const PF = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const PF86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const LOCAL = process.env['LocalAppData'] ?? join(homedir(), 'AppData', 'Local');
    if (wantEdge) {
      candidates.push(
        join(PF, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(PF86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      );
    } else {
      candidates.push(
        join(PF, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(PF86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(LOCAL, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      );
    }
  } else if (platform() === 'darwin') {
    if (wantEdge) {
      candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    } else {
      candidates.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      );
    }
  } else {
    if (wantEdge) {
      candidates.push('/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable');
    } else {
      candidates.push(
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
      );
    }
  }

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function isChromeRunning(browserPath) {
  if (platform() !== 'win32') return false;
  const exeName = browserPath.split(/[\\/]/).pop();
  if (!exeName) return false;
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-Process | Where-Object { $_.Path -eq '${browserPath.replace(/'/g, "''")}' } | Select-Object -First 1 | Out-Null; if ($?) { exit 0 } else { exit 1 }`,
    ],
    { encoding: 'utf-8' },
  );
  if (r.status !== 0) {
    const r2 = spawnSync(
      'tasklist',
      ['/FI', `IMAGENAME eq ${exeName}`, '/NH'],
      { encoding: 'utf-8' },
    );
    return (r2.stdout || '').toLowerCase().includes(exeName.toLowerCase());
  }
  return true;
}

function launch(browserPath) {
  const launchArgs = [
    `--load-extension=${distDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'chrome://extensions/',
  ];

  if (!flags.useDefaultProfile) {
    if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });
    launchArgs.unshift(`--user-data-dir=${profileDir}`);
    log(`使用独立 profile：${profileDir}`);
    log('  · 该 profile 只用于本扩展开发，不会影响你日常的 Chrome 配置');
    log('  · 第一次会是干净的浏览器，登录态会沉淀在这里供下次复用');
  } else {
    if (isChromeRunning(browserPath)) {
      warn('⚠ 检测到 Chrome 正在运行：使用 --use-default-profile 时 --load-extension 会被忽略。');
      warn('  请先彻底关闭 Chrome（任务栏图标也要退出）后再次运行本命令。');
      process.exit(2);
    }
    log('使用系统默认 profile（你的日常 Chrome 配置）。');
  }

  log(`启动浏览器：${browserPath}`);
  log(`扩展路径：${distDir}`);

  const child = spawn(browserPath, launchArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.on('error', (e) => {
    err(`启动失败：${e.message}`);
    process.exit(1);
  });
  child.unref();

  log('✓ 已启动浏览器，等几秒后扩展会出现在 chrome://extensions/ 中。');
  log('  · 之后开发：改完代码 → npm run build → 在扩展页点🔄重新加载');
  log('  · 或者用 npm run dev 配合 @crxjs/vite-plugin 的 HMR');
}

function main() {
  ensureDist();
  const browserPath = findBrowser();
  if (!browserPath) {
    err(`未找到 ${flags.browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome'} 可执行文件。`);
    err('  解决方案：');
    err('   · 设置环境变量 CHROME_PATH 指向浏览器可执行文件，再重试');
    err('   · 或安装 Chrome：https://www.google.cn/intl/zh-CN/chrome/');
    process.exit(1);
  }
  launch(browserPath);
}

main();
