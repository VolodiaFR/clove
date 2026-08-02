import { FC, useLayoutEffect, useMemo, useRef } from 'react';
import { resolveCloveAsset } from '../../clove/assetCatalog';
import { getSkinRegistryAssetUrl } from './SkinRegistryView';

interface HabboBitmapViewProps
{
    assetName: string;
    assetId?: string;
    className?: string;
    alt?: string;
    stretchedX?: boolean;
    stretchedY?: boolean;
    pivotPoint?: string;
}

const imagePromises = new Map<string, Promise<HTMLImageElement>>();

const loadImage = (url: string, fallbackUrl = '') =>
{
    const key = fallbackUrl ? url + '\n' + fallbackUrl : url;
    let promise = imagePromises.get(key);

    if(promise) return promise;

    promise = new Promise((resolve, reject) =>
    {
        const image = new Image();
        let usingFallback = false;

        image.onload = () => resolve(image);
        image.onerror = error =>
        {
            if(fallbackUrl && !usingFallback)
            {
                usingFallback = true;
                image.src = fallbackUrl;
                return;
            }

            reject(error);
        };
        image.src = url;
    });
    imagePromises.set(key, promise);

    return promise;
};

const pivotAxis = (pivotPoint: string, axis: 'x' | 'y') =>
{
    const pivot = (pivotPoint || 'top_left').toLowerCase().replace(/[\s-]+/g, '_');

    if(pivot === 'center' || pivot.includes(axis === 'x' ? 'center' : 'middle')) return .5;
    if(axis === 'x' && (pivot.includes('right') || pivot === 'east')) return 1;
    if(axis === 'y' && (pivot.includes('bottom') || pivot === 'south')) return 1;

    return 0;
};

export const HabboBitmapView: FC<HabboBitmapViewProps> = props =>
{
    const { assetName, assetId = '', className = '', alt = '', stretchedX = true, stretchedY = true, pivotPoint = 'top_left' } = props;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const source = useMemo(() =>
    {
        const catalog = resolveCloveAsset(assetName, assetId);
        const directUrl = /^(?:data:|blob:|\.?\/|https?:\/\/)/.test(assetName) || /\.(?:png|gif|jpe?g|webp)(?:[?#].*)?$/i.test(assetName) ? assetName : '';

        return catalog
            ? { url: catalog.url, fallbackUrl: catalog.fallbackUrl, region: catalog.region }
            : { url: getSkinRegistryAssetUrl(assetName) || directUrl, fallbackUrl: undefined as string | undefined, region: null as [number, number, number, number] | null };
    }, [ assetId, assetName ]);

    useLayoutEffect(() =>
    {
        const canvas = canvasRef.current;

        if(!canvas || !source.url) return;

        let disposed = false;
        let version = 0;
        const render = async () =>
        {
            const renderVersion = ++version;
            const width = Math.round(canvas.clientWidth);
            const height = Math.round(canvas.clientHeight);

            if(!width || !height) return;

            const image = await loadImage(source.url, source.fallbackUrl);

            if(disposed || renderVersion !== version) return;

            const [ sourceX, sourceY, naturalWidth, naturalHeight ] = source.region || [ 0, 0, image.naturalWidth, image.naturalHeight ];
            const drawnWidth = stretchedX ? width : naturalWidth;
            const drawnHeight = stretchedY ? height : naturalHeight;
            const x = Math.round((width - drawnWidth) * pivotAxis(pivotPoint, 'x'));
            const y = Math.round((height - drawnHeight) * pivotAxis(pivotPoint, 'y'));

            canvas.width = width;
            canvas.height = height;

            const context = canvas.getContext('2d');

            if(!context) return;

            context.imageSmoothingEnabled = false;
            context.clearRect(0, 0, width, height);
            context.drawImage(image, sourceX, sourceY, naturalWidth, naturalHeight, x, y, drawnWidth, drawnHeight);
        };
        const observer = new ResizeObserver(render);

        observer.observe(canvas);
        render().catch(() => undefined);

        return () =>
        {
            disposed = true;
            observer.disconnect();
        };
    }, [ pivotPoint, source, stretchedX, stretchedY ]);

    if(!source.url) return null;

    if(!source.region && stretchedX && stretchedY && (/\.gif(?:[?#].*)?$/i.test(source.url) || /^data:image\/gif[;,]/i.test(source.url))) return <img className={ className } src={ source.url } alt={ alt } data-asset-uri={ assetName } style={ { objectFit: 'fill' } } onError={ event =>
    {
        if(source.fallbackUrl && event.currentTarget.src !== source.fallbackUrl) event.currentTarget.src = source.fallbackUrl;
    } } />;

    return <canvas ref={ canvasRef } className={ className } role={ alt ? 'img' : undefined } aria-label={ alt || undefined } data-asset-uri={ assetName } />;
};
