#!/usr/bin/env node
/**
 * 生成 Chrome Web Store 上架要的 5 张商品截图（1280 × 800 PNG）。
 *
 * 实现策略：**不启动扩展**，全部用纯静态 HTML 模板渲染。
 *
 * 为什么不直接截真实扩展页面？
 *   1. 截真实页面需要 launchPersistentContext + --load-extension，必须 headless: false，
 *      在 CI/服务器上几乎无法跑通；
 *   2. popup / options 页面里大量字段是空的，需要先把 fixture 写进 chrome.storage 再
 *      reload，复杂且对页面初始化时序非常敏感；
 *   3. 上架截图本来就是一次性"营销快照"，UI 演化时同步更新截图反而是负担——一份
 *      手工设计的展示图反而更 stable。
 *
 * 5 张截图主题：
 *   1. Hero       —— 三步使用流程
 *   2. Popup      —— 历史记录列表（模拟弹窗内观感）
 *   3. Options    —— 设置页（多供应商 + API Key 输入示意）
 *   4. Providers  —— 8 家视觉模型供应商展示
 *   5. Styles     —— 4 种输出风格的同图对比
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, htmlShell, logoBase64, renderHtmlToPng } from './_store-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconsDir = join(root, 'public', 'icons');
const outDir = join(root, 'store-assets', 'screenshots');

ensureDir(outDir);

const LOGO = logoBase64(iconsDir);
const W = 1280;
const H = 800;

const C = {
  bgFrom: '#6366f1',
  bgTo: '#a855f7',
  accent: '#fef08a',
  panel: '#ffffff',
  panelBorder: 'rgba(255,255,255,0.18)',
  ink: '#0f172a',
  inkSoft: '#475569',
  card: '#f8fafc',
  cardBorder: '#e2e8f0',
};

function pageShell(inner) {
  return htmlShell({
    title: 'Screenshot',
    body: `
    <div style="
      width: ${W}px; height: ${H}px;
      background: linear-gradient(135deg, ${C.bgFrom} 0%, ${C.bgTo} 100%);
      position: relative; overflow: hidden;
      padding: 56px 64px;
      color: white;
      font-family: 'Inter', 'Noto Sans SC', sans-serif;
    ">
      <div style="position: absolute; top: -200px; right: -200px; width: 700px; height: 700px;
        background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 70%);
        border-radius: 50%; pointer-events: none;
      "></div>
      ${inner}
    </div>
    `,
  });
}

function header(eyebrow, title, subtitle) {
  return `
    <div style="font-size: 14px; font-weight: 700; letter-spacing: 0.2em;
      text-transform: uppercase; opacity: 0.85;">${eyebrow}</div>
    <div style="font-size: 48px; font-weight: 900; line-height: 1.05; letter-spacing: -0.02em;
      margin-top: 10px;">${title}</div>
    <div style="font-size: 18px; font-weight: 500; line-height: 1.5; margin-top: 14px; opacity: 0.95;
      max-width: 920px;">${subtitle}</div>
  `;
}

// ============================================================
// 1. Hero — 三步流程
// ============================================================
const SHOT_1 = pageShell(`
  <div style="display: flex; align-items: center; gap: 22px; margin-bottom: 8px;">
    <img src="${LOGO}" style="width: 64px; height: 64px; border-radius: 14px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.25);" />
    <div style="font-size: 28px; font-weight: 800;">Prompt Extracto</div>
  </div>
  ${header(
    '只为一件事而生',
    '右键图片，秒得 AI 提示词',
    '不再为「这张神图怎么做出来的」发愁。任何网页上的图片 / 动图 / 视频，三步反推。'
  )}

  <div style="margin-top: 56px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;">
    ${[
      {
        n: 1,
        t: '右键图片',
        d: '在任意网页上右键 PNG / GIF / 视频 / canvas / SVG，菜单里出现「提取图片提示词」。',
      },
      {
        n: 2,
        t: '调用视觉大模型',
        d: '扩展把图片发送到你在「设置」中选定的供应商：OpenAI、Claude、Gemini、GLM、Qwen 任选。',
      },
      {
        n: 3,
        t: '复制即用',
        d: '右下角弹出结果面板，自然语言 / SD tag / Midjourney 风格四选一，点「复制」即可。',
      },
    ]
      .map(
        (s) => `
      <div style="background: rgba(255,255,255,0.10);
        border: 1px solid rgba(255,255,255,0.22);
        border-radius: 20px; padding: 28px 24px; backdrop-filter: blur(8px);">
        <div style="display: inline-flex; width: 44px; height: 44px; align-items: center; justify-content: center;
          background: ${C.accent}; color: ${C.ink};
          border-radius: 12px; font-size: 22px; font-weight: 900;">${s.n}</div>
        <div style="font-size: 24px; font-weight: 800; margin-top: 18px;">${s.t}</div>
        <div style="font-size: 16px; line-height: 1.55; margin-top: 10px; opacity: 0.92;">${s.d}</div>
      </div>`
      )
      .join('')}
  </div>

  <div style="position: absolute; bottom: 36px; left: 64px; right: 64px;
    display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;">
    ${['Manifest V3', '本地存储', '不收集数据', '8 家模型', '4 种风格', '版本历史', '对话式调整']
      .map(
        (t) => `<div style="
        background: rgba(255,255,255,0.16);
        border: 1px solid rgba(255,255,255,0.28);
        font-size: 14px; font-weight: 600; padding: 7px 16px; border-radius: 999px;
      ">${t}</div>`
      )
      .join('')}
  </div>
`);

// ============================================================
// 2. Popup — 历史记录
// ============================================================
const SHOT_2 = pageShell(`
  ${header(
    'Toolbar Popup',
    '历史记录、版本管理、一键复制',
    '工具栏弹窗中查看最近 100 条结果，每条都可以编辑、刷新版本、按版本回滚。'
  )}

  <!-- 模拟 popup 弹窗：固定宽度 360（接近真实 popup 宽度），居中放大展示 -->
  <div style="margin-top: 36px; display: flex; justify-content: center;">
    <div style="width: 460px; background: white; border-radius: 18px;
      box-shadow: 0 30px 70px rgba(0,0,0,0.30), 0 12px 24px rgba(0,0,0,0.18);
      overflow: hidden; color: ${C.ink};">

      <!-- popup header -->
      <div style="display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px; border-bottom: 1px solid ${C.cardBorder};">
        <div style="display: flex; align-items: center; gap: 10px;">
          <img src="${LOGO}" style="width: 28px; height: 28px; border-radius: 7px;" />
          <div style="font-size: 15px; font-weight: 700;">Prompt Extracto</div>
        </div>
        <div style="display: flex; gap: 8px; color: ${C.inkSoft}; font-size: 13px;">
          <div>⚙ 设置</div>
        </div>
      </div>

      ${[
        {
          tag: '自然语言 · 中文',
          time: '刚刚',
          text:
            '一张油画风格的赛博朋克城市夜景：霓虹灯映在湿漉漉的街道上，远处摩天楼玻璃幕墙反射着粉紫色光晕，前景有撑伞的女子，电影级景深与体积光，8k 高细节。',
        },
        {
          tag: 'SD Tag',
          time: '3 分钟前',
          text:
            '(masterpiece, best quality:1.2), 1girl, long silver hair, cyberpunk city, neon lights, rain reflections, depth of field, cinematic lighting, ultra detailed, 8k',
        },
        {
          tag: 'Midjourney',
          time: '12 分钟前',
          text:
            'cinematic neon-lit cyberpunk alley at night, lone figure with umbrella, hyper-detailed reflections on wet pavement --ar 16:9 --s 250 --v 6.1',
        },
      ]
        .map(
          (item, i) => `
        <div style="padding: 14px 16px ${i === 2 ? '18px' : '14px'};
          ${i < 2 ? `border-bottom: 1px solid ${C.cardBorder};` : ''}">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px;
              background: #eef2ff; color: #4338ca; font-size: 11px; font-weight: 600;">${item.tag}</div>
            <div style="font-size: 11px; color: ${C.inkSoft};">${item.time}</div>
          </div>
          <div style="font-size: 13px; line-height: 1.55; margin-top: 8px; color: ${C.ink};
            display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
            ${item.text}
          </div>
          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <div style="font-size: 12px; color: #4f46e5; font-weight: 600;">复制</div>
            <div style="font-size: 12px; color: ${C.inkSoft};">编辑</div>
            <div style="font-size: 12px; color: ${C.inkSoft};">版本</div>
            <div style="font-size: 12px; color: ${C.inkSoft};">对话调整</div>
            <div style="margin-left: auto; font-size: 12px; color: #ef4444;">删除</div>
          </div>
        </div>`
        )
        .join('')}
    </div>
  </div>
`);

// ============================================================
// 3. Options — 设置页
// ============================================================
const PROVIDERS_FOR_UI = [
  { name: 'OpenAI', model: 'gpt-4o', active: false },
  { name: 'Anthropic Claude', model: 'claude-3-5-sonnet', active: false },
  { name: 'Google Gemini', model: 'gemini-2.0-flash', active: false },
  { name: '智谱 GLM-4V', model: 'glm-4v-flash · 免费', active: true },
  { name: '通义千问 Qwen-VL', model: 'qwen-vl-max-latest', active: false },
  { name: '硅基流动 SiliconFlow', model: 'deepseek-ai/deepseek-vl2', active: false },
];

const SHOT_3 = pageShell(`
  ${header(
    'Options Page',
    '一处配置，四端通吃',
    '在设置页选定供应商、贴入你自己的 API Key，跨设备同步、永不上传。'
  )}

  <div style="margin-top: 36px; display: flex; justify-content: center;">
    <div style="width: 1080px; background: white; border-radius: 20px;
      box-shadow: 0 30px 70px rgba(0,0,0,0.30), 0 12px 24px rgba(0,0,0,0.18);
      overflow: hidden; color: ${C.ink};">

      <!-- options header -->
      <div style="display: flex; align-items: center; justify-content: space-between;
        padding: 18px 24px; border-bottom: 1px solid ${C.cardBorder};">
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="${LOGO}" style="width: 36px; height: 36px; border-radius: 9px;" />
          <div style="font-size: 18px; font-weight: 800;">Prompt Extracto · 设置</div>
          <div style="margin-left: 16px; display: flex; gap: 14px; font-size: 14px; color: ${C.inkSoft};">
            <div style="font-weight: 700; color: ${C.ink};">设置</div>
            <div>提示词库</div>
          </div>
        </div>
        <div style="background: #10b981; color: white; padding: 6px 14px;
          border-radius: 8px; font-size: 13px; font-weight: 600;">已保存</div>
      </div>

      <div style="display: grid; grid-template-columns: 360px 1fr; min-height: 460px;">
        <!-- 左侧供应商列表 -->
        <div style="border-right: 1px solid ${C.cardBorder}; padding: 16px;
          background: ${C.card};">
          <div style="font-size: 12px; font-weight: 700; color: ${C.inkSoft}; letter-spacing: 0.1em;
            text-transform: uppercase; padding: 4px 8px 10px;">视觉模型供应商</div>
          ${PROVIDERS_FOR_UI.map(
            (p) => `
            <div style="padding: 10px 12px; border-radius: 10px; margin-bottom: 4px;
              ${p.active ? `background: #eef2ff; border: 1px solid #c7d2fe;` : ''}">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="font-size: 14px; font-weight: 600; color: ${p.active ? '#4338ca' : C.ink};">${p.name}</div>
                ${p.active ? `<div style="font-size: 10px; font-weight: 700; color: white; background: #4f46e5; padding: 2px 8px; border-radius: 999px;">使用中</div>` : ''}
              </div>
              <div style="font-size: 12px; color: ${C.inkSoft}; margin-top: 3px;">${p.model}</div>
            </div>`
          ).join('')}
        </div>

        <!-- 右侧表单 -->
        <div style="padding: 24px 28px;">
          <div style="font-size: 20px; font-weight: 800;">智谱 GLM-4V</div>
          <div style="font-size: 13px; color: ${C.inkSoft}; margin-top: 4px;">
            国产视觉模型，<code style="background: ${C.card}; padding: 1px 6px; border-radius: 4px;">glm-4v-flash</code>
            档位免费，国内可直连。
          </div>

          <div style="margin-top: 22px;">
            <div style="font-size: 12px; font-weight: 700; color: ${C.inkSoft}; margin-bottom: 6px;">API KEY</div>
            <div style="background: ${C.card}; border: 1px solid ${C.cardBorder};
              border-radius: 10px; padding: 11px 14px; font-size: 14px;
              font-family: 'JetBrains Mono', Menlo, monospace; color: ${C.ink};">
              •••••••••••••••••••••••••••••••••• <span style="color: ${C.inkSoft};">.gZsHk</span>
            </div>
          </div>

          <div style="margin-top: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
            <div>
              <div style="font-size: 12px; font-weight: 700; color: ${C.inkSoft}; margin-bottom: 6px;">BASE URL</div>
              <div style="background: ${C.card}; border: 1px solid ${C.cardBorder};
                border-radius: 10px; padding: 11px 14px; font-size: 13px; color: ${C.ink};
                font-family: 'JetBrains Mono', Menlo, monospace;">
                https://open.bigmodel.cn/api/paas/v4
              </div>
            </div>
            <div>
              <div style="font-size: 12px; font-weight: 700; color: ${C.inkSoft}; margin-bottom: 6px;">MODEL</div>
              <div style="background: ${C.card}; border: 1px solid ${C.cardBorder};
                border-radius: 10px; padding: 11px 14px; font-size: 13px; color: ${C.ink};
                font-family: 'JetBrains Mono', Menlo, monospace;">
                glm-4v-flash
              </div>
            </div>
          </div>

          <div style="margin-top: 22px;">
            <div style="font-size: 12px; font-weight: 700; color: ${C.inkSoft}; margin-bottom: 8px;">输出风格</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              ${[
                ['自然语言 · 中文', true],
                ['自然语言 · 英文', false],
                ['SD Tag', false],
                ['Midjourney', false],
              ]
                .map(
                  ([t, on]) => `
                <div style="font-size: 13px; padding: 7px 14px; border-radius: 8px;
                  ${on ? 'background: #4f46e5; color: white; font-weight: 600;' : `background: ${C.card}; color: ${C.ink}; border: 1px solid ${C.cardBorder};`}
                ">${t}</div>`
                )
                .join('')}
            </div>
          </div>

          <div style="margin-top: 22px; padding: 14px 16px; background: #ecfdf5;
            border: 1px solid #a7f3d0; border-radius: 10px;
            display: flex; align-items: center; gap: 10px;">
            <div style="width: 22px; height: 22px; background: #10b981; color: white; border-radius: 50%;
              display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800;">✓</div>
            <div style="font-size: 13px; color: #065f46; font-weight: 600;">联通性测试通过 · 模型响应正常</div>
          </div>
        </div>
      </div>

    </div>
  </div>
`);

// ============================================================
// 4. Providers — 供应商展示
// ============================================================
const PROVIDERS_GRID = [
  { name: 'OpenAI', sub: 'GPT-4o · GPT-4o-mini', tag: '海外旗舰' },
  { name: 'Anthropic', sub: 'Claude 3.5 Sonnet', tag: '描述细腻' },
  { name: 'Google', sub: 'Gemini 2.0 Flash', tag: '速度快' },
  { name: '智谱 AI', sub: 'GLM-4V · glm-4v-flash 免费', tag: '国内可直连' },
  { name: '阿里 Qwen', sub: 'Qwen-VL-Max', tag: '国产旗舰' },
  { name: 'SiliconFlow', sub: 'DeepSeek-VL2 等开源', tag: '聚合开源' },
  { name: '数科隆达', sub: 'OpenAI 兼容中转', tag: '聚合中转' },
  { name: 'Custom', sub: '任意 OpenAI 兼容端点', tag: '自定义' },
];

const SHOT_4 = pageShell(`
  ${header(
    'Multi-Provider',
    '8 家视觉大模型，自由切换',
    '海外有 OpenAI / Claude / Gemini，国内有智谱 / Qwen / SiliconFlow，外加任意 OpenAI 兼容端点。'
  )}

  <div style="margin-top: 36px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;">
    ${PROVIDERS_GRID.map(
      (p) => `
      <div style="background: white; color: ${C.ink}; border-radius: 16px; padding: 22px 22px 18px;
        box-shadow: 0 18px 40px rgba(0,0,0,0.18);">
        <div style="display: inline-block; padding: 3px 10px; border-radius: 999px;
          background: #eef2ff; color: #4338ca; font-size: 11px; font-weight: 700;">${p.tag}</div>
        <div style="font-size: 22px; font-weight: 800; margin-top: 16px;">${p.name}</div>
        <div style="font-size: 13px; color: ${C.inkSoft}; margin-top: 6px; line-height: 1.45;">${p.sub}</div>
      </div>`
    ).join('')}
  </div>

  <div style="margin-top: 38px; padding: 18px 24px; background: rgba(255,255,255,0.10);
    border: 1px solid rgba(255,255,255,0.22); border-radius: 14px;
    display: flex; align-items: center; gap: 14px; backdrop-filter: blur(8px);">
    <div style="font-size: 30px;">🔒</div>
    <div>
      <div style="font-size: 17px; font-weight: 700;">你的 API Key 永远只在你和供应商之间</div>
      <div style="font-size: 14px; opacity: 0.92; margin-top: 2px;">
        扩展无后端，不收集任何遥测数据，源代码 100% 开源（MIT）
      </div>
    </div>
  </div>
`);

// ============================================================
// 5. Styles — 4 种输出风格
// ============================================================
const STYLES = [
  {
    name: '自然语言 · 中文',
    tag: 'Natural ZH',
    text: '一只蜷缩在窗台上的银灰色短毛猫，午后柔光透过半透明窗帘洒在毛发上，背景虚化为暖色调的室内陈设，胶片质感、情绪安静、电影级景深。',
  },
  {
    name: '自然语言 · 英文',
    tag: 'Natural EN',
    text: 'A silver short-haired cat curled up on a sunlit window sill, soft afternoon light filtering through translucent curtains, warm interior bokeh background, film grain, calm mood, cinematic depth of field.',
  },
  {
    name: 'Stable Diffusion',
    tag: 'SD tags',
    text: '(masterpiece, best quality:1.2), 1cat, silver shorthair, curled up, window sill, sunlight, translucent curtain, warm bokeh background, film grain, cinematic, depth of field, soft lighting, indoor',
  },
  {
    name: 'Midjourney',
    tag: 'Midjourney',
    text: 'A silver shorthair cat curled on a sunlit window sill, soft golden afternoon light through sheer curtains, warm cozy interior bokeh, film grain, cinematic mood --ar 3:2 --s 200 --v 6.1',
  },
];

const SHOT_5 = pageShell(`
  ${header(
    'Output Styles',
    '同一张图，四种文风一次出',
    '一次右键，输出"中文 / 英文 / SD Tag / Midjourney"四种风格，按需复制到你的画图工具。'
  )}

  <div style="margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
    ${STYLES.map(
      (s) => `
      <div style="background: white; color: ${C.ink}; border-radius: 16px; padding: 22px 24px;
        box-shadow: 0 18px 40px rgba(0,0,0,0.18);">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 17px; font-weight: 800;">${s.name}</div>
          <div style="font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px;
            background: #eef2ff; color: #4338ca;">${s.tag}</div>
        </div>
        <div style="margin-top: 14px; padding: 14px 16px; background: ${C.card};
          border: 1px solid ${C.cardBorder}; border-radius: 10px;
          font-size: 13px; line-height: 1.55; color: ${C.ink};
          font-family: ${s.tag === 'SD tags' || s.tag === 'Midjourney' ? "'JetBrains Mono', Menlo, monospace" : "inherit"};">
          ${s.text}
        </div>
        <div style="margin-top: 12px; display: flex; gap: 10px; font-size: 12px;">
          <div style="color: #4f46e5; font-weight: 700;">复制</div>
          <div style="color: ${C.inkSoft};">编辑</div>
          <div style="color: ${C.inkSoft};">对话调整</div>
        </div>
      </div>`
    ).join('')}
  </div>
`);

// ============================================================
// Render all
// ============================================================
const tasks = [
  { html: SHOT_1, file: 'screenshot-1-hero.png' },
  { html: SHOT_2, file: 'screenshot-2-popup.png' },
  { html: SHOT_3, file: 'screenshot-3-options.png' },
  { html: SHOT_4, file: 'screenshot-4-providers.png' },
  { html: SHOT_5, file: 'screenshot-5-styles.png' },
];

for (const t of tasks) {
  await renderHtmlToPng({
    html: t.html,
    width: W,
    height: H,
    outPath: join(outDir, t.file),
  });
}

console.log(`\n[store] 5 张商品截图已生成于 ${outDir}`);
console.log(`[store] 上架时按下面顺序拖拽到 Chrome Web Store 后台 Screenshots 区：`);
for (let i = 0; i < tasks.length; i++) {
  console.log(`        #${i + 1}  ${tasks[i].file}`);
}
