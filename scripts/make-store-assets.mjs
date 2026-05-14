#!/usr/bin/env node
/**
 * 生成 Chrome Web Store 上架要的"宣传图 / Promo tiles"。
 *
 * Chrome Web Store 当前的 4 类宣传素材：
 *   - 小宣传图 (Small promo tile):   440 × 280   PNG / JPEG  必填
 *   - 大宣传图 (Marquee promo tile): 1400 × 560  PNG / JPEG  推荐
 *   - 商店截图 (Screenshot):         1280 × 800  PNG / JPEG  至少 1 张
 *
 * 这里负责前 2 类（"营销视觉"）。截图归 make-store-screenshots.mjs。
 *
 * 实现思路：渲染一张设计稿 HTML（Tailwind 渐变 + Logo + 文案），用 Playwright 截图。
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, htmlShell, logoBase64, renderHtmlToPng } from './_store-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconsDir = join(root, 'public', 'icons');
const outDir = join(root, 'store-assets', 'promo');

ensureDir(outDir);

const LOGO = logoBase64(iconsDir);

// 配色：与 src/options/styles 里的 indigo→violet 渐变保持一致。
const GRADIENT_FROM = '#6366f1'; // indigo-500
const GRADIENT_TO = '#a855f7';   // violet-500
const ACCENT = '#fef08a';        // yellow-200，用于 Slogan 高亮

function bg(extra = '') {
  return `
    background: radial-gradient(1200px 600px at 80% 20%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 60%),
                linear-gradient(135deg, ${GRADIENT_FROM} 0%, ${GRADIENT_TO} 100%);
    ${extra}
  `;
}

/**
 * 440 × 280 小宣传图：紧凑、商标感强。
 */
const smallPromo = htmlShell({
  title: 'Small Promo',
  body: `
  <div style="
    ${bg()}
    width: 440px; height: 280px;
    display: flex; align-items: center; padding: 28px 30px;
    color: white;
    position: relative; overflow: hidden;
  ">
    <div style="
      position: absolute; right: -60px; bottom: -80px;
      width: 260px; height: 260px;
      background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 70%);
      border-radius: 50%;
    "></div>

    <img src="${LOGO}" style="width: 96px; height: 96px; flex: 0 0 96px; border-radius: 22px;
      box-shadow: 0 18px 40px rgba(0,0,0,0.25), 0 4px 8px rgba(0,0,0,0.18);
      background: rgba(255,255,255,0.08);
    " />

    <div style="margin-left: 22px;">
      <div style="font-size: 28px; font-weight: 800; line-height: 1.1; letter-spacing: -0.01em;">
        Prompt Extracto
      </div>
      <div style="font-size: 14px; font-weight: 500; opacity: 0.92; margin-top: 6px; line-height: 1.45;">
        右键任意图片 / 动图 / 视频
      </div>
      <div style="font-size: 14px; font-weight: 500; opacity: 0.92; line-height: 1.45;">
        一键反推 AI 绘画提示词
      </div>
      <div style="margin-top: 12px; display: inline-block; background: rgba(255,255,255,0.18);
        border: 1px solid rgba(255,255,255,0.28);
        font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 999px;
        backdrop-filter: blur(6px);
      ">
        GPT-4o · Claude · Gemini · GLM · Qwen
      </div>
    </div>
  </div>
  `,
});

/**
 * 1400 × 560 大宣传图（Marquee）：放在商店首页的 hero 位置，必须有视觉冲击。
 */
const marqueePromo = htmlShell({
  title: 'Marquee Promo',
  body: `
  <div style="
    ${bg()}
    width: 1400px; height: 560px;
    display: flex; align-items: center; padding: 70px 100px;
    color: white;
    position: relative; overflow: hidden;
  ">
    <!-- 装饰光斑 -->
    <div style="position: absolute; top: -200px; right: -200px; width: 700px; height: 700px;
      background: radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 70%);
      border-radius: 50%;
    "></div>
    <div style="position: absolute; bottom: -180px; left: -120px; width: 500px; height: 500px;
      background: radial-gradient(circle, rgba(254,240,138,0.18) 0%, rgba(254,240,138,0) 70%);
      border-radius: 50%;
    "></div>

    <img src="${LOGO}" style="width: 220px; height: 220px; flex: 0 0 220px; border-radius: 48px;
      box-shadow: 0 40px 80px rgba(0,0,0,0.32), 0 12px 20px rgba(0,0,0,0.22);
      background: rgba(255,255,255,0.10);
    " />

    <div style="margin-left: 70px; max-width: 880px;">
      <div style="font-size: 16px; font-weight: 700; letter-spacing: 0.18em;
        text-transform: uppercase; opacity: 0.85;
      ">
        Prompt Extracto · Chrome Extension
      </div>
      <div style="font-size: 64px; font-weight: 900; line-height: 1.05; letter-spacing: -0.02em;
        margin-top: 14px;
      ">
        右键图片，<span style="color: ${ACCENT};">秒得</span>提示词
      </div>
      <div style="font-size: 22px; font-weight: 500; line-height: 1.45; margin-top: 22px; opacity: 0.95;">
        网页上的 PNG / GIF / 视频帧 → 视觉大模型反推 →
        自然语言 / SD tag / Midjourney 多种风格直接复制走。
      </div>

      <div style="margin-top: 28px; display: flex; gap: 10px; flex-wrap: wrap;">
        ${['GPT-4o', 'Claude 3.5', 'Gemini 2.0', 'GLM-4V', 'Qwen-VL', 'DeepSeek-VL2', '自定义端点']
          .map(
            (t) => `<div style="
            background: rgba(255,255,255,0.16);
            border: 1px solid rgba(255,255,255,0.28);
            font-size: 14px; font-weight: 600; padding: 7px 16px; border-radius: 999px;
            backdrop-filter: blur(6px);
          ">${t}</div>`
          )
          .join('')}
      </div>
    </div>
  </div>
  `,
});

await renderHtmlToPng({
  html: smallPromo,
  width: 440,
  height: 280,
  outPath: join(outDir, 'small-promo-440x280.png'),
});

await renderHtmlToPng({
  html: marqueePromo,
  width: 1400,
  height: 560,
  outPath: join(outDir, 'marquee-1400x560.png'),
});

console.log(`\n[store] 宣传图已生成于 ${outDir}`);
console.log(`[store] 上传到 Chrome Web Store 时：`);
console.log(`        Store listing → Small promo tile      ⇒ small-promo-440x280.png`);
console.log(`        Store listing → Marquee promo tile    ⇒ marquee-1400x560.png`);
