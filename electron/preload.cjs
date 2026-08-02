const { contextBridge, ipcRenderer } = require('electron');

const onUpdateStatus = listener =>
{
    const handler = (_event, status) => listener(status);

    ipcRenderer.on('clove:update-status', handler);
    return () => ipcRenderer.removeListener('clove:update-status', handler);
};
const onContentStatus = listener =>
{
    const handler = (_event, status) => listener(status);

    ipcRenderer.on('clove:content-status', handler);
    return () => ipcRenderer.removeListener('clove:content-status', handler);
};

contextBridge.exposeInMainWorld('cloveDesktop', Object.freeze({
    isDesktop: true,
    windowControl: action => ipcRenderer.invoke('clove:window-control', action),
    openText: kind => ipcRenderer.invoke('clove:open-text', kind),
    openImage: () => ipcRenderer.invoke('clove:open-image'),
    saveText: (kind, suggestedName, contents) => ipcRenderer.invoke('clove:save-text', { kind, suggestedName, contents }),
    saveDataUrl: (suggestedName, dataUrl) => ipcRenderer.invoke('clove:save-data-url', { suggestedName, dataUrl }),
    saveExportBundle: payload => ipcRenderer.invoke('clove:save-export-bundle', payload),
    loadImportedSkins: () => ipcRenderer.invoke('clove:load-imported-skins'),
    storeImportedSkins: skins => ipcRenderer.invoke('clove:store-imported-skins', skins),
    getUpdateStatus: () => ipcRenderer.invoke('clove:get-update-status'),
    checkForUpdates: () => ipcRenderer.invoke('clove:check-for-updates'),
    installUpdate: () => ipcRenderer.invoke('clove:install-update'),
    onUpdateStatus,
    getContentStatus: () => ipcRenderer.invoke('clove:get-content-status'),
    installRequiredContent: () => ipcRenderer.invoke('clove:install-required-content'),
    quit: () => ipcRenderer.invoke('clove:quit'),
    onContentStatus
}));
