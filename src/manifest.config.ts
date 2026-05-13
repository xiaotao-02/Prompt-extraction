import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

export default defineManifest({
  manifest_version: 3,
  name: '图片提示词提取器 · Image Prompt Extractor',
  description: '右键任意网页图片，调用视觉大模型一键反推 AI 绘画提示词',
  version: pkg.version,
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
      all_frames: false,
    },
  ],
  permissions: [
    'contextMenus',
    'storage',
    'scripting',
    'activeTab',
    'clipboardWrite',
    'alarms',
    'notifications',
    'management',
  ],
  host_permissions: ['<all_urls>'],
  web_accessible_resources: [
    {
      resources: ['assets/*', 'icons/*'],
      matches: ['<all_urls>'],
    },
  ],
});
