import { AriaRole, ButtonHTMLAttributes, FC, InputHTMLAttributes, PointerEvent as ReactPointerEvent, ReactNode, RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HABBO_STYLES } from 'truffle-text';
import { SkinRegistryView } from '../common/habbo';
import { HabboSkinView, isCloveTruffleReady, preloadCloveTruffle, TruffleTextFormat, TruffleTextView, VOLTER_REGULAR } from '../truffle';
import { TruffleEditableCanvas } from '../truffle/TruffleEditableTextView';

const cloveTrufflePromise = preloadCloveTruffle();

export const HabboText: FC<{ children: string | number; className?: string; format?: TruffleTextFormat; color?: number }> = ({ children, className = '', format = HABBO_STYLES.u_regular, color }) =>
{
    const [ ready, setReady ] = useState(isCloveTruffleReady);

    useEffect(() =>
    {
        cloveTrufflePromise.then(() => setReady(true)).catch(() => undefined);
    }, []);

    if(!ready) return null;

    return <TruffleTextView className={ className } text={ children } format={ format } color={ color } />;
};

export const HabboButton: FC<Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { label: string }> = ({ label, className = '', disabled, onMouseEnter, onMouseLeave, onMouseDown, onMouseUp, style, ...props }) =>
{
    const [ state, setState ] = useState<'default' | 'hovering' | 'pressed'>('default');

    return <button { ...props } style={ { minWidth: Math.max(72, (label.length * 7) + 28), ...style } } className={ `clove-habbo-button ${ className }` } aria-label={ label } disabled={ disabled } onMouseEnter={ event =>
    {
        if(!disabled) setState('hovering');
        onMouseEnter?.(event);
    } } onMouseLeave={ event =>
    {
        setState('default');
        onMouseLeave?.(event);
    } } onMouseDown={ event =>
    {
        if(!disabled) setState('pressed');
        onMouseDown?.(event);
    } } onMouseUp={ event =>
    {
        if(!disabled) setState('hovering');
        onMouseUp?.(event);
    } }>
        <SkinRegistryView registryId="habbo_skin_button_shiny_default" layout="button_shiny" state={ disabled ? 'disabled' : state } />
        <span><HabboText format={ HABBO_STYLES.u_bold }>{ label }</HabboText></span>
    </button>;
};

export const HabboChromeButton: FC<ButtonHTMLAttributes<HTMLButtonElement> & { label: string; registryId?: string; layout?: string; imageUrl?: string }> = ({ label, registryId, layout, imageUrl, className = '', disabled, onMouseEnter, onMouseLeave, onMouseDown, onMouseUp, ...props }) =>
{
    const [ state, setState ] = useState<'default' | 'hovering' | 'pressed'>('default');

    return <button { ...props } className={ `clove-window-control ${ className }` } type="button" aria-label={ label } title={ label } data-state={ state } disabled={ disabled } onMouseEnter={ event =>
    {
        if(!disabled) setState('hovering');
        onMouseEnter?.(event);
    } } onMouseLeave={ event =>
    {
        setState('default');
        onMouseLeave?.(event);
    } } onMouseDown={ event =>
    {
        if(!disabled) setState('pressed');
        onMouseDown?.(event);
    } } onMouseUp={ event =>
    {
        if(!disabled) setState('hovering');
        onMouseUp?.(event);
    } }>
        { registryId && layout && <SkinRegistryView registryId={ registryId } layout={ layout } state={ state } /> }
        { imageUrl && <img className={ `state-${ state }` } src={ imageUrl } alt="" draggable={ false } /> }
    </button>;
};

export const HabboCheckbox: FC<Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string }> = ({ label, className = '', checked, disabled, ...props }) =>
    <label className={ `clove-habbo-checkbox ${ className } ${ disabled ? 'is-disabled' : '' }` }>
        <span className="clove-habbo-checkbox-box">
            <SkinRegistryView registryId="illumina_light_skin_checkbox_basic" layout="button_checkbox" state={ checked ? 'selected' : 'default' } />
            <input { ...props } type="checkbox" checked={ checked } disabled={ disabled } />
        </span>
        <HabboText>{ label }</HabboText>
    </label>;

export const HabboInput: FC<InputHTMLAttributes<HTMLInputElement> & { caretAtEnd?: boolean }> = ({ className = '', value, defaultValue, placeholder, caretAtEnd = false, onFocus, onBlur, onSelect, onKeyDown, onKeyUp, onMouseUp, ...props }) =>
{
    const [ focused, setFocused ] = useState(false);
    const [ textReady, setTextReady ] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const displayValue = String(value ?? defaultValue ?? '');
    const displayText = displayValue || (!focused ? placeholder || '' : '');
    const [ selection, setSelection ] = useState({ start: 0, end: 0, caret: 0 });
    const moveCaretToEnd = useCallback((input: HTMLInputElement) =>
    {
        const end = input.value.length;

        try
        {
            input.setSelectionRange(end, end);
        }
        catch
        {
            return;
        }
        setSelection({ start: end, end, caret: end });
    }, []);
    const updateSelection = useCallback(() =>
    {
        const input = inputRef.current;

        if(!input) return;

        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? start;

        setSelection({ start, end, caret: input.selectionDirection === 'backward' ? start : end });
    }, []);

    useEffect(() =>
    {
        cloveTrufflePromise.then(() => setTextReady(true)).catch(() => undefined);
    }, []);

    useEffect(() =>
    {
        setSelection(current => ({ start: Math.min(current.start, displayValue.length), end: Math.min(current.end, displayValue.length), caret: Math.min(current.caret, displayValue.length) }));
    }, [ displayValue.length ]);

    return <span className={ `clove-habbo-input ${ className } ${ focused ? 'is-focused' : '' } ${ !displayValue && !focused ? 'is-placeholder' : '' }` } onMouseDown={ event =>
    {
        if(event.button !== 0 || !inputRef.current) return;

        if(caretAtEnd)
        {
            event.preventDefault();
            inputRef.current.focus();
            moveCaretToEnd(inputRef.current);
        }
        else if(event.target !== inputRef.current) inputRef.current.focus();
    } }>
        <HabboSkinView skin="border-white" />
        <span className="clove-habbo-input-text">{ textReady && <TruffleEditableCanvas value={ displayText } format={ VOLTER_REGULAR } color={ !displayValue && !focused ? 0x777777 : 0x000000 } multiline={ false } focused={ focused } selectionStart={ selection.start } selectionEnd={ selection.end } caretPosition={ selection.caret } caretColor="#000000" /> }</span>
        <input ref={ inputRef } { ...props } value={ value } defaultValue={ defaultValue } placeholder={ placeholder } onFocus={ event =>
        {
            setFocused(true);
            if(caretAtEnd) moveCaretToEnd(event.currentTarget);
            else window.requestAnimationFrame(updateSelection);
            onFocus?.(event);
        } } onBlur={ event =>
        {
            setFocused(false);
            onBlur?.(event);
        } } onSelect={ event =>
        {
            updateSelection();
            onSelect?.(event);
        } } onKeyDown={ event =>
        {
            onKeyDown?.(event);
            window.requestAnimationFrame(updateSelection);
        } } onKeyUp={ event =>
        {
            updateSelection();
            onKeyUp?.(event);
        } } onMouseUp={ event =>
        {
            if(caretAtEnd) moveCaretToEnd(event.currentTarget);
            else updateSelection();
            onMouseUp?.(event);
        } } />
    </span>;
};

export const HabboScrollArea: FC<{ className?: string; children: ReactNode; viewportRef?: RefObject<HTMLDivElement> }> = ({ className = '', children, viewportRef: externalViewportRef }) =>
{
    const internalViewportRef = useRef<HTMLDivElement>(null);
    const viewportRef = externalViewportRef || internalViewportRef;
    const contentRef = useRef<HTMLDivElement>(null);
    const [ metrics, setMetrics ] = useState({ clientHeight: 0, scrollHeight: 0, scrollTop: 0, clientWidth: 0, scrollWidth: 0, scrollLeft: 0 });
    const [ thumbState, setThumbState ] = useState<'default' | 'active' | 'pressed'>('default');
    const [ horizontalThumbState, setHorizontalThumbState ] = useState<'default' | 'active' | 'pressed'>('default');
    const update = useCallback(() =>
    {
        const viewport = viewportRef.current;

        if(viewport) setMetrics({ clientHeight: viewport.clientHeight, scrollHeight: viewport.scrollHeight, scrollTop: viewport.scrollTop, clientWidth: viewport.clientWidth, scrollWidth: viewport.scrollWidth, scrollLeft: viewport.scrollLeft });
    }, []);

    useLayoutEffect(() =>
    {
        const viewport = viewportRef.current;
        const content = contentRef.current;

        if(!viewport || !content) return;

        const observer = new ResizeObserver(update);

        observer.observe(viewport);
        observer.observe(content);
        viewport.addEventListener('scroll', update);
        update();

        return () =>
        {
            observer.disconnect();
            viewport.removeEventListener('scroll', update);
        };
    }, [ update ]);

    const hasOverflow = metrics.scrollHeight > metrics.clientHeight + 1;
    const hasHorizontalOverflow = metrics.scrollWidth > metrics.clientWidth + 1;
    const trackHeight = Math.max(0, metrics.clientHeight - 32);
    const thumbHeight = hasOverflow ? Math.max(12, Math.floor(trackHeight * metrics.clientHeight / metrics.scrollHeight)) : trackHeight;
    const travel = Math.max(0, trackHeight - thumbHeight);
    const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
    const thumbTop = maxScroll ? Math.round(travel * metrics.scrollTop / maxScroll) : 0;
    const horizontalTrackWidth = Math.max(0, metrics.clientWidth - 32);
    const horizontalThumbWidth = hasHorizontalOverflow ? Math.max(12, Math.floor(horizontalTrackWidth * metrics.clientWidth / metrics.scrollWidth)) : horizontalTrackWidth;
    const horizontalTravel = Math.max(0, horizontalTrackWidth - horizontalThumbWidth);
    const horizontalMaxScroll = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
    const thumbLeft = horizontalMaxScroll ? Math.round(horizontalTravel * metrics.scrollLeft / horizontalMaxScroll) : 0;
    const beginThumbDrag = (event: ReactPointerEvent<HTMLButtonElement>) =>
    {
        event.preventDefault();
        const target = event.currentTarget;
        const startY = event.clientY;
        const startScrollTop = viewportRef.current?.scrollTop || 0;

        setThumbState('pressed');
        target.setPointerCapture(event.pointerId);

        const move = (moveEvent: PointerEvent) =>
        {
            if(viewportRef.current && travel) viewportRef.current.scrollTop = startScrollTop + ((moveEvent.clientY - startY) * maxScroll / travel);
        };
        const end = () =>
        {
            setThumbState('active');
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', end);
            target.removeEventListener('pointercancel', end);
        };

        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', end);
        target.addEventListener('pointercancel', end);
    };
    const beginHorizontalThumbDrag = (event: ReactPointerEvent<HTMLButtonElement>) =>
    {
        event.preventDefault();
        const target = event.currentTarget;
        const startX = event.clientX;
        const startScrollLeft = viewportRef.current?.scrollLeft || 0;

        setHorizontalThumbState('pressed');
        target.setPointerCapture(event.pointerId);

        const move = (moveEvent: PointerEvent) =>
        {
            if(viewportRef.current && horizontalTravel) viewportRef.current.scrollLeft = startScrollLeft + ((moveEvent.clientX - startX) * horizontalMaxScroll / horizontalTravel);
        };
        const end = () =>
        {
            setHorizontalThumbState('active');
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', end);
            target.removeEventListener('pointercancel', end);
        };

        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', end);
        target.addEventListener('pointercancel', end);
    };

    return <div className={ `clove-scroll-area ${ hasOverflow ? 'has-overflow' : '' } ${ hasHorizontalOverflow ? 'has-horizontal-overflow' : '' } ${ className }` }>
        <div ref={ viewportRef } className="clove-scroll-viewport"><div ref={ contentRef } className="clove-scroll-content">{ children }</div></div>
        { hasOverflow && <div className="clove-scrollbar clove-scrollbar-vertical" aria-hidden="true">
            <button className="clove-scroll-up" type="button" onClick={ () => viewportRef.current?.scrollBy({ top: -32 }) }><SkinRegistryView registryId="habbo_skin_scrollbar" layout="scrollbar_button_up" /></button>
            <button className="clove-scroll-track" type="button" onClick={ event =>
            {
                const clicked = event.clientY - event.currentTarget.getBoundingClientRect().top;

                viewportRef.current?.scrollBy({ top: clicked < thumbTop ? -metrics.clientHeight : metrics.clientHeight });
            } }><SkinRegistryView registryId="habbo_skin_scrollbar" layout="scrollbar_track_vertical" /></button>
            <button className="clove-scroll-thumb" type="button" style={ { top: 16 + thumbTop, height: thumbHeight } } onPointerEnter={ () => setThumbState('active') } onPointerLeave={ () => setThumbState('default') } onPointerDown={ beginThumbDrag }><SkinRegistryView registryId="habbo_skin_scrollbar" layout="scrollbar_lift_vertical" state={ thumbState } /></button>
            <button className="clove-scroll-down" type="button" onClick={ () => viewportRef.current?.scrollBy({ top: 32 }) }><SkinRegistryView registryId="habbo_skin_scrollbar" layout="scrollbar_button_down" /></button>
        </div> }
        { hasHorizontalOverflow && <div className="clove-scrollbar-horizontal" aria-hidden="true">
            <button className="clove-scroll-left" type="button" onClick={ () => viewportRef.current?.scrollBy({ left: -32 }) }><SkinRegistryView registryId="habbo_skin_scrollbar" layout="scrollbar_button_left" /></button>
            <button className="clove-scroll-track-horizontal" type="button" onClick={ event =>
            {
                const clicked = event.clientX - event.currentTarget.getBoundingClientRect().left;

                viewportRef.current?.scrollBy({ left: clicked < thumbLeft ? -metrics.clientWidth : metrics.clientWidth });
            } }><SkinRegistryView registryId="habbo_skin_scrollbar" layout="scrollbar_track_horizontal" /></button>
            <button className="clove-scroll-thumb-horizontal" type="button" style={ { left: 16 + thumbLeft, width: horizontalThumbWidth } } onPointerEnter={ () => setHorizontalThumbState('active') } onPointerLeave={ () => setHorizontalThumbState('default') } onPointerDown={ beginHorizontalThumbDrag }><SkinRegistryView registryId="habbo_skin_scrollbar" layout="scrollbar_lift_horizontal" state={ horizontalThumbState } /></button>
            <button className="clove-scroll-right" type="button" onClick={ () => viewportRef.current?.scrollBy({ left: 32 }) }><SkinRegistryView registryId="habbo_skin_scrollbar" layout="scrollbar_button_right" /></button>
        </div> }
    </div>;
};

export const UbuntuWindow: FC<{ title: string; meta?: string; metaFormat?: TruffleTextFormat; titleAccessory?: ReactNode; className?: string; children: ReactNode; onClose?: () => void; desktopControls?: boolean; role?: AriaRole; ariaLabel?: string }> = ({ title, meta, metaFormat = VOLTER_REGULAR, titleAccessory, className = '', children, onClose, desktopControls = false, role, ariaLabel }) =>
    <section className={ `clove-ubuntu-window ${ className }` } role={ role } aria-label={ ariaLabel }>
        <SkinRegistryView className="clove-ubuntu-window-skin" registryId="habbo_skin_frame_3" layout="frame_3" color={ 0x418DB0 } />
        <header className={ `clove-ubuntu-window-title ${ desktopControls ? 'is-desktop-titlebar' : '' }` } onDoubleClick={ desktopControls ? () => window.cloveDesktop?.windowControl('toggle-maximize') : undefined }>
            { desktopControls && <img className="clove-app-title-icon" src="./cloveIcon.png" width={ 23 } height={ 25 } alt="" draggable={ false } /> }
            <HabboText format={ HABBO_STYLES.u_frame_title } color={ 0xFFFFFF }>{ title }</HabboText>
            { meta && <HabboText className="clove-ubuntu-window-meta" format={ metaFormat } color={ 0xFFFFFF }>{ meta }</HabboText> }
            { titleAccessory }
        </header>
        { desktopControls && <div className="clove-desktop-window-controls">
            <HabboChromeButton className="is-minimize" label="Minimize Clove" registryId="illumina_light_skin_button_frame_minimize" layout="illumina_light_button_frame_minimize" onClick={ () => window.cloveDesktop?.windowControl('minimize') } />
            <HabboChromeButton className="is-maximize" label="Maximize or restore Clove" imageUrl="/assets/images/library/1363_maximize_png.png" onClick={ () => window.cloveDesktop?.windowControl('toggle-maximize') } />
            <HabboChromeButton className="is-close" label="Close Clove" registryId="habbo_skin_button_close_3" layout="button_close_3" onClick={ () => window.cloveDesktop?.windowControl('close') } />
        </div> }
        { onClose && <HabboChromeButton className="clove-ubuntu-window-close" label="Close" registryId="habbo_skin_button_close_3" layout="button_close_3" onClick={ onClose } /> }
        <div className="clove-ubuntu-window-content">{ children }</div>
    </section>;
