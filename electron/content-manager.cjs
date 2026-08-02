const { app, ipcMain, net } = require('electron');
const log = require('electron-log/main');
const { existsSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { isAbsolute, join, resolve, sep } = require('node:path');
const { ContentStore } = require('./content-store.cjs');

const CONTENT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const CONTENT_CHECK_DELAY_MS = 1500;
const CONTENT_CONFIG_SCHEMA_VERSION = 1;

const isInside = (root, candidate) => candidate === root || candidate.startsWith(`${ root }${ sep }`);
const localContentRoot = () =>
{
    if(process.env.CLOVE_CONTENT_DIR) return resolve(process.env.CLOVE_CONTENT_DIR);

    const windowsLocalData = process.platform === 'win32' && process.env.LOCALAPPDATA && isAbsolute(process.env.LOCALAPPDATA)
        ? process.env.LOCALAPPDATA
        : null;

    return windowsLocalData
        ? join(windowsLocalData, 'Clove', 'content-v1')
        : join(app.getPath('userData'), 'content-v1');
};

class ContentManager
{
    constructor()
    {
        this.window = null;
        this.store = null;
        this.status = { phase: 'idle' };
        this.checkTimer = null;
        this.recurringTimer = null;
        this.bootstrapPromise = null;
        this.ipcConfigured = false;
    }

    publish(status)
    {
        this.status = status;

        if(this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed())
        {
            this.window.webContents.send('clove:content-status', status);
        }
    }

    attachWindow(window)
    {
        this.window = window;
    }

    configureIpc(onReady)
    {
        if(this.ipcConfigured) return;

        this.ipcConfigured = true;
        ipcMain.handle('clove:get-content-status', () => this.status);
        ipcMain.handle('clove:install-required-content', async () =>
        {
            try
            {
                await this.bootstrap();
                await onReady();
                return true;
            }
            catch
            {
                return false;
            }
        });
        ipcMain.handle('clove:quit', () =>
        {
            app.quit();
            return true;
        });
    }

    async initialize()
    {
        if(!app.isPackaged)
        {
            this.publish({ phase: 'ready', development: true });
            return true;
        }

        log.initialize();
        const configPath = join(app.getAppPath(), 'dist', 'content-config.json');
        const config = JSON.parse(await readFile(configPath, 'utf8'));

        if(config?.schemaVersion !== CONTENT_CONFIG_SCHEMA_VERSION || typeof config.manifestUrl !== 'string')
        {
            throw new Error('Clove was packaged without a valid content feed configuration.');
        }

        const manifestUrl = new URL(config.manifestUrl);

        if(manifestUrl.protocol !== 'https:' && !(manifestUrl.protocol === 'http:' && [ '127.0.0.1', 'localhost' ].includes(manifestUrl.hostname)))
        {
            throw new Error('Clove content must be served over HTTPS.');
        }

        this.store = new ContentStore({
            root: localContentRoot(),
            manifestUrl: manifestUrl.toString(),
            fetch: (url, options) => net.fetch(url, options),
            logger: log,
            onStatus: status => this.publish(status)
        });

        return this.store.open();
    }

    async bootstrap()
    {
        if(!this.store)
        {
            if(app.isPackaged) throw new Error('Clove has no configured content store.');
            return true;
        }
        if(this.store.activeManifest) return true;
        if(this.bootstrapPromise) return this.bootstrapPromise;

        this.bootstrapPromise = this.store.update({ required: true }).then(() =>
        {
            if(!this.store.activeManifest) throw new Error('Clove content was downloaded but could not be activated.');
            return true;
        }).finally(() =>
        {
            this.bootstrapPromise = null;
        });

        return this.bootstrapPromise;
    }

    beginBackgroundChecks()
    {
        if(!this.store || this.checkTimer || this.recurringTimer) return;

        const check = () => void this.store.update();

        this.checkTimer = setTimeout(check, CONTENT_CHECK_DELAY_MS);
        this.checkTimer.unref();
        this.recurringTimer = setInterval(check, CONTENT_CHECK_INTERVAL_MS);
        this.recurringTimer.unref();
    }

    resolve(logicalPath)
    {
        const normalized = String(logicalPath || '').replaceAll('\\', '/').replace(/^\/+/, '');

        if(!normalized.startsWith('assets/')) return null;
        if(this.store) return this.store.resolve(normalized);

        const projectRoot = app.getAppPath();
        let candidate = null;
        let root = null;

        if(normalized === 'assets/catalog/libraryAssets.json')
        {
            root = join(projectRoot, 'src', 'clove', 'data');
            candidate = join(root, 'libraryAssets.json');
        }
        else if(normalized.startsWith('assets/truffle/'))
        {
            root = join(projectRoot, 'public', 'assets', 'truffle');
            candidate = resolve(root, normalized.slice('assets/truffle/'.length));
        }
        else
        {
            root = join(projectRoot, 'assets');
            candidate = resolve(root, normalized.slice('assets/'.length));
        }

        return candidate && isInside(root, candidate) && existsSync(candidate) ? candidate : null;
    }
}

module.exports = { ContentManager, localContentRoot };
