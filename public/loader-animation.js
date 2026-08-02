(() =>
{
    const visual = document.querySelector('.clove-loader-visual');
    const pot = visual?.querySelector('.clove-loader-pot-pulse');

    if(!visual || !pot || typeof pot.animate !== 'function') return;

    const host = document.querySelector('.clove-startup') || document.body;
    const layer = document.createElement('div');
    const activeAnimations = new Set();
    const timers = new Set();
    let impactTimer = 0;
    let disposed = false;

    layer.className = 'clove-loader-coins';
    layer.setAttribute('aria-hidden', 'true');
    host.appendChild(layer);

    const later = (callback, delay) =>
    {
        const timer = window.setTimeout(() =>
        {
            timers.delete(timer);
            callback();
        }, delay);

        timers.add(timer);
        return timer;
    };
    const random = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);
    const startAtWindowEdge = () =>
    {
        const margin = 24;
        const edge = Math.floor(Math.random() * 4);

        if(edge === 0) return { x: random(margin, innerWidth - margin), y: 8 };
        if(edge === 1) return { x: innerWidth - 40, y: random(margin, innerHeight - margin) };
        if(edge === 2) return { x: random(margin, innerWidth - margin), y: innerHeight - 40 };
        return { x: 8, y: random(margin, innerHeight - margin) };
    };
    const impact = () =>
    {
        pot.classList.remove('coin-impact');
        void pot.offsetWidth;
        pot.classList.add('coin-impact');
        window.clearTimeout(impactTimer);
        impactTimer = window.setTimeout(() => pot.classList.remove('coin-impact'), 460);
    };
    const spawnCoin = () =>
    {
        if(disposed || !visual.isConnected || document.hidden) return;

        const bounds = visual.querySelector('.clove-loader-pot')?.getBoundingClientRect();

        if(!bounds) return;

        const coin = document.createElement('img');
        const start = startAtWindowEdge();
        const target = {
            x: bounds.left + bounds.width * random(.43, .57) - 16,
            y: bounds.top + bounds.height * random(.2, .32) - 16
        };
        const deltaX = target.x - start.x;
        const deltaY = target.y - start.y;
        const curve = random(-1, 1) * Math.min(180, Math.max(55, Math.abs(deltaX) * .18));
        const duration = random(1050, 1500);

        coin.className = 'clove-loader-coin';
        coin.src = './startup-coin.png';
        coin.alt = '';
        coin.draggable = false;
        coin.style.left = `${ start.x }px`;
        coin.style.top = `${ start.y }px`;
        layer.appendChild(coin);

        const animation = coin.animate([
            { opacity: 0, transform: 'translate3d(0, 0, 0) scale(.55)', offset: 0 },
            { opacity: 1, transform: `translate3d(${ deltaX * .08 }px, ${ deltaY * .08 - 12 }px, 0) scale(1)`, offset: .12 },
            { opacity: 1, transform: `translate3d(${ deltaX * .44 + curve }px, ${ deltaY * .44 - 42 }px, 0) scale(1.12)`, offset: .5 },
            { opacity: .95, transform: `translate3d(${ deltaX * .82 - curve * .2 }px, ${ deltaY * .82 - 14 }px, 0) scale(.92)`, offset: .82 },
            { opacity: 0, transform: `translate3d(${ deltaX }px, ${ deltaY }px, 0) scale(.58)`, offset: 1 }
        ], {
            duration,
            easing: 'cubic-bezier(.3, .65, .25, 1)',
            fill: 'forwards'
        });

        activeAnimations.add(animation);
        animation.finished.then(() =>
        {
            activeAnimations.delete(animation);
            coin.remove();
            if(!disposed && visual.isConnected) impact();
        }).catch(() => coin.remove());
    };
    const scheduleNext = () =>
    {
        if(disposed) return;
        later(() =>
        {
            spawnCoin();
            scheduleNext();
        }, random(360, 620));
    };
    const cleanup = () =>
    {
        if(disposed) return;

        disposed = true;
        window.clearTimeout(impactTimer);
        for(const timer of timers) window.clearTimeout(timer);
        for(const animation of activeAnimations) animation.cancel();
        timers.clear();
        activeAnimations.clear();
        layer.remove();
        observer.disconnect();
    };
    const observer = new MutationObserver(() =>
    {
        if(!visual.isConnected) cleanup();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('pagehide', cleanup, { once: true });
    spawnCoin();
    later(spawnCoin, 180);
    scheduleNext();
})();
