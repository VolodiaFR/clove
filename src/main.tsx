import { createRoot } from 'react-dom/client';
import { loadCloveAssetCatalog } from './clove/assetCatalog';
import { preloadCloveTruffle } from './truffle';
import './desktop.scss';

const start = async () =>
{
    const rootElement = document.getElementById('root')!;
    const startupElement = document.getElementById('clove-startup');

    const finishStartup = () =>
    {
        if(!startupElement) return;

        const remove = () => startupElement.remove();

        startupElement.addEventListener('transitionend', remove, { once: true });
        startupElement.classList.add('is-ready');
        window.setTimeout(remove, 500);
    };

    try
    {
        const [ , { CloveApp } ] = await Promise.all([
            preloadCloveTruffle(),
            loadCloveAssetCatalog().then(() => import('./clove'))
        ]);

        createRoot(rootElement).render(<CloveApp />);
        window.setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(finishStartup)), 100);
    }
    catch(error)
    {
        const message = error instanceof Error ? error.message : String(error);
        const panel = document.createElement('main');

        panel.style.cssText = 'max-width:640px;margin:15vh auto;padding:28px;font:15px/1.5 Segoe UI,sans-serif;color:#252b2f;background:#f7f8f9;border:1px solid #b9c1c6;border-radius:6px';
        panel.textContent = `Clove could not load its verified content library. ${ message }`;
        rootElement.replaceChildren(panel);
        startupElement?.remove();
    }
};

void start();
