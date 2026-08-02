const { app, BrowserWindow, dialog, ipcMain, net, protocol } = require('electron');
const { createHash } = require('node:crypto');
const { existsSync } = require('node:fs');
const { mkdir, readFile, readdir, stat, unlink, writeFile } = require('node:fs/promises');
const { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { ContentManager } = require('./content-manager.cjs');
const { configureAutoUpdates } = require('./updater.cjs');

const MAX_TEXT_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_STORED_SKINS = 5000;
let lastImportDirectory = '';
const IMAGE_MIMES_BY_EXTENSION = {
    '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
    '.avif': 'image/avif'
};
const RESOURCE_MIMES_BY_EXTENSION = {
    ...IMAGE_MIMES_BY_EXTENSION,
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.tfc': 'application/octet-stream',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm'
};
const BOOTSTRAP_FILES = new Set([ 'bootstrap.css', 'bootstrap.html', 'bootstrap.js' ]);
const contentManager = new ContentManager();

protocol.registerSchemesAsPrivileged([ {
    scheme: 'clove',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
} ]);

if(!app.isPackaged && process.env.CLOVE_USER_DATA) app.setPath('userData', resolve(process.env.CLOVE_USER_DATA));

const isInside = (root, candidate) => candidate === root || candidate.startsWith(`${ root }${ sep }`);
const safeName = (value, fallback) => basename(String(value || fallback)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || fallback;
const safeRelativePath = value =>
{
    const cleaned = normalize(String(value || '').replaceAll('/', sep));

    if(!cleaned || cleaned === '.' || isAbsolute(cleaned) || cleaned.startsWith(`..${ sep }`) || cleaned === '..') throw new Error('Invalid export path.');

    return cleaned;
};
const importDirectoryFile = () => join(app.getPath('userData'), 'last-import-directory.txt');
const previousImportDirectory = async () =>
{
    if(lastImportDirectory) return lastImportDirectory;

    try
    {
        const stored = (await readFile(importDirectoryFile(), 'utf8')).trim();

        if(stored && (await stat(stored)).isDirectory()) lastImportDirectory = stored;
    }
    catch
    {
        // The first import uses Electron's normal default location.
    }

    return lastImportDirectory;
};
const rememberImportDirectory = async filePath =>
{
    lastImportDirectory = dirname(filePath);

    try
    {
        await mkdir(dirname(importDirectoryFile()), { recursive: true });
        await writeFile(importDirectoryFile(), lastImportDirectory, 'utf8');
    }
    catch
    {
        // Remembering the folder is a convenience and must not block imports.
    }
};
const decodeDataUrl = (dataUrl, expectedMime = '') =>
{
    const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);

    if(!match || (expectedMime && match[1] !== expectedMime)) throw new Error('Unsupported image data.');

    return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
};
const detectImageMime = (buffer, filePath = '') =>
{
    if(buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ]))) return 'image/png';
    if(buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return 'image/gif';
    if(buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if(buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if(buffer.length >= 2 && buffer.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
    if(buffer.length >= 4 && buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0) return 'image/x-icon';

    const start = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf8').replace(/^\uFEFF/, '').trimStart();

    if(/^<(?:\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(start)) return 'image/svg+xml';

    return IMAGE_MIMES_BY_EXTENSION[extname(filePath).toLowerCase()] || '';
};

const rendererRoot = () => join(app.getAppPath(), 'dist');

const installProtocol = () => protocol.handle('clove', async request =>
{
    const url = new URL(request.url);
    let pathname = '';

    try
    {
        pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    }
    catch
    {
        return new Response('Invalid path.', { status: 400 });
    }

    const candidates = [ { root: rendererRoot(), path: resolve(rendererRoot(), pathname) } ];

    if(BOOTSTRAP_FILES.has(pathname)) candidates.push({ root: __dirname, path: join(__dirname, pathname) });

    const contentPath = contentManager.resolve(pathname);

    if(contentPath) candidates.unshift({ root: dirname(contentPath), path: contentPath, content: true });

    for(const entry of candidates)
    {
        const candidate = entry.path;

        if(!entry.content && !isInside(entry.root, candidate)) continue;

        try
        {
            if(!(await stat(candidate)).isFile()) continue;

            const response = await net.fetch(pathToFileURL(candidate).toString());
            const headers = new Headers(response.headers);
            const mime = RESOURCE_MIMES_BY_EXTENSION[extname(pathname).toLowerCase()];

            if(mime) headers.set('Content-Type', mime);
            headers.set('Cache-Control', 'no-cache');

            return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
        }
        catch
        {
            // Try the next approved resource root.
        }
    }

    return new Response('Not found.', { status: 404 });
});

const createWindow = () =>
{
    const window = new BrowserWindow({
        title: 'Clove',
        frame: false,
        width: 1800,
        height: 980,
        minWidth: 980,
        minHeight: 640,
        show: false,
        backgroundColor: '#e8ebed',
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });

    window.once('ready-to-show', () => window.show());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    return window;
};

ipcMain.handle('clove:window-control', (event, action) =>
{
    const window = BrowserWindow.fromWebContents(event.sender);

    if(!window || window.isDestroyed()) return false;

    if(action === 'minimize') window.minimize();
    else if(action === 'toggle-maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else if(action === 'close') window.close();
    else throw new Error('Unsupported window action.');

    return true;
});

const textFilters = kind => kind === 'project'
    ? [ { name: 'Clove project', extensions: [ 'json' ] }, { name: 'All files', extensions: [ '*' ] } ]
    : [ { name: 'Habbo layout XML', extensions: [ 'xml', 'bin' ] }, { name: 'All files', extensions: [ '*' ] } ];

ipcMain.handle('clove:open-text', async (_event, kind) =>
{
    if(kind !== 'xml' && kind !== 'project') throw new Error('Unsupported file type.');

    const defaultPath = await previousImportDirectory();
    const result = await dialog.showOpenDialog({ ...(defaultPath ? { defaultPath } : {}), properties: [ 'openFile' ], filters: textFilters(kind) });

    if(result.canceled || !result.filePaths[0]) return null;

    const filePath = result.filePaths[0];
    const details = await stat(filePath);

    if(details.size > MAX_TEXT_BYTES) throw new Error('That file is too large for Clove to open.');

    await rememberImportDirectory(filePath);
    return { name: basename(filePath), path: filePath, contents: await readFile(filePath, 'utf8') };
});

ipcMain.handle('clove:open-image', async () =>
{
    const defaultPath = await previousImportDirectory();
    const result = await dialog.showOpenDialog({ ...(defaultPath ? { defaultPath } : {}), properties: [ 'openFile' ], filters: [
        { name: 'Images', extensions: [ 'png', 'gif', 'jpg', 'jpeg', 'webp', 'bmp', 'ico', 'svg', 'avif' ] },
        { name: 'All files', extensions: [ '*' ] }
    ] });

    if(result.canceled || !result.filePaths[0]) return null;

    const filePath = result.filePaths[0];
    const details = await stat(filePath);

    if(details.size > MAX_IMAGE_BYTES) throw new Error('Imported images must be 10 MB or smaller.');

    const buffer = await readFile(filePath);
    const mime = detectImageMime(buffer, filePath);

    if(!mime) throw new Error('The selected file is not a supported image.');

    await rememberImportDirectory(filePath);
    return { name: basename(filePath), path: filePath, bytes: buffer.length, dataUrl: `data:${ mime };base64,${ buffer.toString('base64') }` };
});

ipcMain.handle('clove:save-text', async (_event, payload) =>
{
    const kind = payload?.kind;

    if(kind !== 'project' || typeof payload?.contents !== 'string') throw new Error('Unsupported save request.');

    const result = await dialog.showSaveDialog({
        defaultPath: safeName(payload.suggestedName, 'window.clove.json'),
        filters: textFilters(kind)
    });

    if(result.canceled || !result.filePath) return null;

    await writeFile(result.filePath, payload.contents, 'utf8');
    return result.filePath;
});

ipcMain.handle('clove:save-data-url', async (_event, payload) =>
{
    const { mime, buffer } = decodeDataUrl(payload?.dataUrl);

    if(!mime.startsWith('image/') || buffer.length > 64 * 1024 * 1024) throw new Error('Unsupported PNG export.');

    const result = await dialog.showSaveDialog({
        defaultPath: safeName(payload?.suggestedName, 'clove-window.png'),
        filters: [ { name: 'PNG image', extensions: [ 'png' ] } ]
    });

    if(result.canceled || !result.filePath) return null;

    await writeFile(result.filePath, buffer);
    return result.filePath;
});

ipcMain.handle('clove:save-export-bundle', async (_event, payload) =>
{
    if(!Array.isArray(payload?.files) || !payload.files.length || payload.files.length > 5000) throw new Error('Invalid export bundle.');

    const result = await dialog.showOpenDialog({
        title: 'Choose a folder for the Clove TSX export',
        buttonLabel: 'Save here',
        properties: [ 'openDirectory', 'createDirectory', 'promptToCreate' ]
    });

    if(result.canceled || !result.filePaths[0]) return null;

    const outputRoot = resolve(result.filePaths[0]);
    const written = [];

    for(const file of payload.files)
    {
        const relativePath = safeRelativePath(file?.path);
        const outputPath = resolve(outputRoot, relativePath);

        if(!isInside(outputRoot, outputPath)) throw new Error('An export file is outside the selected folder.');
        await mkdir(dirname(outputPath), { recursive: true });

        if(typeof file.contents === 'string') await writeFile(outputPath, file.contents, 'utf8');
        else
        {
            const { mime, buffer } = decodeDataUrl(file.dataUrl);

            if(!mime.startsWith('image/')) throw new Error('An export file is not an image.');
            if(buffer.length > MAX_IMAGE_BYTES) throw new Error('An imported export image is too large.');
            await writeFile(outputPath, buffer);
        }

        written.push(relative(outputRoot, outputPath));
    }

    return { directory: outputRoot, files: written };
});

const importedDirectory = () => join(app.getPath('userData'), 'imported-images');
const importedMetadataPath = () => join(app.getPath('userData'), 'custom-skins.json');

ipcMain.handle('clove:load-imported-skins', async () =>
{
    try
    {
        const stored = JSON.parse(await readFile(importedMetadataPath(), 'utf8'));

        if(!Array.isArray(stored)) return [];

        const skins = [];

        for(const item of stored.slice(0, MAX_STORED_SKINS))
        {
            if(!item || typeof item.storedFile !== 'string' || !/^[a-f0-9]{64}\.(?:png|img)$/.test(item.storedFile)) continue;

            const filePath = join(importedDirectory(), item.storedFile);

            if(!existsSync(filePath)) continue;

            const data = await readFile(filePath);

            const mime = typeof item.mime === 'string' && item.mime.startsWith('image/') ? item.mime : 'image/png';

            skins.push({ ...item, storedFile: undefined, mime: undefined, dataUrl: `data:${ mime };base64,${ data.toString('base64') }` });
        }

        return skins;
    }
    catch
    {
        return [];
    }
});

ipcMain.handle('clove:store-imported-skins', async (_event, skins) =>
{
    if(!Array.isArray(skins) || skins.length > MAX_STORED_SKINS) throw new Error('Invalid imported image library.');

    await mkdir(importedDirectory(), { recursive: true });

    const stored = [];

    for(const skin of skins)
    {
        if(!skin || typeof skin.id !== 'string' || typeof skin.fileName !== 'string') throw new Error('Invalid imported image entry.');

        const { mime, buffer } = decodeDataUrl(skin.dataUrl);

        if(!mime.startsWith('image/')) throw new Error('An imported file is not an image.');
        if(buffer.length > MAX_IMAGE_BYTES) throw new Error('Imported images must be 10 MB or smaller.');

        const storedFile = `${ createHash('sha256').update(skin.id).digest('hex') }.img`;

        await writeFile(join(importedDirectory(), storedFile), buffer);
        stored.push({ ...skin, dataUrl: undefined, storedFile, mime });
    }

    await writeFile(importedMetadataPath(), `${ JSON.stringify(stored, null, 2) }\n`, 'utf8');

    const retainedFiles = new Set(stored.map(item => item.storedFile));

    for(const fileName of await readdir(importedDirectory()))
    {
        if(/^[a-f0-9]{64}\.(?:png|img)$/.test(fileName) && !retainedFiles.has(fileName)) await unlink(join(importedDirectory(), fileName));
    }
});

app.whenReady().then(async () =>
{
    await installProtocol();
    let contentReady = false;

    try
    {
        contentReady = await contentManager.initialize();
    }
    catch(error)
    {
        contentManager.publish({ phase: 'error', message: error instanceof Error ? error.message : String(error), recoverable: false });
    }

    const mainWindow = createWindow();
    let updatesConfigured = false;
    const showEditor = async () =>
    {
        await mainWindow.loadURL('clove://app/index.html');
        contentManager.beginBackgroundChecks();

        if(!updatesConfigured)
        {
            updatesConfigured = true;
            configureAutoUpdates(mainWindow);
        }
    };

    contentManager.attachWindow(mainWindow);
    contentManager.configureIpc(showEditor);

    if(contentReady) await showEditor();
    else
    {
        await mainWindow.loadURL('clove://app/bootstrap.html');
        void contentManager.bootstrap().then(showEditor).catch(error =>
        {
            // The bootstrap page receives the detailed error status and offers retry/quit actions.
            console.error('Clove could not install its required content.', error);
        });
    }

    app.on('activate', () =>
    {
        if(BrowserWindow.getAllWindows().length === 0)
        {
            const activatedWindow = createWindow();

            contentManager.attachWindow(activatedWindow);
            void activatedWindow.loadURL('clove://app/index.html');
        }
    });
});

app.on('window-all-closed', () =>
{
    if(process.platform !== 'darwin') app.quit();
});
