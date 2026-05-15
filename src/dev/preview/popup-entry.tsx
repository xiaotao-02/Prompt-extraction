import { installChromePreviewShim } from './chromeShim';
import { ensurePreviewLibrarySeed } from './seedPreviewLibrary';
import '@/styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PopupApp from '@/popup/PopupApp';

installChromePreviewShim();

void ensurePreviewLibrarySeed().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PopupApp />
    </StrictMode>
  );
});
