/// <reference types="vite/client" />

import type { CloveCustomSkin } from './clove/customSkins';

declare global
{
interface CloveOpenTextResult
{
    name: string;
    path: string;
    contents: string;
}

interface CloveOpenImageResult
{
    name: string;
    path: string;
    bytes: number;
    dataUrl: string;
}

type CloveUpdatePhase = 'idle' | 'checking' | 'downloading' | 'current' | 'ready' | 'installing' | 'error';

interface CloveUpdateStatus
{
    phase: CloveUpdatePhase;
    currentVersion: string;
    version?: string;
    percent?: number;
    transferred?: number;
    total?: number;
    bytesPerSecond?: number;
    message?: string;
}

interface CloveDesktopApi
{
    readonly isDesktop: true;
    windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') => Promise<boolean>;
    openText: (kind: 'xml' | 'project') => Promise<CloveOpenTextResult | null>;
    openImage: () => Promise<CloveOpenImageResult | null>;
    saveText: (kind: 'project', suggestedName: string, contents: string) => Promise<string | null>;
    saveDataUrl: (suggestedName: string, dataUrl: string) => Promise<string | null>;
    saveExportBundle: (payload: { files: Array<{ path: string; contents?: string; dataUrl?: string }> }) => Promise<{ directory: string; files: string[] } | null>;
    loadImportedSkins: () => Promise<CloveCustomSkin[]>;
    storeImportedSkins: (skins: CloveCustomSkin[]) => Promise<void>;
    getUpdateStatus: () => Promise<CloveUpdateStatus>;
    checkForUpdates: () => Promise<boolean>;
    installUpdate: () => Promise<boolean>;
    onUpdateStatus: (listener: (status: CloveUpdateStatus) => void) => () => void;
}

    interface Window
    {
        cloveDesktop?: CloveDesktopApi;
    }
}

export {};
