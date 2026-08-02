import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { defineConfig, Plugin } from 'vite';

const MIME_TYPES: Record<string, string> = {
    '.gif': 'image/gif',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp'
};

const mountDirectory = (server: Parameters<NonNullable<Plugin['configureServer']>>[0], route: string, root: string) =>
{
    const absoluteRoot = resolve(root);
    const rootPrefix = `${ absoluteRoot }${ sep }`;

    server.middlewares.use(route, (request, response, next) =>
    {
        let relativePath = '';

        try
        {
            relativePath = decodeURIComponent((request.url || '/').split('?')[0]).replace(/^\/+/, '');
        }
        catch
        {
            response.statusCode = 400;
            response.end('Invalid asset path.');
            return;
        }

        const requestedPath = resolve(absoluteRoot, relativePath);

        if(requestedPath !== absoluteRoot && !requestedPath.startsWith(rootPrefix))
        {
            response.statusCode = 403;
            response.end('Asset path is outside the bundled library.');
            return;
        }

        if(!existsSync(requestedPath) || !statSync(requestedPath).isFile())
        {
            next();
            return;
        }

        response.setHeader('Content-Type', MIME_TYPES[extname(requestedPath).toLowerCase()] || 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-cache');
        createReadStream(requestedPath).pipe(response);
    });
};

const bundledAssetServer = (): Plugin => ({
    name: 'clove-bundled-assets',
    apply: 'serve',
    configureServer(server)
    {
        mountDirectory(server, '/assets/images', resolve(__dirname, 'assets', 'images'));
        mountDirectory(server, '/assets/gamedata', resolve(__dirname, 'assets', 'gamedata'));
        mountDirectory(server, '/assets/catalog', resolve(__dirname, 'src', 'clove', 'data'));
        mountDirectory(server, '/assets/truffle', resolve(__dirname, 'public', 'assets', 'truffle'));
        mountDirectory(server, '/', resolve(__dirname, 'public'));
    }
});

const rendererPublicFiles = (): Plugin => ({
    name: 'clove-renderer-public-files',
    apply: 'build',
    buildStart()
    {
        for(const fileName of [ 'cloveIcon.png', 'icon.png', 'loader-animation.js' ])
        {
            this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(__dirname, 'public', fileName)) });
        }

        for(const [ sourceName, fileName ] of [ [ 'Ubuntu-R.ttf', 'bootstrap-Ubuntu-R.ttf' ], [ 'Ubuntu-B.ttf', 'bootstrap-Ubuntu-B.ttf' ] ])
        {
            this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(__dirname, 'node_modules', 'truffle-text', 'payload', 'fonts', sourceName)) });
        }

        for(const [ sourceName, fileName ] of [ [ 'patsDay_potOGold.gif', 'startup-pot.gif' ], [ '1137_small_coin_png.png', 'startup-coin.png' ] ])
        {
            this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(__dirname, 'assets', 'images', 'library', sourceName)) });
        }
    }
});

export default defineConfig({
    base: './',
    publicDir: false,
    plugins: [ react(), bundledAssetServer(), rendererPublicFiles() ],
    resolve: {
        alias: {
            'node:fs/promises': resolve(__dirname, 'src', 'truffle', 'browserFsPromises.ts')
        }
    },
    build: {
        assetsDir: 'renderer-assets',
        assetsInlineLimit: 102400,
        sourcemap: false
    }
});
