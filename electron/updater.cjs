const { app, BrowserWindow, ipcMain } = require('electron');
const log = require('electron-log/main');
const { autoUpdater } = require('electron-updater');

const UPDATE_CHECK_DELAY_MS = 750;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const UPDATE_INSTALL_NOTICE_MS = 2500;

const configureAutoUpdates = mainWindow =>
{
    let status = { phase: 'idle', currentVersion: app.getVersion() };
    let clearCurrentTimer = null;
    let installStarted = false;
    const activeWindow = () => BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows().find(window => !window.isDestroyed())
        || (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
    const publishStatus = next =>
    {
        status = { currentVersion: app.getVersion(), ...next };

        const window = activeWindow();

        if(window && !window.webContents.isDestroyed()) window.webContents.send('clove:update-status', status);
    };

    ipcMain.handle('clove:get-update-status', () => status);
    ipcMain.handle('clove:check-for-updates', () =>
    {
        if(!app.isPackaged)
        {
            publishStatus({ phase: 'idle' });
            return false;
        }

        void checkForUpdates();
        return true;
    });
    ipcMain.handle('clove:install-update', () =>
    {
        if(!app.isPackaged || status.phase !== 'ready' || installStarted) return false;

        installStarted = true;
        publishStatus({ phase: 'installing', version: status.version });
        log.info(`Clove ${ status.version } installation requested; showing the shutdown notice before starting the ${ process.platform === 'darwin' ? 'macOS updater' : 'NSIS installer' }.`);

        const installTimer = setTimeout(() => autoUpdater.quitAndInstall(true, true), UPDATE_INSTALL_NOTICE_MS);

        installTimer.unref();
        return true;
    });

    if(!app.isPackaged) return;

    autoUpdater.logger = log;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    if(process.platform === 'win32') autoUpdater.disableWebInstaller = true;

    const setProgress = value => activeWindow()?.setProgressBar(value);

    autoUpdater.on('checking-for-update', () =>
    {
        log.info('Checking the configured feed for Clove updates.');
        publishStatus({ phase: 'checking' });
    });
    autoUpdater.on('update-available', info =>
    {
        log.info(`Clove ${ info.version } is available; downloading.`);
        setProgress(2);
        publishStatus({ phase: 'downloading', version: info.version, percent: 0, transferred: 0, total: 0 });
    });
    autoUpdater.on('update-not-available', info =>
    {
        log.info(`Clove ${ app.getVersion() } is current (feed version: ${ info.version }).`);
        setProgress(-1);
        publishStatus({ phase: 'current' });

        if(clearCurrentTimer) clearTimeout(clearCurrentTimer);
        clearCurrentTimer = setTimeout(() => publishStatus({ phase: 'idle' }), 4000);
        clearCurrentTimer.unref();
    });
    autoUpdater.on('download-progress', progress =>
    {
        const percent = Math.max(0, Math.min(100, progress.percent));

        setProgress(percent / 100);
        publishStatus({
            phase: 'downloading',
            version: status.version,
            percent,
            transferred: progress.transferred,
            total: progress.total,
            bytesPerSecond: progress.bytesPerSecond
        });
    });
    autoUpdater.on('error', error =>
    {
        setProgress(-1);
        publishStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
        log.error('Clove automatic update failed.', error);
    });
    autoUpdater.on('update-downloaded', info =>
    {
        setProgress(-1);
        log.info(`Clove ${ info.version } downloaded and passed update verification.`);
        publishStatus({ phase: 'ready', version: info.version, percent: 100 });
    });

    const checkForUpdates = () => autoUpdater.checkForUpdates().catch(error =>
    {
        publishStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
        log.error('Clove could not check for updates.', error);
    });
    const beginInitialCheck = () =>
    {
        const initialCheck = setTimeout(checkForUpdates, UPDATE_CHECK_DELAY_MS);

        initialCheck.unref();
    };

    // configureAutoUpdates is called only after showEditor has awaited loadURL. Listening for
    // did-finish-load here can miss the event and postpone the first check for four hours.
    beginInitialCheck();

    const recurringCheck = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);

    recurringCheck.unref();
};

module.exports = { configureAutoUpdates };
