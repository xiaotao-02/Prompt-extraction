import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Prompt Extracto',
  // Chrome Web Store 对 manifest description 显示截断在 ~132 字符，
  // 这里保留中文一句话；商店页面更详细的中英描述见 store-listing/。
  description:
    '右键网页图片/GIF/视频帧，用自备视觉模型 API 提炼 AI 绘画提示词（中/英段落·SD·MJ）；支持对话改写、版本回溯及快捷键截取区域添入参考面板。',
  version: pkg.version,
  // 上架展示给用户的"开发者主页"，必须是可公开访问的仓库 / 站点。
  homepage_url: 'https://github.com/xiaotao-02/Prompt-extraction',
  // Chrome 官方 manifest schema 历史上 author 是字符串，新 schema 是 { email }。
  // crxjs 的 TS 类型按新 schema 强制对象，因此这里写成对象形式；
  // Chrome 实际加载时两种都接受。
  author: { email: 'xiaotao666.1@gmail.com' },
  // MV3 + chrome.scripting.executeScript 在 109 之后稳定可用，定个下限避免老版本崩溃。
  minimum_chrome_version: '109',
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },
  options_page: 'src/options/index.html',
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: true,
    },
  ],
  permissions: [
    'contextMenus',
    'storage',
    'scripting',
    'activeTab',
    'clipboardRead',
    'clipboardWrite',
  ],
  host_permissions: ['<all_urls>'],
  commands: {
    'region-capture-add-ref': {
      suggested_key: {
        default: 'Ctrl+Shift+E',
        mac: 'Command+Shift+E',
      },
      description:
        '在当前网页拖拽截取矩形区域截图，添加到浮动面板参考列表（适配自定义右键页面的识图前置步骤）',
    },
  },
  web_accessible_resources: [
    {
      resources: ['assets/*', 'icons/*'],
      matches: ['<all_urls>'],
    },
  ],
});
