const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const { mkdtemp, mkdir, readFile, rm, stat, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const tar = require('tar');
const { ContentStore, computeContentId, hashFile, objectPortablePath } = require('./content-store.cjs');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const write = async (filePath, value) =>
{
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, value);
};
const buildFeedVersion = async (feedRoot, values) =>
{
    const contentRoot = join(feedRoot, 'content');
    const files = Object.entries(values).map(([ path, value ]) =>
    {
        const buffer = Buffer.from(value);

        return { path, buffer, sha256: sha256(buffer), size: buffer.length };
    }).sort((left, right) => left.path.localeCompare(right.path));

    for(const file of new Map(files.map(file => [ file.sha256, file ])).values())
    {
        await write(join(contentRoot, objectPortablePath(file.sha256)), file.buffer);
    }

    const manifestFiles = files.map(({ path, sha256: hash, size }) => ({ path, sha256: hash, size }));
    const contentId = computeContentId(manifestFiles);
    const archiveRelativePath = `archives/clove-content-${ contentId }.tar.gz`;
    const archivePath = join(contentRoot, archiveRelativePath);
    const archiveEntries = Array.from(new Set(files.map(file => objectPortablePath(file.sha256)))).sort();

    await mkdir(dirname(archivePath), { recursive: true });
    await tar.c({ cwd: contentRoot, file: archivePath, gzip: { level: 1 }, noMtime: true, portable: true }, archiveEntries);

    const manifest = {
        schemaVersion: 1,
        contentId,
        files: manifestFiles,
        archive: {
            path: archiveRelativePath,
            sha256: await hashFile(archivePath),
            size: (await stat(archivePath)).size,
            format: 'tar.gz'
        }
    };

    await write(join(contentRoot, 'latest.json'), `${ JSON.stringify(manifest) }\n`);
    return manifest;
};
const requiredValues = marker => ({
    'assets/catalog/libraryAssets.json': JSON.stringify({ marker }),
    'assets/gamedata/ExternalTexts.json': JSON.stringify({ hello: marker }),
    'assets/truffle/manifest.json': JSON.stringify({ version: marker })
});

test('content store bootstraps once, patches by hash, activates safely, and falls back to a verified archive', async t =>
{
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'clove-content-test-'));
    const feedRoot = join(temporaryRoot, 'feed');
    const storeRoot = join(temporaryRoot, 'store');
    let currentManifest = await buildFeedVersion(feedRoot, {
        ...requiredValues('one'),
        'assets/images/library/old.png': 'old-image'
    });
    const requestCounts = new Map();
    const corruptObjectHashes = new Set();
    const server = createServer(async (request, response) =>
    {
        const path = new URL(request.url, 'http://localhost').pathname;

        requestCounts.set(path, (requestCounts.get(path) || 0) + 1);

        if(path === '/content/latest.json' && request.headers['if-none-match'] === `"${ currentManifest.contentId }"`)
        {
            response.writeHead(304);
            response.end();
            return;
        }

        try
        {
            let body = await readFile(join(feedRoot, path.replace(/^\/+/, '')));
            const objectHash = path.match(/\/objects\/[a-f0-9]{2}\/([a-f0-9]{64})$/)?.[1];

            if(objectHash && corruptObjectHashes.has(objectHash)) body = Buffer.alloc(body.length, 0x78);
            response.writeHead(200, {
                'Content-Length': body.length,
                ...(path === '/content/latest.json' ? { ETag: `"${ currentManifest.contentId }"`, 'Content-Type': 'application/json' } : {})
            });
            response.end(body);
        }
        catch
        {
            response.writeHead(404);
            response.end();
        }
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () =>
    {
        await new Promise(resolve => server.close(resolve));
        await rm(temporaryRoot, { recursive: true, force: true });
    });

    const manifestUrl = `http://127.0.0.1:${ server.address().port }/content/latest.json`;
    const statuses = [];
    const store = new ContentStore({ root: storeRoot, manifestUrl, logger: { warn() {}, error() {} }, onStatus: status => statuses.push(status) });

    assert.equal(await store.open(), false);
    assert.equal(await store.update({ required: true }), true);
    assert.equal((await readFile(store.resolve('assets/images/library/old.png'))).toString(), 'old-image');
    assert.equal(requestCounts.get(`/content/${ currentManifest.archive.path }`), 1, 'fresh install uses one archive');
    assert.equal(Array.from(requestCounts.keys()).some(path => path.includes('/objects/')), false, 'fresh install does not make thousands of object requests');
    assert.equal(statuses.some(status => status.phase === 'verifying' && status.mode === 'objects'), false, 'archive hash verification avoids rehashing every extracted object');
    assert.ok(statuses.some(status => status.phase === 'installing' && status.mode === 'extracting'), 'fresh install reports archive extraction');
    assert.ok(statuses.some(status => status.phase === 'installing' && status.mode === 'extracting' && status.processedObjects === status.totalObjects && status.totalObjects > 0), 'fresh install reports accurate extracted-object progress');
    assert.ok(statuses.some(status => status.phase === 'installing' && status.mode === 'activating'), 'fresh install reports atomic activation');

    const archiveRequestsAfterBootstrap = requestCounts.get(`/content/${ currentManifest.archive.path }`);

    assert.equal(await store.update({ required: true }), false, 'unchanged content is reused');
    assert.equal(requestCounts.get(`/content/${ currentManifest.archive.path }`), archiveRequestsAfterBootstrap, 'code-only checks never redownload content');

    const versionTwo = await buildFeedVersion(feedRoot, {
        ...requiredValues('two'),
        'assets/images/library/new.png': 'new-image'
    });

    currentManifest = versionTwo;
    assert.equal(await store.update({ required: true }), true);
    assert.equal((await readFile(store.resolve('assets/images/library/old.png'))).toString(), 'old-image', 'running app keeps its active manifest until restart');
    assert.equal(requestCounts.get(`/content/${ versionTwo.archive.path }`) || 0, 0, 'verified incremental update does not use the archive');
    assert.ok(Array.from(requestCounts.keys()).some(path => path.includes('/objects/')), 'changed objects are addressed by hash');

    const reopened = new ContentStore({ root: storeRoot, manifestUrl, logger: { warn() {}, error() {} } });

    assert.equal(await reopened.open(), true);
    assert.equal(reopened.resolve('assets/images/library/old.png'), null, 'deletion becomes visible only after atomic activation');
    assert.equal((await readFile(reopened.resolve('assets/images/library/new.png'))).toString(), 'new-image');

    const versionThree = await buildFeedVersion(feedRoot, {
        ...requiredValues('three'),
        'assets/images/library/new.png': 'newest-image'
    });
    const changedObject = versionThree.files.find(file => file.path === 'assets/images/library/new.png');

    currentManifest = versionThree;
    corruptObjectHashes.add(changedObject.sha256);
    assert.equal(await reopened.update({ required: true }), true, 'a bad patch falls back instead of replacing active content');
    assert.equal(requestCounts.get(`/content/${ versionThree.archive.path }`), 1, 'fallback downloads the complete archive once');

    const finalOpen = new ContentStore({ root: storeRoot, manifestUrl, logger: { warn() {}, error() {} } });

    assert.equal(await finalOpen.open(), true);
    assert.equal((await readFile(finalOpen.resolve('assets/images/library/new.png'))).toString(), 'newest-image');

    await rm(finalOpen.resolve('assets/images/library/new.png'), { force: true });
    const damagedOpen = new ContentStore({ root: storeRoot, manifestUrl, logger: { warn() {}, error() {} } });

    assert.equal(await damagedOpen.open(), true, 'a damaged current store rolls back to the retained manifest');
    assert.equal((await readFile(damagedOpen.resolve('assets/images/library/new.png'))).toString(), 'new-image');
    assert.equal(await damagedOpen.update({ required: true }), true, 'the latest manifest is fetched again after rollback');

    const repairedOpen = new ContentStore({ root: storeRoot, manifestUrl, logger: { warn() {}, error() {} } });

    assert.equal(await repairedOpen.open(), true);
    assert.equal((await readFile(repairedOpen.resolve('assets/images/library/new.png'))).toString(), 'newest-image');
});
