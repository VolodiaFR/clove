import { FC, useLayoutEffect, useMemo, useRef } from 'react';
import { CLOVE_SKIN_ASSETS } from '../../clove/data/skinAssets';
import registryJson from '../../clove/data/skins.json';

export type HabboSkinState = 'default' | 'active' | 'hovering' | 'pressed' | 'selected' | 'disabled';

export interface RegistryEntity
{
    name: string;
    id?: string;
    colorize?: string;
    rect: [number, number, number, number];
    scaleH: string;
    scaleV: string;
}

interface RegistryTemplate
{
    asset: string;
    entities: RegistryEntity[];
}

interface RegistryLayout
{
    transparent: boolean;
    entities: RegistryEntity[];
}

export interface RegistrySkin
{
    id: string;
    name: string;
    states: { name: string; layout: string; template: string }[];
    templates: Record<string, RegistryTemplate>;
    layouts: Record<string, RegistryLayout>;
}

export interface SkinRegistry
{
    skinCount: number;
    assetCount: number;
    assets: Record<string, string>;
    skins: Record<string, RegistrySkin>;
}

export interface SkinRegistryLayer
{
    registryId: string;
    layout: string;
    template?: string;
    state?: HabboSkinState;
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    width?: number;
    height?: number;
}

interface SkinRegistryViewProps
{
    className?: string;
    registryId?: string;
    layout?: string;
    state?: HabboSkinState;
    template?: string;
    color?: number;
    layers?: SkinRegistryLayer[];
}

const registry = registryJson as unknown as SkinRegistry;
const imagePromises = new Map<string, Promise<HTMLImageElement>>();
const renderedSkinCache = new Map<string, { promise: Promise<HTMLCanvasElement>; pixels: number }>();
const extensions = new Map<string, SkinRegistryExtension>();
const MAX_RENDERED_SKIN_CACHE_SIZE = 256;
const MAX_RENDERED_SKIN_CACHE_PIXELS = 8 * 1024 * 1024;
let renderedSkinCachePixels = 0;
let registryRevision = 0;

const clearRenderedSkinCache = () =>
{
    renderedSkinCache.clear();
    renderedSkinCachePixels = 0;
};

export interface SkinRegistryExtension
{
    assets?: Record<string, string>;
    skins?: Record<string, RegistrySkin>;
}

export const setSkinRegistryExtension = (namespace: string, extension: SkinRegistryExtension = {}) =>
{
    extensions.set(namespace, {
        assets: { ...(extension.assets || {}) },
        skins: { ...(extension.skins || {}) }
    });
    registryRevision++;
    clearRenderedSkinCache();
};

const mergedExtension = () =>
{
    const assets: Record<string, string> = {};
    const skins: Record<string, RegistrySkin> = {};

    for(const extension of extensions.values())
    {
        Object.assign(assets, extension.assets || {});
        Object.assign(skins, extension.skins || {});
    }

    return { assets, skins };
};

export const getSkinRegistryAssetUrl = (assetName: string) => mergedExtension().assets[assetName] || CLOVE_SKIN_ASSETS[assetName] || '';

export const getCloveSkinRegistry = (): SkinRegistry =>
{
    const extension = mergedExtension();

    return {
        ...registry,
        skinCount: registry.skinCount + Object.keys(extension.skins).length,
        assetCount: registry.assetCount + Object.keys(extension.assets).length,
        assets: { ...registry.assets, ...Object.fromEntries(Object.keys(extension.assets).map(name => [ name, 'project' ])) },
        skins: { ...registry.skins, ...extension.skins }
    };
};

const getImage = (url: string) =>
{
    let promise = imagePromises.get(url);

    if(promise) return promise;

    promise = new Promise((resolve, reject) =>
    {
        const image = new Image();

        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
    });

    imagePromises.set(url, promise);

    return promise;
};

const boundsOf = (entities: RegistryEntity[]) => entities.reduce((bounds, entity) => ({
    width: Math.max(bounds.width, entity.rect[0] + entity.rect[2]),
    height: Math.max(bounds.height, entity.rect[1] + entity.rect[3])
}), { width: 0, height: 0 });

const minimumAxisSize = (entities: RegistryEntity[], axis: 0 | 1, natural: number) =>
{
    const leading = entities.filter(entity => (axis === 0 ? entity.scaleH : entity.scaleV) === 'fixed').reduce((value, entity) => Math.max(value, entity.rect[axis] + entity.rect[axis + 2]), 0);
    const trailing = entities.filter(entity => (axis === 0 ? entity.scaleH : entity.scaleV) === 'move').reduce((value, entity) => Math.max(value, natural - entity.rect[axis]), 0);

    return Math.max(1, Math.min(natural, leading + trailing || leading || trailing || 1));
};

export const getSkinRegistryLayoutGeometry = (registryId: string, layoutName: string) =>
{
    const skin = mergedExtension().skins[registryId] || registry.skins[registryId];
    const layout = skin?.layouts[layoutName];

    if(!layout) return null;

    const natural = boundsOf(layout.entities);

    return {
        width: Math.max(1, natural.width),
        height: Math.max(1, natural.height),
        minWidth: minimumAxisSize(layout.entities, 0, natural.width),
        minHeight: minimumAxisSize(layout.entities, 1, natural.height)
    };
};

const transformAxis = (start: number, size: number, mode: string, delta: number) =>
{
    if(mode === 'move') return [ start + delta, size ];
    if(mode === 'strech' || mode === 'stretch' || mode === 'tiled') return [ start, Math.max(0, size + delta) ];

    return [ start, size ];
};

const drawEntity = (context: CanvasRenderingContext2D, image: CanvasImageSource, source: RegistryEntity['rect'], destination: [number, number, number, number], tiledH: boolean, tiledV: boolean, contain = false) =>
{
    const [ sourceX, sourceY, sourceWidth, sourceHeight ] = source;
    const [ destinationX, destinationY, destinationWidth, destinationHeight ] = destination;

    if(!tiledH && !tiledV)
    {
        if(contain && sourceWidth > 0 && sourceHeight > 0 && destinationWidth > 0 && destinationHeight > 0)
        {
            const scale = Math.min(destinationWidth / sourceWidth, destinationHeight / sourceHeight);
            const drawWidth = sourceWidth * scale;
            const drawHeight = sourceHeight * scale;

            context.drawImage(
                image,
                sourceX,
                sourceY,
                sourceWidth,
                sourceHeight,
                destinationX + (destinationWidth - drawWidth) / 2,
                destinationY + (destinationHeight - drawHeight) / 2,
                drawWidth,
                drawHeight
            );
            return;
        }

        context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, destinationX, destinationY, destinationWidth, destinationHeight);
        return;
    }

    context.save();
    context.beginPath();
    context.rect(destinationX, destinationY, destinationWidth, destinationHeight);
    context.clip();

    const tileWidth = tiledH ? sourceWidth : destinationWidth;
    const tileHeight = tiledV ? sourceHeight : destinationHeight;

    for(let y = destinationY; y < destinationY + destinationHeight; y += tileHeight)
    {
        for(let x = destinationX; x < destinationX + destinationWidth; x += tileWidth)
        {
            const width = Math.min(tileWidth, destinationX + destinationWidth - x);
            const height = Math.min(tileHeight, destinationY + destinationHeight - y);
            context.drawImage(image, sourceX, sourceY, sourceWidth * width / tileWidth, sourceHeight * height / tileHeight, x, y, width, height);
        }
    }

    context.restore();
};

const tint = (source: HTMLCanvasElement, color: number) =>
{
    if(color === 0xFFFFFF) return;

    const context = source.getContext('2d');

    if(!context) return;

    const imageData = context.getImageData(0, 0, source.width, source.height);
    const red = ((color >> 16) & 0xFF) / 255;
    const green = ((color >> 8) & 0xFF) / 255;
    const blue = (color & 0xFF) / 255;

    for(let index = 0; index < imageData.data.length; index += 4)
    {
        imageData.data[index] *= red;
        imageData.data[index + 1] *= green;
        imageData.data[index + 2] *= blue;
    }

    context.putImageData(imageData, 0, 0);
};

const drawLayer = async (context: CanvasRenderingContext2D, layer: SkinRegistryLayer, canvasWidth: number, canvasHeight: number, color: number) =>
{
    const skin = mergedExtension().skins[layer.registryId] || registry.skins[layer.registryId];

    if(!skin) return;

    const layout = skin.layouts[layer.layout];

    if(!layout) return;

    const state = layer.state || 'default';
    const stateDefinition = skin.states.find(value => value.layout === layer.layout && value.name === state)
        || skin.states.find(value => value.layout === layer.layout && value.name === 'default')
        || skin.states.find(value => value.layout === layer.layout)
        || skin.states.find(value => value.name === state && skin.templates[value.template])
        || skin.states.find(value => value.name === 'default' && skin.templates[value.template]);
    const templateName = layer.template || stateDefinition?.template;
    const template = templateName ? skin.templates[templateName] : undefined;

    if(!template) return;
    if(!layout.entities.some(target => template.entities.some(entity => entity.name === target.name && entity.rect))) return;

    const imageUrl = getSkinRegistryAssetUrl(template.asset);

    if(!imageUrl) return;

    const image = await getImage(imageUrl);
    const natural = boundsOf(layout.entities);
    const left = layer.left ?? (layer.right === undefined ? 0 : canvasWidth - layer.right - (layer.width ?? natural.width));
    const top = layer.top ?? (layer.bottom === undefined ? 0 : canvasHeight - layer.bottom - (layer.height ?? natural.height));
    const width = layer.width ?? Math.max(0, canvasWidth - left - (layer.right || 0));
    const height = layer.height ?? Math.max(0, canvasHeight - top - (layer.bottom || 0));
    const preserveAspect = layer.registryId.startsWith('project:');
    const aspectScale = preserveAspect && natural.width > 0 && natural.height > 0
        ? Math.min(width / natural.width, height / natural.height)
        : 1;
    const drawnWidth = preserveAspect ? natural.width * aspectScale : width;
    const drawnHeight = preserveAspect ? natural.height * aspectScale : height;
    const drawLeft = preserveAspect ? left + (width - drawnWidth) / 2 : left;
    const drawTop = preserveAspect ? top + (height - drawnHeight) / 2 : top;
    const deltaWidth = drawnWidth - natural.width;
    const deltaHeight = drawnHeight - natural.height;

    for(const target of layout.entities)
    {
        const source = template.entities.find(entity => entity.name === target.name);

        if(!source?.rect) continue;

        const [ destinationX, destinationWidth ] = preserveAspect
            ? [ target.rect[0] * aspectScale, target.rect[2] * aspectScale ]
            : transformAxis(target.rect[0], target.rect[2], target.scaleH, deltaWidth);
        const [ destinationY, destinationHeight ] = preserveAspect
            ? [ target.rect[1] * aspectScale, target.rect[3] * aspectScale ]
            : transformAxis(target.rect[1], target.rect[3], target.scaleV, deltaHeight);

        if(destinationWidth <= 0 || destinationHeight <= 0) continue;

        if(color !== 0xFFFFFF && target.colorize !== 'false')
        {
            const tinted = document.createElement('canvas');

            tinted.width = source.rect[2];
            tinted.height = source.rect[3];
            const tintedContext = tinted.getContext('2d');

            if(!tintedContext) continue;

            tintedContext.drawImage(image, source.rect[0], source.rect[1], source.rect[2], source.rect[3], 0, 0, source.rect[2], source.rect[3]);
            tint(tinted, color);
            drawEntity(context, tinted, [ 0, 0, tinted.width, tinted.height ], [ drawLeft + destinationX, drawTop + destinationY, destinationWidth, destinationHeight ], !preserveAspect && target.scaleH === 'tiled', !preserveAspect && target.scaleV === 'tiled', preserveAspect);
        }
        else
        {
            drawEntity(context, image, source.rect, [ drawLeft + destinationX, drawTop + destinationY, destinationWidth, destinationHeight ], !preserveAspect && target.scaleH === 'tiled', !preserveAspect && target.scaleV === 'tiled', preserveAspect);
        }
    }
};

const getRenderedSkin = (layers: SkinRegistryLayer[], state: HabboSkinState, color: number, width: number, height: number) =>
{
    const key = JSON.stringify([ registryRevision, width, height, color, state, layers ]);
    const cached = renderedSkinCache.get(key);

    if(cached)
    {
        renderedSkinCache.delete(key);
        renderedSkinCache.set(key, cached);

        return cached.promise;
    }

    const pixels = width * height;

    while(renderedSkinCache.size && ((renderedSkinCache.size >= MAX_RENDERED_SKIN_CACHE_SIZE) || ((renderedSkinCachePixels + pixels) > MAX_RENDERED_SKIN_CACHE_PIXELS)))
    {
        const oldestKey = renderedSkinCache.keys().next().value as string;
        const oldest = renderedSkinCache.get(oldestKey);

        if(!oldest) break;

        renderedSkinCache.delete(oldestKey);
        renderedSkinCachePixels -= oldest.pixels;
    }

    const promise = (async () =>
    {
        const buffer = document.createElement('canvas');

        buffer.width = width;
        buffer.height = height;

        const context = buffer.getContext('2d');

        if(!context) throw new Error('Canvas rendering is unavailable.');

        context.imageSmoothingEnabled = false;

        for(const layer of layers) await drawLayer(context, { state, ...layer }, width, height, color);

        return buffer;
    })();

    renderedSkinCache.set(key, { promise, pixels });
    renderedSkinCachePixels += pixels;
    promise.catch(() =>
    {
        if(renderedSkinCache.get(key)?.promise !== promise) return;

        renderedSkinCache.delete(key);
        renderedSkinCachePixels -= pixels;
    });

    return promise;
};

const isDrawableLayer = (layer: SkinRegistryLayer, fallbackState: HabboSkinState) =>
{
    if(!layer.registryId || !layer.layout) return false;

    const skin = mergedExtension().skins[layer.registryId] || registry.skins[layer.registryId];
    const layout = skin?.layouts[layer.layout];

    if(!skin || !layout?.entities.length) return false;

    const state = layer.state || fallbackState;
    const stateDefinition = skin.states.find(value => value.layout === layer.layout && value.name === state)
        || skin.states.find(value => value.layout === layer.layout && value.name === 'default')
        || skin.states.find(value => value.layout === layer.layout)
        || skin.states.find(value => value.name === state && skin.templates[value.template])
        || skin.states.find(value => value.name === 'default' && skin.templates[value.template]);
    const templateName = layer.template || stateDefinition?.template;
    const template = templateName ? skin.templates[templateName] : undefined;

    return !!template && !!getSkinRegistryAssetUrl(template.asset)
        && layout.entities.some(target => template.entities.some(entity => entity.name === target.name && entity.rect));
};

export const SkinRegistryView: FC<SkinRegistryViewProps> = props =>
{
    const { className = '', registryId, layout, state = 'default', template, color = 0xFFFFFF, layers } = props;
    const activeLayers = useMemo(() =>
    {
        const requestedLayers = layers || (registryId && layout ? [ { registryId, layout, state, template } ] : []);

        return requestedLayers.filter(layer => isDrawableLayer(layer, state));
    }, [ layers, layout, registryId, state, template ]);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useLayoutEffect(() =>
    {
        const canvas = canvasRef.current;

        if(!canvas) return;

        let renderVersion = 0;
        let requestedWidth = -1;
        let requestedHeight = -1;
        let disposed = false;
        const render = async () =>
        {
            const width = Math.round(canvas.clientWidth);
            const height = Math.round(canvas.clientHeight);

            if(!width || !height) return;
            if(width === requestedWidth && height === requestedHeight) return;

            requestedWidth = width;
            requestedHeight = height;

            const version = ++renderVersion;

            canvas.dataset.skinReady = 'false';

            const buffer = await getRenderedSkin(activeLayers, state, color, width, height);

            if(disposed || version !== renderVersion) return;

            canvas.width = width;
            canvas.height = height;

            const visibleContext = canvas.getContext('2d');

            if(!visibleContext) return;

            visibleContext.imageSmoothingEnabled = false;
            visibleContext.drawImage(buffer, 0, 0);
            canvas.dataset.skinReady = 'true';
            canvas.dispatchEvent(new CustomEvent('habbo-skin-ready', { bubbles: true }));
        };
        const observer = new ResizeObserver(render);

        observer.observe(canvas);
        render();

        return () =>
        {
            disposed = true;
            observer.disconnect();
        };
    }, [ activeLayers, color, state ]);

    if(!activeLayers.length) return null;

    const resolvedLayout = layout || activeLayers.map(layer => `${ layer.registryId }:${ layer.layout }`).join(',');

    return <canvas ref={ canvasRef } className={ `habbo-skin-view ${ className }` } data-registry-id={ registryId || (layers ? 'composite' : '') } data-layout={ resolvedLayout } aria-hidden="true" />;
};
