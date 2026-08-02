import type { RenderOptions, TruffleBuffer } from 'truffle-text';
import { getTruffle } from 'truffle-text/react';
import { FC, useLayoutEffect, useMemo, useRef } from 'react';
import { resolveHabboXmlTextStyle } from './HabboTruffleTextFormat';

export type TruffleTextFormat = string | Record<string, unknown>;
const failedTruffleFormats = new Set<string>();
const truffleBufferCache = new Map<string, TruffleBuffer>();
const MAX_TRUFFLE_BUFFER_CACHE_ENTRIES = 1000;

const cacheBuffer = (key: string, buffer: TruffleBuffer) =>
{
    truffleBufferCache.set(key, buffer);

    if(truffleBufferCache.size > MAX_TRUFFLE_BUFFER_CACHE_ENTRIES)
    {
        const oldestKey = truffleBufferCache.keys().next().value;

        if(oldestKey !== undefined) truffleBufferCache.delete(oldestKey);
    }
};

const withVolterUnderlineGap = (format: TruffleTextFormat): TruffleTextFormat =>
{
    if((typeof format === 'string') || !format.underline || !String(format.fontFamily || '').startsWith('Volter')) return format;

    const minimumOffset = 1;
    const currentOffset = Number(format.underlineOffset || 0);

    return currentOffset >= minimumOffset ? format : { ...format, underlineOffset: minimumOffset };
};

interface TruffleTextViewProps
{
    text?: string | number;
    format: TruffleTextFormat;
    className?: string;
    color?: number;
    wordWrap?: boolean;
    width?: number;
    maxHeight?: number;
    ellipsis?: boolean;
}

export const TruffleTextView: FC<TruffleTextViewProps> = props =>
{
    const { text = '', format, className = '', color, wordWrap = false, width, maxHeight, ellipsis = false } = props;
    const value = String(text ?? '');
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const buffer = useMemo<TruffleBuffer | null>(() =>
    {
        const safeWidth = typeof width === 'number' && Number.isFinite(width) && width > 0 ? Math.min(16384, Math.round(width)) : undefined;
        const safeMaxHeight = typeof maxHeight === 'number' && Number.isFinite(maxHeight) && maxHeight > 0 ? Math.min(16384, Math.round(maxHeight)) : undefined;
        const options: RenderOptions = { wordWrap, width: safeWidth };

        if(color !== undefined) options.color = color;

        const truffle = getTruffle();

        if(!truffle) return null;

        const resolvedFormat = withVolterUnderlineGap(resolveHabboXmlTextStyle(format));
        const formatKey = typeof resolvedFormat === 'string' ? resolvedFormat : JSON.stringify(resolvedFormat);
        const cacheKey = JSON.stringify([ value, formatKey, color, wordWrap, safeWidth, safeMaxHeight, ellipsis ]);
        const cachedBuffer = truffleBufferCache.get(cacheKey);

        if(cachedBuffer)
        {
            truffleBufferCache.delete(cacheKey);
            truffleBufferCache.set(cacheKey, cachedBuffer);
            return cachedBuffer;
        }

        const render = (candidate: string) =>
        {
            try
            {
                const result = truffle.renderToBuffer(candidate, resolvedFormat, options);
                const pixels = result.width * result.height;

                if(!Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width < 1 || result.height < 1 || result.width > 16384 || result.height > 16384 || pixels > 16777216 || !result.data || result.data.length !== pixels * 4) return null;

                return result;
            }
            catch(error)
            {
                const failureKey = typeof format === 'string' ? format : JSON.stringify(format);

                if(!failedTruffleFormats.has(failureKey))
                {
                    failedTruffleFormats.add(failureKey);
                    console.error('[TruffleTextView] Truffle failed to render a text format.', { error, format });
                }

                return null;
            }
        };

        let buffer = render(value);

        if(!buffer || !ellipsis || !safeMaxHeight || (buffer.height <= safeMaxHeight))
        {
            if(buffer) cacheBuffer(cacheKey, buffer);
            return buffer;
        }

        const characters = Array.from(value);
        let low = 0;
        let high = characters.length;
        let best = '...';

        while(low <= high)
        {
            const middle = Math.floor((low + high) / 2);
            const candidate = `${ characters.slice(0, middle).join('').trimEnd() }...`;
            const candidateBuffer = render(candidate);

            if(candidateBuffer && candidateBuffer.height <= safeMaxHeight)
            {
                best = candidate;
                low = middle + 1;
            }
            else
            {
                high = middle - 1;
            }
        }

        buffer = render(best);

        if(buffer) cacheBuffer(cacheKey, buffer);

        return buffer;
    }, [ color, ellipsis, format, maxHeight, value, width, wordWrap ]);

    useLayoutEffect(() =>
    {
        const canvas = canvasRef.current;

        if(!buffer || !canvas) return;

        const context = canvas.getContext('2d');

        if(!context) return;

        try
        {
            context.putImageData(new ImageData(new Uint8ClampedArray(buffer.data), buffer.width, buffer.height), 0, 0);
        }
        catch
        {
            context.clearRect(0, 0, canvas.width, canvas.height);
        }
    }, [ buffer ]);

    if(!buffer) return null;

    return <canvas ref={ canvasRef } width={ buffer.width } height={ buffer.height } className={ className } role="img" aria-label={ value } />;
}
