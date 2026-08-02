export interface CloveAssetImage
{
    id: string;
    name: string;
    internalName: string;
    logicalNames: string[];
    manifestNames: string[];
    file: string;
    width: number;
    height: number;
    bytes: number;
    variant: number;
    variantCount: number;
    packages: string[];
    source?: 'library';
    relativePath?: string;
}

interface CloveAssetAlias
{
    name: string;
    ref: string;
    region: [number, number, number, number] | null;
    package: string;
}

interface CloveAssetManifest
{
    id: string;
    component: string;
    imageCount: number;
}

export interface CloveAssetCatalog
{
    version: number;
    imageCount: number;
    uniqueNameCount: number;
    logicalNameCount: number;
    manifestCount: number;
    aliasCount: number;
    unresolvedManifestNames: string[];
    manifests: CloveAssetManifest[];
    aliases: CloveAssetAlias[];
    images: CloveAssetImage[];
}

export interface ResolvedCloveAsset
{
    image: CloveAssetImage;
    url: string;
    fallbackUrl?: string;
    region: [number, number, number, number] | null;
    alias?: CloveAssetAlias;
}

export let CLOVE_ASSET_CATALOG: CloveAssetCatalog = {
    version: 0,
    imageCount: 0,
    uniqueNameCount: 0,
    logicalNameCount: 0,
    manifestCount: 0,
    aliasCount: 0,
    unresolvedManifestNames: [],
    manifests: [],
    aliases: [],
    images: []
};
const imagesById = new Map<string, CloveAssetImage>();
const imagesByName = new Map<string, CloveAssetImage[]>();
const aliasesByName = new Map<string, CloveAssetAlias>();

export const initializeCloveAssetCatalog = (input: unknown) =>
{
    const catalog = input as Partial<CloveAssetCatalog> | null;

    if(!catalog || !Array.isArray(catalog.images) || !Array.isArray(catalog.aliases) || !Array.isArray(catalog.manifests))
    {
        throw new Error('Clove received an invalid asset catalog.');
    }

    CLOVE_ASSET_CATALOG = catalog as CloveAssetCatalog;
    imagesById.clear();
    imagesByName.clear();
    aliasesByName.clear();

    for(const image of CLOVE_ASSET_CATALOG.images)
    {
        if(!image || typeof image.id !== 'string' || typeof image.name !== 'string' || !Array.isArray(image.logicalNames)) continue;

        imagesById.set(image.id, image);
        const names = new Set([ image.id, image.name, image.internalName, ...image.logicalNames ]);

        for(const name of names)
        {
            const variants = imagesByName.get(name) || [];

            variants.push(image);
            imagesByName.set(name, variants);
        }
    }

    for(const alias of CLOVE_ASSET_CATALOG.aliases)
    {
        if(alias && typeof alias.name === 'string' && !aliasesByName.has(alias.name)) aliasesByName.set(alias.name, alias);
    }
};

export const loadCloveAssetCatalog = async () =>
{
    const response = await fetch('/assets/catalog/libraryAssets.json', { cache: 'no-store' });

    if(!response.ok) throw new Error(`Clove could not load its asset catalog (${ response.status }).`);

    initializeCloveAssetCatalog(await response.json());
};

const encodedPath = (value: string) => value.split('/').map(segment => encodeURIComponent(segment)).join('/');

export const cloveAssetImageUrl = (image: CloveAssetImage) => image.source === 'library' && image.relativePath
    ? `/assets/images/library/${ encodedPath(image.relativePath) }`
    : `/assets/images/library/${ encodeURIComponent(image.id) }.png`;
export const cloveAssetFallbackImageUrl = (_image: CloveAssetImage) => '';
const resolvedSource = (image: CloveAssetImage, region: [number, number, number, number] | null, alias?: CloveAssetAlias): ResolvedCloveAsset => ({
    image,
    url: cloveAssetImageUrl(image),
    fallbackUrl: cloveAssetFallbackImageUrl(image) || undefined,
    region,
    ...(alias ? { alias } : {})
});

export const resolveCloveAsset = (assetName: string, preferredId = ''): ResolvedCloveAsset | null =>
{
    const preferredAlias = preferredId ? aliasesByName.get(preferredId) : null;
    const preferred = preferredId
        ? (imagesById.get(preferredId) || (preferredAlias ? imagesByName.get(preferredAlias.ref)?.[0] : null))
        : null;

    if(preferred)
    {
        if([ preferred.id, preferred.name, preferred.internalName, ...preferred.logicalNames ].includes(assetName)) return resolvedSource(preferred, null);

        const assetAlias = aliasesByName.get(assetName);
        const aliasedImage = assetAlias ? imagesByName.get(assetAlias.ref)?.[0] : null;

        if(assetAlias && aliasedImage?.id === preferred.id) return resolvedSource(preferred, assetAlias.region, assetAlias);
    }

    const direct = imagesByName.get(assetName)?.[0];

    if(direct) return resolvedSource(direct, null);

    const alias = aliasesByName.get(assetName);
    const referenced = alias ? imagesByName.get(alias.ref)?.[0] : null;

    return alias && referenced ? resolvedSource(referenced, alias.region, alias) : null;
};

export const getCloveAssetImage = (id: string) => imagesById.get(id) || null;

const blobDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) =>
{
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Unable to read asset data.'));
    reader.readAsDataURL(blob);
});

const loadImage = (url: string, fallbackUrl = '') => new Promise<HTMLImageElement>((resolve, reject) =>
{
    const image = new Image();
    let usingFallback = false;

    image.onload = () => resolve(image);
    image.onerror = () =>
    {
        if(fallbackUrl && !usingFallback)
        {
            usingFallback = true;
            image.src = fallbackUrl;
            return;
        }

        reject(new Error(`Unable to load ${ url }.`));
    };
    image.src = url;
});

const fetchAsset = async (source: ResolvedCloveAsset) =>
{
    let response = await fetch(source.url);

    if(!response.ok && source.fallbackUrl) response = await fetch(source.fallbackUrl);

    return response;
};

export const cloveAssetDataUrl = async (assetName: string, preferredId = '') =>
{
    const source = resolveCloveAsset(assetName, preferredId);

    if(!source) throw new Error(`Asset '${ assetName }' is not present in the generated catalog.`);

    if(!source.region)
    {
        const response = await fetchAsset(source);

        if(!response.ok) throw new Error(`Asset '${ assetName }' could not be loaded (${ response.status }).`);

        return blobDataUrl(await response.blob());
    }

    const image = await loadImage(source.url, source.fallbackUrl);
    const [ x, y, width, height ] = source.region;
    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if(!context) throw new Error('Canvas rendering is unavailable.');

    context.drawImage(image, x, y, width, height, 0, 0, width, height);

    return canvas.toDataURL('image/png');
};
