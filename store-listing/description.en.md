**Prompt Extracto** lets you right-click any image on any web page and reverse-extract a high-quality AI painting prompt with a vision LLM in seconds.
PNG, JPEG, animated GIF / APNG / WebP, and even the "fake-GIF" <video> elements on Twitter / Reddit / Discord — all are supported.

━━━━━━━━━━━━━━━━━━━━━━
✦ Key features
━━━━━━━━━━━━━━━━━━━━━━

▸ **Right-click everywhere**: works on <img>, <video>, <canvas>, inline <svg>, and CSS background images
▸ **First-class GIF & video support**:
  • GIF / APNG / animated WebP are automatically flattened to a static first frame before being sent
  • <video> elements (including the mp4-as-fake-GIF used by Twitter / Reddit / Discord) are captured to a JPEG of the currently visible frame
  • Canvas, inline SVG, CSS background-image / mask-image are also recognized
▸ **Pick your provider** (set in Options):
  • OpenAI GPT-4o / GPT-4o-mini
  • Anthropic Claude 3.5
  • Google Gemini 2.0 Flash
  • Zhipu GLM-4V (free glm-4v-flash available)
  • Alibaba Qwen-VL-Max
  • SiliconFlow (incl. open-source DeepSeek-VL2)
  • Any custom OpenAI-compatible endpoint
▸ **Four output styles**: natural Chinese / English paragraph, Stable Diffusion tags, Midjourney
▸ **Edit + version history**: rewrite prompts inline; every change is auto-saved as a new version, restore any previous one
▸ **Conversational refine**: tell the model "make it more cinematic / translate to English / add 8k masterpiece" — the model rewrites the existing prompt and saves a new version
▸ **Local history**: view, copy and delete the last 100 results from the toolbar popup
▸ **Cross-device sync**: API keys and preferences sync via Chrome's built-in storage.sync

━━━━━━━━━━━━━━━━━━━━━━
✦ Quick start
━━━━━━━━━━━━━━━━━━━━━━

1. Click the toolbar icon → ⚙ to open Options
2. Pick a provider and paste your own API key
   (we recommend Zhipu glm-4v-flash to start — it's free)
3. Right-click any image on any web page → "Extract Image Prompt"
   The result panel appears at the bottom-right of the page. Click "Copy" and paste into your AI painting tool of choice.

━━━━━━━━━━━━━━━━━━━━━━
✦ Privacy & data flow (please read)
━━━━━━━━━━━━━━━━━━━━━━

✓ No backend server is operated by the developer. No telemetry, no analytics, no tracking.
✓ Your API key is stored only in chrome.storage and (optionally) synced encrypted across your own Chrome devices via Chrome Sync.
✓ The image you right-click is sent **only** when you click the menu item, and **only** to the single provider you chose in Options.
✓ Full privacy policy: https://raw.githubusercontent.com/xiaotao-02/Prompt-extraction/main/PRIVACY.md

━━━━━━━━━━━━━━━━━━━━━━
✦ Open source
━━━━━━━━━━━━━━━━━━━━━━

Source code is 100% open under the MIT license:
https://github.com/xiaotao-02/Prompt-extraction

Issues and pull requests welcome.

━━━━━━━━━━━━━━━━━━━━━━
✦ FAQ
━━━━━━━━━━━━━━━━━━━━━━

Q: Some images fail with "image download failed". Why?
A: A handful of sites enforce Referer-based hot-link protection. Right-click → "Open image in new tab", then re-extract.

Q: My image is too big.
A: There is an 8 MB cap. GIF / video frames are auto-resized to a max edge of 1280–1536 px before sending.

Q: Twitter / X GIFs don't trigger the menu.
A: Those "GIFs" are actually <video> elements. Right-click directly on the video — the menu item is named "Extract video / animation frame prompt".

Q: Can I use DeepSeek?
A: Official DeepSeek chat endpoints do not support image input. Use SiliconFlow + the deepseek-ai/deepseek-vl2 model instead.
