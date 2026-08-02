import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const libraryRoot = join(projectRoot, 'assets', 'images', 'library');
const baseCatalogPath = join(projectRoot, 'src', 'clove', 'data', 'assets.json');
const contentAliasesPath = join(projectRoot, 'src', 'clove', 'data', 'contentAliases.json');
const catalogPath = join(projectRoot, 'src', 'clove', 'data', 'libraryAssets.json');
const IMAGE_EXTENSIONS = new Set([ '.gif', '.jpg', '.jpeg', '.png' ]);

const relativePathOf = filePath => relative(libraryRoot, filePath).split(sep).join('/');

const walkImages = async root =>
{
    const files = [];
    const pending = [ root ];

    while(pending.length)
    {
        const directory = pending.pop();

        for(const entry of await readdir(directory, { withFileTypes: true }))
        {
            const fullPath = join(directory, entry.name);

            if(entry.isDirectory()) pending.push(fullPath);
            else if(entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(fullPath);
        }
    }

    return files.sort((left, right) => relativePathOf(left).localeCompare(relativePathOf(right)));
};

const dimensions = async filePath =>
{
    const extension = extname(filePath).toLowerCase();
    const handle = await open(filePath, 'r');

    try
    {
        if(extension === '.png')
        {
            const buffer = Buffer.alloc(24);

            await handle.read(buffer, 0, buffer.length, 0);
            if(buffer.toString('ascii', 1, 4) === 'PNG') return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
        }

        if(extension === '.gif')
        {
            const buffer = Buffer.alloc(10);

            await handle.read(buffer, 0, buffer.length, 0);
            if(buffer.toString('ascii', 0, 3) === 'GIF') return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
        }

        if(extension === '.jpg' || extension === '.jpeg')
        {
            const details = await handle.stat();
            const buffer = Buffer.alloc(Math.min(details.size, 512 * 1024));

            await handle.read(buffer, 0, buffer.length, 0);

            for(let offset = 2; offset + 9 < buffer.length;)
            {
                if(buffer[offset] !== 0xFF) { offset++; continue; }

                const marker = buffer[offset + 1];
                const length = buffer.readUInt16BE(offset + 2);

                if([ 0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF ].includes(marker))
                {
                    return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
                }

                if(!length || length < 2) break;
                offset += 2 + length;
            }
        }
    }
    finally
    {
        await handle.close();
    }

    return { width: 1, height: 1 };
};

const mapInBatches = async (items, map, concurrency = 32) =>
{
    const results = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () =>
    {
        while(cursor < items.length)
        {
            const index = cursor++;
            results[index] = await map(items[index], index);
        }
    });

    await Promise.all(workers);
    return results;
};

const baseCatalog = JSON.parse(await readFile(baseCatalogPath, 'utf8'));
const contentAliases = JSON.parse(await readFile(contentAliasesPath, 'utf8'));
const imageFiles = await walkImages(libraryRoot);
const filesByRelativePath = new Map(imageFiles.map(filePath => [ relativePathOf(filePath).toLowerCase(), filePath ]));
const coreImages = baseCatalog.images.filter(image => filesByRelativePath.has(`${ image.id }.png`.toLowerCase()));
const coreFileNames = new Set(coreImages.map(image => `${ image.id }.png`.toLowerCase()));
const additionalFiles = imageFiles.filter(filePath => !coreFileNames.has(relativePathOf(filePath).toLowerCase()));
const displayNames = additionalFiles.map(filePath => basename(filePath, extname(filePath)));
const variantCounts = displayNames.reduce((counts, name) =>
{
    const key = name.toLowerCase();

    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
}, new Map());
const nextVariant = new Map();
const variantByIndex = displayNames.map(name =>
{
    const normalizedName = name.toLowerCase();
    const variant = (nextVariant.get(normalizedName) || 0) + 1;

    nextVariant.set(normalizedName, variant);
    return variant;
});

const additionalImages = await mapInBatches(additionalFiles, async (filePath, index) =>
{
    const relativePath = relativePathOf(filePath);
    const fileName = basename(filePath);
    const name = displayNames[index];
    const normalizedName = name.toLowerCase();
    const fileDetails = await stat(filePath);
    const size = await dimensions(filePath);

    return {
        id: `library_${ createHash('sha1').update(relativePath.toLowerCase()).digest('hex').slice(0, 20) }`,
        name,
        internalName: name,
        logicalNames: Array.from(new Set([ name, fileName ])),
        manifestNames: [],
        file: relativePath,
        relativePath,
        source: 'library',
        width: size.width,
        height: size.height,
        bytes: fileDetails.size,
        variant: variantByIndex[index],
        variantCount: variantCounts.get(normalizedName),
        packages: [ 'bundled:library' ]
    };
});

const packageCounts = new Map();

for(const image of coreImages)
{
    for(const packageId of image.packages) packageCounts.set(packageId, (packageCounts.get(packageId) || 0) + 1);
}

const manifests = baseCatalog.manifests
    .map(manifest => ({ ...manifest, imageCount: packageCounts.get(manifest.id) || 0 }))
    .filter(manifest => manifest.imageCount > 0);

if(additionalImages.length) manifests.push({ id: 'bundled:library', component: 'Assets', imageCount: additionalImages.length });

const images = [ ...coreImages, ...additionalImages ];
const availableNames = new Set(images.flatMap(image => [ image.id, image.name, image.internalName, ...image.logicalNames ]));
const contentAliasTargets = new Map(contentAliases.map(alias => [ alias.name, alias.ref ]));
const resolveAliasTarget = name =>
{
    const visited = new Set();
    let target = name;

    while(contentAliasTargets.has(target) && !visited.has(target))
    {
        visited.add(target);
        target = contentAliasTargets.get(target);
    }

    return target;
};
const aliasCandidates = [
    ...baseCatalog.aliases.map(alias => ({ ...alias, ref: resolveAliasTarget(alias.ref) })),
    ...contentAliases.map(alias => ({ ...alias, ref: resolveAliasTarget(alias.ref), region: null, package: 'bundled:library' }))
];
const aliasesByName = new Map();

for(const alias of aliasCandidates)
{
    if(availableNames.has(alias.name) || !availableNames.has(alias.ref) || aliasesByName.has(alias.name)) continue;

    aliasesByName.set(alias.name, alias);
}

const aliases = Array.from(aliasesByName.values());
const logicalNames = new Set(images.flatMap(image => [ image.internalName, ...image.logicalNames ]));
const catalog = {
    version: 2,
    imageCount: images.length,
    uniqueNameCount: new Set(images.map(image => image.name)).size,
    logicalNameCount: logicalNames.size,
    manifestCount: manifests.length,
    aliasCount: aliases.length,
    unresolvedManifestNames: baseCatalog.unresolvedManifestNames,
    manifests,
    aliases,
    images
};

await mkdir(dirname(catalogPath), { recursive: true });
await writeFile(catalogPath, `${ JSON.stringify(catalog) }\n`, 'utf8');

const totalBytes = images.reduce((sum, image) => sum + image.bytes, 0);

console.log(`Indexed ${ images.length.toLocaleString() } images from assets/images/library (${ (totalBytes / 1024 / 1024).toFixed(1) } MB).`);
console.log(`Kept metadata for ${ coreImages.length.toLocaleString() } core images and indexed ${ additionalImages.length.toLocaleString() } library images.`);
console.log('No files were copied, restored, or deleted. The library folder is the source of truth.');
