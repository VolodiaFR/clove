import { ChangeEvent, CSSProperties, FC, FocusEvent, KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getTruffle } from 'truffle-text/react';
import { TruffleTextFormat } from './TruffleTextView';

interface TruffleEditableTextViewProps
{
    value: string;
    onChange: (value: string) => void;
    className: string;
    format: TruffleTextFormat;
    color?: number;
    maxLength?: number;
    multiline?: boolean;
    renderWidth?: number;
    autoFocus?: boolean;
    inputMode?: 'text' | 'numeric';
    onBlur?: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

interface TruffleCharacterBounds
{
    x: number;
    y: number;
    width: number;
    height: number;
    right: number;
}

interface TruffleEditableCanvasProps
{
    value: string;
    format: TruffleTextFormat;
    color: number;
    multiline: boolean;
    renderWidth?: number;
    focused: boolean;
    selectionStart: number;
    selectionEnd: number;
    caretPosition: number;
    caretColor?: string;
}

export const TruffleEditableCanvas: FC<TruffleEditableCanvasProps> = props =>
{
    const { value, format, color, multiline, renderWidth, focused, selectionStart, selectionEnd, caretPosition, caretColor = '#ffffff' } = props;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendered = useMemo(() =>
    {
        const truffle = getTruffle();

        if(!truffle) return null;

        const buffer = truffle.renderToBuffer(value || ' ', format, { color, wordWrap: multiline, width: renderWidth });
        const bounds = buffer.layout.charBounds as TruffleCharacterBounds[];
        const safeCaret = Math.max(0, Math.min(caretPosition, value.length));
        const safeStart = Math.max(0, Math.min(selectionStart, value.length));
        const safeEnd = Math.max(safeStart, Math.min(selectionEnd, value.length));
        let caretBound: TruffleCharacterBounds | undefined = bounds[safeCaret];
        let caretX = caretBound?.x ?? 2;

        if(!caretBound && safeCaret)
        {
            for(let index = safeCaret - 1; index >= 0; index--)
            {
                if(!bounds[index]) continue;

                caretBound = bounds[index]!;
                caretX = caretBound.right;
                break;
            }
        }

        if(!caretBound)
        {
            caretBound = bounds.find(bound => !!bound);
            caretX = caretBound?.x ?? 2;
        }

        const fallbackHeight = Number(buffer.layout.metrics.height) || 12;
        const caretHeight = Math.max(1, Math.round((caretBound?.height ?? fallbackHeight) - 2));

        return {
            buffer,
            caretX: Math.round(caretX),
            caretY: Math.round(caretBound?.y ?? 2) + 1,
            caretHeight,
            selectionBounds: bounds.slice(safeStart, safeEnd).filter(bound => !!bound)
        };
    }, [ caretPosition, color, format, multiline, renderWidth, selectionEnd, selectionStart, value ]);

    useLayoutEffect(() =>
    {
        const canvas = canvasRef.current;

        if(!canvas || !rendered) return;

        const context = canvas.getContext('2d');

        if(!context) return;
        const imageData = new ImageData(new Uint8ClampedArray(rendered.buffer.data), rendered.buffer.width, rendered.buffer.height);
        const hasSelection = (selectionStart !== selectionEnd);
        let caretVisible = true;

        const draw = () =>
        {
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.putImageData(imageData, 0, 0);

            if(focused && hasSelection)
            {
                context.fillStyle = 'rgba(80, 130, 170, .65)';
                rendered.selectionBounds.forEach(bound => context.fillRect(Math.round(bound.x), Math.round(bound.y), Math.max(1, Math.round(bound.width)), Math.max(1, Math.round(bound.height))));
            }

            if(focused && !hasSelection && caretVisible)
            {
                context.fillStyle = caretColor;
                context.fillRect(rendered.caretX, rendered.caretY, 1, rendered.caretHeight);
            }
        }

        draw();

        if(!focused || hasSelection) return;

        const interval = window.setInterval(() =>
        {
            caretVisible = !caretVisible;
            draw();
        }, 500);

        return () => window.clearInterval(interval);
    }, [ caretColor, focused, rendered, selectionEnd, selectionStart ]);

    if(!rendered) return null;

    return <canvas ref={ canvasRef } width={ rendered.buffer.width } height={ rendered.buffer.height } aria-hidden="true" />;
}

export const TruffleEditableTextView: FC<TruffleEditableTextViewProps> = props =>
{
    const { value, onChange, className, format, color = 0xFFFFFF, maxLength, multiline = false, renderWidth, autoFocus = false, inputMode = 'text', onBlur, onKeyDown } = props;
    const resolvedFormat = useMemo(() =>
    {
        const truffle = getTruffle();

        if(!truffle) return format;

        return { ...truffle.resolveStyle(format) };
    }, [ format ]);
    const [ scrollOffset, setScrollOffset ] = useState({ left: 0, top: 0 });
    const editableStyle = useMemo(() =>
    {
        if((typeof resolvedFormat !== 'object') || !resolvedFormat) return undefined;

        const size = (typeof resolvedFormat.size === 'number') ? resolvedFormat.size : 10;

        return {
            '--truffle-input-font-family': (typeof resolvedFormat.fontFamily === 'string') ? resolvedFormat.fontFamily : 'Ubuntu',
            '--truffle-input-font-size': `${ size }px`,
            '--truffle-input-font-style': resolvedFormat.italic ? 'italic' : 'normal',
            '--truffle-input-font-weight': resolvedFormat.bold ? '700' : '400',
            '--truffle-input-line-height': `${ size + 2 }px`,
            '--truffle-input-scroll-x': `${ -scrollOffset.left }px`,
            '--truffle-input-scroll-y': `${ -scrollOffset.top }px`
        } as CSSProperties;
    }, [ resolvedFormat, scrollOffset ]);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    const [ focused, setFocused ] = useState(false);
    const [ selection, setSelection ] = useState({ start: value.length, end: value.length, caret: value.length });
    const updateSelection = useCallback(() =>
    {
        const input = inputRef.current;

        if(!input) return;

        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? start;

        setSelection({ start, end, caret: input.selectionDirection === 'backward' ? start : end });
        setScrollOffset({ left: input.scrollLeft, top: input.scrollTop });
    }, []);
    const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    {
        const input = event.currentTarget;

        onChange(input.value);
        setSelection({
            start: input.selectionStart ?? input.value.length,
            end: input.selectionEnd ?? input.value.length,
            caret: input.selectionDirection === 'backward' ? (input.selectionStart ?? 0) : (input.selectionEnd ?? input.value.length)
        });
        window.requestAnimationFrame(updateSelection);
    }
    const handleFocus = () =>
    {
        setFocused(true);
        window.requestAnimationFrame(updateSelection);
    }
    const handleBlur = (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    {
        setFocused(false);
        onBlur?.(event);
    };
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    {
        onKeyDown?.(event);
        window.requestAnimationFrame(updateSelection);
    };
    const setInputRef = (element: HTMLInputElement | HTMLTextAreaElement | null) =>
    {
        inputRef.current = element;
    }

    useEffect(() =>
    {
        setSelection(current =>
        {
            const start = Math.min(current.start, value.length);
            const end = Math.min(current.end, value.length);

            return { start, end, caret: Math.min(current.caret, value.length) };
        });
    }, [ value ]);

    return (
        <div className={ `truffle-editable ${ className }` } style={ editableStyle }>
            <div className="truffle-editable-render" aria-hidden="true">
                <TruffleEditableCanvas value={ value } format={ resolvedFormat } color={ color } multiline={ multiline } renderWidth={ renderWidth } focused={ focused } selectionStart={ selection.start } selectionEnd={ selection.end } caretPosition={ selection.caret } />
            </div>
            { multiline
                ? <textarea ref={ setInputRef } autoFocus={ autoFocus } value={ value } maxLength={ maxLength } onChange={ handleChange } onFocus={ handleFocus } onBlur={ handleBlur } onSelect={ updateSelection } onKeyDown={ handleKeyDown } onKeyUp={ updateSelection } onMouseUp={ updateSelection } onScroll={ updateSelection } />
                : <input ref={ setInputRef } autoFocus={ autoFocus } type="text" inputMode={ inputMode } value={ value } maxLength={ maxLength } onChange={ handleChange } onFocus={ handleFocus } onBlur={ handleBlur } onSelect={ updateSelection } onKeyDown={ handleKeyDown } onKeyUp={ updateSelection } onMouseUp={ updateSelection } onScroll={ updateSelection } /> }
        </div>
    );
}
