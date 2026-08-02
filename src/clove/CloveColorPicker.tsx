import { FC, PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { VOLTER_REGULAR } from '../truffle';
import { HabboInput, HabboText } from './HabboUi';

interface HsvColor
{
    h: number;
    s: number;
    v: number;
}

interface RgbColor
{
    r: number;
    g: number;
    b: number;
}

interface CloveColorPickerProps
{
    value: string;
    label?: string;
    onPreview: (value: string) => void;
    onCommit: (value: string) => void;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const normalizeCloveColor = (value: string, fallback = '0x000000') =>
{
    const trimmed = String(value || '').trim();
    const parsed = /^#[0-9a-f]{6}$/i.test(trimmed) ? Number.parseInt(trimmed.slice(1), 16)
        : /^0x[0-9a-f]{1,8}$/i.test(trimmed) ? Number.parseInt(trimmed.slice(2), 16)
            : /^\d+$/.test(trimmed) ? Number(trimmed)
                : Number.NaN;

    if(!Number.isFinite(parsed)) return fallback;

    return `0x${ (Math.round(parsed) & 0xFFFFFF).toString(16).padStart(6, '0') }`;
};

const colorNumber = (value: string) => Number(normalizeCloveColor(value)) & 0xFFFFFF;
const numberToRgb = (value: number): RgbColor => ({ r: (value >> 16) & 0xFF, g: (value >> 8) & 0xFF, b: value & 0xFF });
const rgbToValue = ({ r, g, b }: RgbColor) => `0x${ ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0') }`;

const rgbToHsv = ({ r, g, b }: RgbColor): HsvColor =>
{
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 0;

    if(delta)
    {
        if(max === red) hue = ((green - blue) / delta) % 6;
        else if(max === green) hue = ((blue - red) / delta) + 2;
        else hue = ((red - green) / delta) + 4;
        hue = ((hue * 60) + 360) % 360;
    }

    return { h: hue, s: max ? delta / max : 0, v: max };
};

const hsvToRgb = ({ h, s, v }: HsvColor): RgbColor =>
{
    const chroma = v * s;
    const segment = ((h % 360) + 360) % 360 / 60;
    const intermediate = chroma * (1 - Math.abs((segment % 2) - 1));
    const match = v - chroma;
    let channels: [number, number, number] = [ 0, 0, 0 ];

    if(segment < 1) channels = [ chroma, intermediate, 0 ];
    else if(segment < 2) channels = [ intermediate, chroma, 0 ];
    else if(segment < 3) channels = [ 0, chroma, intermediate ];
    else if(segment < 4) channels = [ 0, intermediate, chroma ];
    else if(segment < 5) channels = [ intermediate, 0, chroma ];
    else channels = [ chroma, 0, intermediate ];

    return {
        r: Math.round((channels[0] + match) * 255),
        g: Math.round((channels[1] + match) * 255),
        b: Math.round((channels[2] + match) * 255)
    };
};

export const CloveColorPicker: FC<CloveColorPickerProps> = ({ value, label = 'Choose color', onPreview, onCommit }) =>
{
    const [ open, setOpen ] = useState(false);
    const [ hsv, setHsv ] = useState(() => rgbToHsv(numberToRgb(colorNumber(value))));
    const [ panelPosition, setPanelPosition ] = useState({ left: 0, top: 0 });
    const [ hexDraft, setHexDraft ] = useState(() => `#${ normalizeCloveColor(value).slice(2).toUpperCase() }`);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const pendingRef = useRef(normalizeCloveColor(value));
    const timerRef = useRef<number>();
    const lastCommitRef = useRef(0);
    const onPreviewRef = useRef(onPreview);
    const onCommitRef = useRef(onCommit);
    onPreviewRef.current = onPreview;
    onCommitRef.current = onCommit;

    const rgb = useMemo(() => hsvToRgb(hsv), [ hsv ]);
    const currentValue = useMemo(() => rgbToValue(rgb), [ rgb ]);
    const currentHex = `#${ currentValue.slice(2).toUpperCase() }`;

    useEffect(() =>
    {
        const normalized = normalizeCloveColor(value);

        if(normalized === pendingRef.current) return;
        pendingRef.current = normalized;
        setHsv(rgbToHsv(numberToRgb(colorNumber(normalized))));
        setHexDraft(`#${ normalized.slice(2).toUpperCase() }`);
    }, [ value ]);

    useEffect(() => () =>
    {
        if(timerRef.current) window.clearTimeout(timerRef.current);
    }, []);

    const commitPending = useCallback(() =>
    {
        if(timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
        lastCommitRef.current = performance.now();
        onCommitRef.current(pendingRef.current);
    }, []);

    const publish = useCallback((next: HsvColor, final = false) =>
    {
        const nextValue = rgbToValue(hsvToRgb(next));

        setHsv(next);
        pendingRef.current = nextValue;
        setHexDraft(`#${ nextValue.slice(2).toUpperCase() }`);
        onPreviewRef.current(nextValue);

        if(final)
        {
            commitPending();
            return;
        }

        const elapsed = performance.now() - lastCommitRef.current;

        if(elapsed >= 90) commitPending();
        else if(!timerRef.current) timerRef.current = window.setTimeout(commitPending, 90 - elapsed);
    }, [ commitPending ]);

    const updatePanelPosition = useCallback(() =>
    {
        const bounds = buttonRef.current?.getBoundingClientRect();

        if(!bounds) return;

        const width = 236;
        const height = 169;
        setPanelPosition({
            left: Math.round(clamp(bounds.left, 6, Math.max(6, window.innerWidth - width - 6))),
            top: Math.round(bounds.bottom + height + 6 <= window.innerHeight ? bounds.bottom + 4 : Math.max(6, bounds.top - height - 4))
        });
    }, []);

    useLayoutEffect(() =>
    {
        if(!open) return;

        updatePanelPosition();
        const closeFromOutside = (event: MouseEvent) =>
        {
            const target = event.target as Node;

            if(!panelRef.current?.contains(target) && !buttonRef.current?.contains(target))
            {
                commitPending();
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', closeFromOutside);
        window.addEventListener('resize', updatePanelPosition);
        window.addEventListener('scroll', updatePanelPosition, true);

        return () =>
        {
            document.removeEventListener('mousedown', closeFromOutside);
            window.removeEventListener('resize', updatePanelPosition);
            window.removeEventListener('scroll', updatePanelPosition, true);
        };
    }, [ commitPending, open, updatePanelPosition ]);

    const updatePlane = (event: ReactPointerEvent<HTMLDivElement>, final = false) =>
    {
        const bounds = event.currentTarget.getBoundingClientRect();
        publish({ ...hsv, s: clamp((event.clientX - bounds.left) / bounds.width), v: 1 - clamp((event.clientY - bounds.top) / bounds.height) }, final);
    };
    const updateHue = (event: ReactPointerEvent<HTMLDivElement>, final = false) =>
    {
        const bounds = event.currentTarget.getBoundingClientRect();
        publish({ ...hsv, h: clamp((event.clientX - bounds.left) / bounds.width) * 359.999 }, final);
    };
    const beginDrag = (update: (event: ReactPointerEvent<HTMLDivElement>, final?: boolean) => void) => (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        if(event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
    };
    const moveDrag = (update: (event: ReactPointerEvent<HTMLDivElement>, final?: boolean) => void) => (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        if(event.currentTarget.hasPointerCapture(event.pointerId)) update(event);
    };
    const finishDrag = (update: (event: ReactPointerEvent<HTMLDivElement>, final?: boolean) => void) => (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        if(!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        update(event, true);
        event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const commitHexDraft = () =>
    {
        const normalized = normalizeCloveColor(hexDraft, currentValue);
        const next = rgbToHsv(numberToRgb(colorNumber(normalized)));

        setHexDraft(`#${ normalized.slice(2).toUpperCase() }`);
        publish(next, true);
    };

    const panel = open && createPortal(<div ref={ panelRef } className="clove-color-picker-panel" style={ panelPosition } role="dialog" aria-label={ label }>
        <div className="clove-color-plane" style={ { backgroundColor: `hsl(${ hsv.h }, 100%, 50%)` } } onPointerDown={ beginDrag(updatePlane) } onPointerMove={ moveDrag(updatePlane) } onPointerUp={ finishDrag(updatePlane) } onPointerCancel={ finishDrag(updatePlane) }>
            <span style={ { left: `${ hsv.s * 100 }%`, top: `${ (1 - hsv.v) * 100 }%`, backgroundColor: currentHex } } />
        </div>
        <div className="clove-color-hue" onPointerDown={ beginDrag(updateHue) } onPointerMove={ moveDrag(updateHue) } onPointerUp={ finishDrag(updateHue) } onPointerCancel={ finishDrag(updateHue) }><span style={ { left: `${ hsv.h / 360 * 100 }%` } } /></div>
        <div className="clove-color-picker-values">
            <span className="clove-color-picker-preview" style={ { backgroundColor: currentHex } } />
            <HabboInput aria-label="Hex color" value={ hexDraft } maxLength={ 7 } onChange={ event => setHexDraft(event.target.value) } onBlur={ commitHexDraft } onKeyDown={ event =>
            {
                if(event.key === 'Enter') event.currentTarget.blur();
                if(event.key === 'Escape')
                {
                    setHexDraft(currentHex);
                    event.currentTarget.blur();
                }
            } } />
            <HabboText format={ VOLTER_REGULAR }>{ `${ rgb.r }, ${ rgb.g }, ${ rgb.b }` }</HabboText>
        </div>
    </div>, document.body);

    return <>
        <button ref={ buttonRef } className="clove-color-swatch" type="button" aria-label={ label } aria-haspopup="dialog" aria-expanded={ open } title={ `${ label }: ${ currentHex }` } onClick={ () => setOpen(current => !current) }><span style={ { backgroundColor: currentHex } } /></button>
        { panel }
    </>;
};
