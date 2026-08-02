const { createHash, randomBytes } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { mkdir, readFile, readdir, rename, rm, stat, writeFile } = require('node:fs/promises');
const { dirname, join, normalize, sep } = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const tar = require('tar');

const CONTENT_SCHEMA_VERSION = 1;
const STATE_SCHEMA_VERSION = 1;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_CONTENT_FILES = 100000;
const MAX_CONTENT_BYTES = 8 * 1024 * 1024 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const CONTENT_ID_PATTERN = /^[a-f0-9]{64}$/;
const REQUIRED_PATHS = [
    'assets/catalog/libraryAssets.json',
    'assets/gamedata/ExternalTexts.json',
    'assets/truffle/manifest.json'
];

const defaultState = () => ({
    schemaVersion: STATE_SCHEMA_VERSION,
    current: null,
    previous: null,
    pending: null,
    etag: null
});

const portablePath = value => String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
const isSafeContentPath = value =>
{
    const path = portablePath(value);

    return !!path && !path.includes('\0') && !path.split('/').some(segment => !segment || segment === '.' || segment === '..');
};
const isSafeRelativeUrlPath = value =>
{
    const path = portablePath(value);

    return isSafeContentPath(path) && !path.includes('?') && !path.includes('#') && !path.includes(':');
};
const canonicalManifestBody = files => JSON.stringify({
    schemaVersion: CONTENT_SCHEMA_VERSION,
    files: files.map(file => ({ path: file.path, sha256: file.sha256, size: file.size }))
});
const computeContentId = files => createHash('sha256').update(canonicalManifestBody(files)).digest('hex');
const objectRelativePath = hash => join('objects', hash.slice(0, 2), hash);
const objectPortablePath = hash => `objects/${ hash.slice(0, 2) }/${ hash }`;
const normalizeManifest = input =>
{
    if(!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The content manifest is not an object.');
    if(input.schemaVersion !== CONTENT_SCHEMA_VERSION) throw new Error(`Unsupported content manifest schema ${ input.schemaVersion }.`);
    if(!Array.isArray(input.files) || !input.files.length || input.files.length > MAX_CONTENT_FILES) throw new Error('The content manifest has an invalid file list.');

    const seenPaths = new Set();
    const sizesByHash = new Map();
    let totalBytes = 0;
    const files = input.files.map(file =>
    {
        const path = portablePath(file?.path);
        const sha256 = String(file?.sha256 || '').toLowerCase();
        const size = Number(file?.size);

        if(!isSafeContentPath(path) || !path.startsWith('assets/')) throw new Error(`Unsafe content path: ${ path || '<empty>' }`);
        if(seenPaths.has(path)) throw new Error(`Duplicate content path: ${ path }`);
        if(!HASH_PATTERN.test(sha256)) throw new Error(`Invalid content hash for ${ path }.`);
        if(!Number.isSafeInteger(size) || size < 0 || size > MAX_CONTENT_BYTES) throw new Error(`Invalid content size for ${ path }.`);
        if(sizesByHash.has(sha256) && sizesByHash.get(sha256) !== size) throw new Error(`Conflicting sizes for content hash ${ sha256 }.`);

        seenPaths.add(path);
        sizesByHash.set(sha256, size);
        totalBytes += size;
        if(totalBytes > MAX_CONTENT_BYTES) throw new Error('The content manifest is too large.');

        return { path, sha256, size };
    }).sort((left, right) => left.path.localeCompare(right.path));

    for(const requiredPath of REQUIRED_PATHS)
    {
        if(!seenPaths.has(requiredPath)) throw new Error(`The content manifest is missing ${ requiredPath }.`);
    }

    const contentId = String(input.contentId || '').toLowerCase();

    if(!CONTENT_ID_PATTERN.test(contentId) || contentId !== computeContentId(files)) throw new Error('The content manifest ID does not match its file list.');

    let archive = null;

    if(input.archive !== undefined)
    {
        const path = portablePath(input.archive?.path);
        const sha256 = String(input.archive?.sha256 || '').toLowerCase();
        const size = Number(input.archive?.size);

        if(!isSafeRelativeUrlPath(path) || !path.endsWith('.tar.gz')) throw new Error('The content archive path is invalid.');
        if(!HASH_PATTERN.test(sha256)) throw new Error('The content archive hash is invalid.');
        if(!Number.isSafeInteger(size) || size <= 0 || size > MAX_CONTENT_BYTES) throw new Error('The content archive size is invalid.');

        archive = { path, sha256, size, format: 'tar.gz' };
    }

    return {
        schemaVersion: CONTENT_SCHEMA_VERSION,
        contentId,
        totalBytes,
        files,
        ...(archive ? { archive } : {})
    };
};

const mapWithConcurrency = async (items, concurrency, worker) =>
{
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () =>
    {
        while(cursor < items.length)
        {
            const index = cursor++;

            await worker(items[index], index);
        }
    });

    const settled = await Promise.allSettled(workers);
    const rejected = settled.find(result => result.status === 'rejected');

    if(rejected) throw rejected.reason;
};

const hashFile = filePath => new Promise((resolve, reject) =>
{
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
});

const fileHasSize = async (filePath, size) =>
{
    try
    {
        const details = await stat(filePath);

        return details.isFile() && details.size === size;
    }
    catch
    {
        return false;
    }
};

const writeJsonAtomically = async (filePath, value) =>
{
    const temporaryPath = `${ filePath }.${ process.pid }.${ randomBytes(5).toString('hex') }.tmp`;

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(temporaryPath, `${ JSON.stringify(value, null, 2) }\n`, 'utf8');

    try
    {
        await rename(temporaryPath, filePath);
    }
    catch(error)
    {
        if(![ 'EEXIST', 'EPERM' ].includes(error?.code)) throw error;
        await rm(filePath, { force: true });
        await rename(temporaryPath, filePath);
    }
};

class ContentStore
{
    constructor({ root, manifestUrl, fetch: fetchImplementation = globalThis.fetch, logger = console, onStatus = () => {} })
    {
        if(!root) throw new Error('A content-store root is required.');
        if(!manifestUrl) throw new Error('A content manifest URL is required.');
        if(typeof fetchImplementation !== 'function') throw new Error('A fetch implementation is required.');

        const parsedManifestUrl = new URL(manifestUrl);

        if(![ 'https:', 'http:' ].includes(parsedManifestUrl.protocol)) throw new Error('The content manifest must use HTTP or HTTPS.');

        this.root = root;
        this.manifestUrl = parsedManifestUrl.toString();
        this.fetch = fetchImplementation;
        this.logger = logger;
        this.onStatus = onStatus;
        this.statePath = join(root, 'state.json');
        this.manifestsRoot = join(root, 'manifests');
        this.objectsRoot = join(root, 'objects');
        this.temporaryRoot = join(root, '.temporary');
        this.state = defaultState();
        this.activeManifest = null;
        this.activeFiles = new Map();
    }

    publish(phase, details = {})
    {
        this.onStatus({ phase, ...details });
    }

    objectPath(hash)
    {
        return join(this.root, objectRelativePath(hash));
    }

    manifestPath(contentId)
    {
        return join(this.manifestsRoot, `${ contentId }.json`);
    }

    resolve(logicalPath)
    {
        const entry = this.activeFiles.get(portablePath(logicalPath));

        return entry ? this.objectPath(entry.sha256) : null;
    }

    async readState()
    {
        try
        {
            const stored = JSON.parse(await readFile(this.statePath, 'utf8'));

            if(stored?.schemaVersion !== STATE_SCHEMA_VERSION) return defaultState();

            const validId = value => value === null || CONTENT_ID_PATTERN.test(String(value || ''));

            if(!validId(stored.current) || !validId(stored.previous) || !validId(stored.pending)) return defaultState();

            return {
                schemaVersion: STATE_SCHEMA_VERSION,
                current: stored.current || null,
                previous: stored.previous || null,
                pending: stored.pending || null,
                etag: typeof stored.etag === 'string' ? stored.etag : null
            };
        }
        catch
        {
            return defaultState();
        }
    }

    async writeState(nextState)
    {
        this.state = { ...defaultState(), ...nextState, schemaVersion: STATE_SCHEMA_VERSION };
        await writeJsonAtomically(this.statePath, this.state);
    }

    async readStoredManifest(contentId, verifyHashes = false)
    {
        const manifest = normalizeManifest(JSON.parse(await readFile(this.manifestPath(contentId), 'utf8')));

        if(manifest.contentId !== contentId) throw new Error(`Stored content manifest ${ contentId } has the wrong ID.`);

        const objects = Array.from(new Map(manifest.files.map(file => [ file.sha256, file ])).values());

        await mapWithConcurrency(objects, 32, async file =>
        {
            const filePath = this.objectPath(file.sha256);

            if(!await fileHasSize(filePath, file.size)) throw new Error(`Stored object ${ file.sha256 } is missing or truncated.`);
            if(verifyHashes && await hashFile(filePath) !== file.sha256) throw new Error(`Stored object ${ file.sha256 } failed verification.`);
        });

        return manifest;
    }

    setActiveManifest(manifest)
    {
        this.activeManifest = manifest;
        this.activeFiles = new Map(manifest.files.map(file => [ file.path, file ]));
    }

    async open()
    {
        await mkdir(this.root, { recursive: true });
        await rm(this.temporaryRoot, { recursive: true, force: true });
        this.state = await this.readState();

        if(this.state.pending)
        {
            try
            {
                await this.readStoredManifest(this.state.pending);
                await this.writeState({
                    ...this.state,
                    previous: this.state.current,
                    current: this.state.pending,
                    pending: null
                });
            }
            catch(error)
            {
                this.logger.warn?.(`Discarding incomplete pending Clove content ${ this.state.pending }.`, error);
                await this.writeState({ ...this.state, pending: null, etag: null });
            }
        }

        for(const candidate of [ this.state.current, this.state.previous ])
        {
            if(!candidate) continue;

            try
            {
                const manifest = await this.readStoredManifest(candidate);

                if(candidate !== this.state.current)
                {
                    await this.writeState({ ...this.state, current: candidate, previous: null, pending: null, etag: null });
                }

                this.setActiveManifest(manifest);
                this.publish('ready', { contentId: manifest.contentId, fileCount: manifest.files.length });
                void this.garbageCollect().catch(error => this.logger.warn?.('Clove content cleanup failed.', error));
                return true;
            }
            catch(error)
            {
                this.logger.warn?.(`Clove content ${ candidate } is not usable.`, error);
            }
        }

        this.activeManifest = null;
        this.activeFiles.clear();

        if(this.state.current || this.state.previous || this.state.pending || this.state.etag)
        {
            await this.writeState(defaultState());
        }

        return false;
    }

    async fetchLatestManifest()
    {
        this.publish('checking');
        const headers = this.state.etag ? { 'If-None-Match': this.state.etag } : undefined;
        const response = await this.fetch(this.manifestUrl, { headers });

        if(response.status === 304) return { manifest: null, etag: this.state.etag };
        if(!response.ok) throw new Error(`Content manifest request failed (${ response.status }).`);

        const declaredBytes = Number(response.headers.get('content-length') || 0);

        if(declaredBytes > MAX_MANIFEST_BYTES) throw new Error('The content manifest is too large.');

        const text = await response.text();

        if(Buffer.byteLength(text) > MAX_MANIFEST_BYTES) throw new Error('The content manifest is too large.');

        const manifest = normalizeManifest(JSON.parse(text));

        if(!manifest.archive) throw new Error('The published content manifest does not include a complete archive.');

        return { manifest, etag: response.headers.get('etag') || null };
    }

    async downloadToFile(url, filePath, expectedSize, onBytes = () => {}, expectedSha256 = null)
    {
        const response = await this.fetch(url);

        if(!response.ok || !response.body) throw new Error(`Content download failed (${ response.status }) for ${ url }.`);

        const declaredBytes = Number(response.headers.get('content-length') || 0);

        if(declaredBytes && declaredBytes !== expectedSize) throw new Error(`Content download size changed for ${ url }.`);

        await mkdir(dirname(filePath), { recursive: true });
        let received = 0;
        const hash = expectedSha256 ? createHash('sha256') : null;
        const counter = new Transform({
            transform(chunk, _encoding, callback)
            {
                received += chunk.length;
                hash?.update(chunk);
                onBytes(chunk.length, received);

                if(received > expectedSize)
                {
                    callback(new Error(`Content download exceeded its declared size for ${ url }.`));
                    return;
                }

                callback(null, chunk);
            }
        });
        const source = typeof response.body.getReader === 'function' ? Readable.fromWeb(response.body) : response.body;

        try
        {
            await pipeline(source, counter, createWriteStream(filePath, { flags: 'wx' }));
        }
        catch(error)
        {
            await rm(filePath, { force: true });
            throw error;
        }

        if(received !== expectedSize)
        {
            await rm(filePath, { force: true });
            throw new Error(`Content download was truncated for ${ url }.`);
        }

        if(hash && hash.digest('hex') !== expectedSha256)
        {
            await rm(filePath, { force: true });
            throw new Error(`Downloaded content failed SHA-256 verification for ${ url }.`);
        }
    }

    async replaceObject(sourcePath, hash, size)
    {
        const destination = this.objectPath(hash);

        if(await fileHasSize(destination, size) && await hashFile(destination) === hash)
        {
            await rm(sourcePath, { force: true });
            return;
        }

        await mkdir(dirname(destination), { recursive: true });
        await rm(destination, { force: true });
        await rename(sourcePath, destination);
    }

    async installArchive(manifest)
    {
        const archive = manifest.archive;

        if(!archive) throw new Error('A complete content archive is required.');

        const token = `${ manifest.contentId.slice(0, 12) }-${ process.pid }-${ randomBytes(5).toString('hex') }`;
        const archivePath = join(this.temporaryRoot, `${ token }.tar.gz`);
        const extractionRoot = join(this.temporaryRoot, token);
        const archiveUrl = new URL(archive.path, this.manifestUrl).toString();

        await mkdir(this.temporaryRoot, { recursive: true });
        this.publish('downloading', { mode: 'archive', transferred: 0, total: archive.size, percent: 0 });
        await this.downloadToFile(archiveUrl, archivePath, archive.size, (_bytes, received) => this.publish('downloading', {
            mode: 'archive',
            transferred: received,
            total: archive.size,
            percent: archive.size ? received / archive.size * 100 : 0
        }), archive.sha256);

        this.publish('verifying', { mode: 'archive', detail: 'The complete archive passed SHA-256 verification.' });

        const expectedObjects = new Map();

        for(const file of manifest.files) expectedObjects.set(file.sha256, file.size);

        const totalObjects = expectedObjects.size;

        let invalidEntry = '';
        const seenObjects = new Set();
        let lastReportedObjects = 0;
        const publishExtractionProgress = force =>
        {
            if(!force && seenObjects.size - lastReportedObjects < 100) return;

            lastReportedObjects = seenObjects.size;
            this.publish('installing', {
                mode: 'extracting',
                detail: 'Unpacking the verified content library.',
                processedObjects: seenObjects.size,
                totalObjects
            });
        };

        await mkdir(extractionRoot, { recursive: true });
        publishExtractionProgress(true);
        await tar.x({
            cwd: extractionRoot,
            file: archivePath,
            strict: true,
            filter: (entryPath, entry) =>
            {
                const path = portablePath(entryPath).replace(/\/$/, '');
                const objectMatch = path.match(/^objects\/([a-f0-9]{2})\/([a-f0-9]{64})$/);
                const validDirectory = entry.type === 'Directory' && (path === 'objects' || /^objects\/[a-f0-9]{2}$/.test(path));
                const validObject = entry.type === 'File'
                    && objectMatch
                    && objectMatch[1] === objectMatch[2].slice(0, 2)
                    && expectedObjects.get(objectMatch[2]) === entry.size
                    && !seenObjects.has(objectMatch[2]);

                if(!validDirectory && !validObject) invalidEntry ||= entryPath;
                if(validObject)
                {
                    seenObjects.add(objectMatch[2]);
                    publishExtractionProgress(seenObjects.size === totalObjects);
                }
                return !!(validDirectory || validObject);
            }
        });

        if(invalidEntry) throw new Error(`The complete archive contains an unexpected entry: ${ invalidEntry }`);
        if(seenObjects.size !== expectedObjects.size) throw new Error('The complete archive is missing one or more content objects.');

        const objects = Array.from(expectedObjects, ([ sha256, size ]) => ({ sha256, size }));
        const extractedObjectsRoot = join(extractionRoot, 'objects');

        await rm(archivePath, { force: true });
        this.publish('installing', {
            mode: 'activating',
            detail: 'Activating the verified content library.',
            processedObjects: totalObjects,
            totalObjects
        });

        if(!this.activeManifest)
        {
            // The verified archive is already laid out exactly like the object store. Replacing
            // the directory avoids 15,000 extra hashes and individual NTFS rename operations.
            await rm(this.objectsRoot, { recursive: true, force: true });
            await rename(extractedObjectsRoot, this.objectsRoot);
        }
        else
        {
            // Archive fallback must preserve objects referenced by the running and rollback
            // manifests. Existing store objects were verified when originally installed.
            await mapWithConcurrency(objects, 32, async object =>
            {
                const sourcePath = join(extractionRoot, objectRelativePath(object.sha256));

                if(await fileHasSize(this.objectPath(object.sha256), object.size))
                {
                    await rm(sourcePath, { force: true });
                    return;
                }

                await this.replaceObject(sourcePath, object.sha256, object.size);
            });
        }

        await rm(this.temporaryRoot, { recursive: true, force: true });
    }

    async installPatch(manifest)
    {
        const uniqueObjects = Array.from(new Map(manifest.files.map(file => [ file.sha256, file ])).values());
        const missing = [];

        await mapWithConcurrency(uniqueObjects, 32, async file =>
        {
            if(!await fileHasSize(this.objectPath(file.sha256), file.size)) missing.push(file);
        });

        if(!missing.length) return;

        const total = missing.reduce((sum, file) => sum + file.size, 0);
        const progressByHash = new Map();
        const publishProgress = () =>
        {
            const transferred = Array.from(progressByHash.values()).reduce((sum, value) => sum + value, 0);

            this.publish('downloading', {
                mode: 'objects',
                objectCount: missing.length,
                transferred,
                total,
                percent: total ? transferred / total * 100 : 100
            });
        };

        this.publish('downloading', { mode: 'objects', objectCount: missing.length, transferred: 0, total, percent: 0 });
        await mkdir(this.temporaryRoot, { recursive: true });
        await mapWithConcurrency(missing, 6, async file =>
        {
            const temporaryPath = join(this.temporaryRoot, `${ file.sha256 }.part`);
            const objectUrl = new URL(objectPortablePath(file.sha256), this.manifestUrl).toString();

            await this.downloadToFile(objectUrl, temporaryPath, file.size, (_bytes, received) =>
            {
                progressByHash.set(file.sha256, received);
                publishProgress();
            }, file.sha256);

            await this.replaceObject(temporaryPath, file.sha256, file.size);
        });

        await rm(this.temporaryRoot, { recursive: true, force: true });
    }

    async storeManifest(manifest, { activate, etag })
    {
        await writeJsonAtomically(this.manifestPath(manifest.contentId), manifest);

        if(activate)
        {
            await this.writeState({
                ...this.state,
                previous: this.state.current,
                current: manifest.contentId,
                pending: null,
                etag
            });
            this.setActiveManifest(manifest);
        }
        else
        {
            await this.writeState({ ...this.state, pending: manifest.contentId, etag });
        }
    }

    async update({ required = false } = {})
    {
        try
        {
            const { manifest, etag } = await this.fetchLatestManifest();

            if(!manifest)
            {
                this.publish('current', { contentId: this.activeManifest?.contentId });
                return false;
            }

            if([ this.state.current, this.state.pending ].includes(manifest.contentId))
            {
                if(etag && etag !== this.state.etag) await this.writeState({ ...this.state, etag });
                this.publish('current', { contentId: manifest.contentId });
                return false;
            }

            const activate = !this.activeManifest;

            if(activate)
            {
                await this.installArchive(manifest);
            }
            else
            {
                try
                {
                    await this.installPatch(manifest);
                }
                catch(error)
                {
                    this.logger.warn?.('The incremental Clove content update failed; retrying with the complete verified archive.', error);
                    this.publish('fallback', { message: 'The incremental update could not be verified. Downloading the complete archive.' });
                    await rm(this.temporaryRoot, { recursive: true, force: true });
                    await this.installArchive(manifest);
                }
            }

            await this.storeManifest(manifest, { activate, etag });
            this.publish('ready', {
                contentId: manifest.contentId,
                fileCount: manifest.files.length,
                restartRequired: !activate
            });

            if(activate) void this.garbageCollect().catch(error => this.logger.warn?.('Clove content cleanup failed.', error));
            return true;
        }
        catch(error)
        {
            await rm(this.temporaryRoot, { recursive: true, force: true }).catch(() => {});
            this.publish('error', { message: error instanceof Error ? error.message : String(error), recoverable: !required });
            if(required) throw error;
            this.logger.error?.('Clove content update failed; the installed content remains active.', error);
            return false;
        }
    }

    async garbageCollect()
    {
        const retainedManifestIds = [ this.state.current, this.state.previous, this.state.pending ].filter(Boolean);
        const retainedHashes = new Set();

        for(const contentId of retainedManifestIds)
        {
            try
            {
                const manifest = normalizeManifest(JSON.parse(await readFile(this.manifestPath(contentId), 'utf8')));

                for(const file of manifest.files) retainedHashes.add(file.sha256);
            }
            catch
            {
                // A broken retained manifest is ignored; open() will recover on the next launch.
            }
        }

        try
        {
            for(const prefix of await readdir(this.objectsRoot, { withFileTypes: true }))
            {
                if(!prefix.isDirectory() || !/^[a-f0-9]{2}$/.test(prefix.name)) continue;
                const prefixRoot = join(this.objectsRoot, prefix.name);

                for(const object of await readdir(prefixRoot, { withFileTypes: true }))
                {
                    if(object.isFile() && HASH_PATTERN.test(object.name) && !retainedHashes.has(object.name)) await rm(join(prefixRoot, object.name), { force: true });
                }
            }
        }
        catch(error)
        {
            if(error?.code !== 'ENOENT') throw error;
        }

        try
        {
            for(const entry of await readdir(this.manifestsRoot, { withFileTypes: true }))
            {
                const match = entry.isFile() && entry.name.match(/^([a-f0-9]{64})\.json$/);

                if(match && !retainedManifestIds.includes(match[1])) await rm(join(this.manifestsRoot, entry.name), { force: true });
            }
        }
        catch(error)
        {
            if(error?.code !== 'ENOENT') throw error;
        }
    }
}

module.exports = {
    CONTENT_SCHEMA_VERSION,
    ContentStore,
    REQUIRED_PATHS,
    canonicalManifestBody,
    computeContentId,
    hashFile,
    normalizeManifest,
    objectPortablePath
};
