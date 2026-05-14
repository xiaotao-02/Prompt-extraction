/**
 * 商店素材生成的共享工具：Playwright 检测、HTML 截图、扩展加载。
 *
 * 该模块**不在 package.json 中强制依赖** playwright，而是动态 import：
 *   - 装了：直接用，自动化跑通
 *   - 没装：抛带"安装命令"的友好错误
 * 这样即使用户不需要截图功能，npm install 也不会被拖慢。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let _playwright = null;

export async function loadPlaywright() {
  if (_playwright) return _playwright;
  try {
    _playwright = await import('playwright');
    return _playwright;
  } catch (err) {
    const msg =
      '\n[store] 缺少 playwright 依赖。请执行：\n' +
      '  npm i -D playwright\n' +
      '  npx playwright install chromium\n' +
      '安装完成后重新运行该脚本。\n';
    console.error(msg);
    throw err;
  }
}

export function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export function ensureFileDir(p) {
  ensureDir(dirname(p));
}

/**
 * 把一段 HTML 字符串渲染成指定尺寸的 PNG。
 * 不依赖任何本地服务器，使用 data: URL 直接加载。
 */
export async function renderHtmlToPng({ html, width, height, outPath, deviceScaleFactor = 1 }) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor,
    });
    const page = await ctx.newPage();
    // data: URL 比写临时文件更省事，且不留垃圾。
    const dataUrl = 'data:text/html;base64,' + Buffer.from(html, 'utf-8').toString('base64');
    await page.goto(dataUrl, { waitUntil: 'networkidle' });
    // 等待字体（特别是 Google Font / 系统 Emoji）渲染完成
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    });
    ensureFileDir(outPath);
    await page.screenshot({ path: outPath, fullPage: false, omitBackground: false });
    console.log(`[store] ✓ ${outPath}  (${width}×${height})`);
  } finally {
    await browser.close();
  }
}

/**
 * 启动一个独立的 Chromium，并把指定的扩展（dist/ 目录）作为 unpacked 扩展加载。
 * 返回 { context, extensionId }。
 *
 * 因为 Chrome 限制：加载 unpacked 扩展时必须 headless: false（或者用 chromium 的
 * --headless=new 模式），所以脚本会临时弹出一个浏览器窗口（截完图自己关闭）。
 */
export async function launchWithExtension(distPath) {
  const { chromium } = await loadPlaywright();

  const userDataDir = ''; // 临时 profile，浏览器关闭后自动清理
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  // 等待 service worker 起来，从中拿到 extensionId
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  }
  const swUrl = serviceWorker.url();
  const m = swUrl.match(/^chrome-extension:\/\/([a-p]+)\//);
  if (!m) throw new Error(`无法从 service worker URL 推断 extension id: ${swUrl}`);
  const extensionId = m[1];

  return { context, extensionId };
}

/**
 * 把示例数据注入扩展的 chrome.storage.sync / local，以便截图时 popup/options 不是空白。
 */
export async function seedExtensionStorage(context, extensionId, { sync = {}, local = {} } = {}) {
  // 找一个能用的 extension 页面（options 是最稳的入口）
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  await page.evaluate(
    async ({ sync, local }) => {
      await new Promise((resolve, reject) => {
        chrome.storage.sync.set(sync, () =>
          chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(null)
        );
      });
      await new Promise((resolve, reject) => {
        chrome.storage.local.set(local, () =>
          chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(null)
        );
      });
    },
    { sync, local }
  );
  await page.close();
}

export function htmlShell({ title, body, extraHead = '' }) {
  // Inter 是 Chrome Web Store 自家用的字体；Noto Sans SC 用于中文 fallback。
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Noto+Sans+SC:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; width: 100%; }
  body {
    font-family: 'Inter', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    color: #1f2937;
  }
</style>
${extraHead}
</head>
<body>
${body}
</body>
</html>`;
}

export function logoBase64(iconsDir) {
  const file = join(iconsDir, 'icon-128.png');
  const buf = readFileSync(file);
  return 'data:image/png;base64,' + buf.toString('base64');
}
