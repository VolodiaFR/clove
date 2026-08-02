const message = document.getElementById('message');
const detail = document.getElementById('detail');
const actions = document.getElementById('actions');
const retry = document.getElementById('retry');
const quit = document.getElementById('quit');

const formatBytes = bytes =>
{
    if(!Number.isFinite(bytes) || bytes <= 0) return '';
    if(bytes >= 1024 * 1024 * 1024) return `${ (bytes / 1024 / 1024 / 1024).toFixed(1) } GB`;
    if(bytes >= 1024 * 1024) return `${ (bytes / 1024 / 1024).toFixed(1) } MB`;
    return `${ (bytes / 1024).toFixed(0) } KB`;
};

const render = status =>
{
    const reportedPercent = Math.max(0, Math.min(100, Number(status?.percent) || 0));
    actions.hidden = status?.phase !== 'error';

    if(status?.phase === 'checking')
    {
        message.textContent = 'Checking asset library...';
        detail.textContent = 'Clove is getting ready for first use.';
    }
    else if(status?.phase === 'downloading')
    {
        message.textContent = status.mode === 'archive'
            ? `Downloading assets · ${ Math.round(reportedPercent) }%`
            : `Downloading changed assets · ${ Math.round(reportedPercent) }%`;
        detail.textContent = `${ formatBytes(status.transferred) } of ${ formatBytes(status.total) }`;
    }
    else if(status?.phase === 'verifying')
    {
        message.textContent = 'Verifying downloaded assets...';
        detail.textContent = 'Making sure everything arrived safely.';
    }
    else if(status?.phase === 'installing')
    {
        const processed = Math.max(0, Number(status.processedObjects) || 0);
        const total = Math.max(0, Number(status.totalObjects) || 0);

        message.textContent = status.mode === 'extracting' && total
            ? `Loading asset ${ processed.toLocaleString() } / ${ total.toLocaleString() }`
            : 'Finishing asset setup...';
        detail.textContent = status.mode === 'extracting' ? 'Preparing Clove for first use.' : 'Almost ready.';
    }
    else if(status?.phase === 'fallback')
    {
        message.textContent = 'Retrying the asset download...';
        detail.textContent = 'Clove is switching to the complete verified library.';
    }
    else if(status?.phase === 'error')
    {
        message.textContent = 'Clove could not load its assets.';
        detail.textContent = status.message || 'Check your connection and try again.';
    }
};

retry.addEventListener('click', async () =>
{
    retry.disabled = true;
    actions.hidden = true;
    await window.cloveDesktop.installRequiredContent();
    retry.disabled = false;
});
quit.addEventListener('click', () => window.cloveDesktop.quit());
window.cloveDesktop.onContentStatus(render);
window.cloveDesktop.getContentStatus().then(render);
