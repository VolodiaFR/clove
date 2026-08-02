import { HABBO_STYLES } from 'truffle-text';
import { CSSProperties, FC, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { getSkinRegistryLayoutGeometry, habboChromeDrawsOwnSkin, HabboBitmapView, HabboChromeView, hasHabboChromeLayout, SkinRegistryView } from '../common/habbo';
import { TruffleTextView, VOLTER_REGULAR } from '../truffle';
import { TruffleEditableTextView } from '../truffle/TruffleEditableTextView';
import { CloveNode, displayCaption } from './model/layoutXml';
import { CloveNodeSimulation } from './simulation';
import { resolveNodeSkin, resolveWindowType, styleFamily } from './skinResolver';
import { CloveTheme } from './widgetCatalog';
import { boundsOfRects, CloveSnapRect, snapRectToSiblings } from './snapGeometry';

export interface CloveSnapGuides
{
    parentId: string;
    x?: number;
    y?: number;
}

interface CloveNodeViewProps
{
    node: CloveNode;
    selectedIds: string[];
    snap: number;
    zoom: number;
    debugRects: boolean;
    theme: CloveTheme;
    mode: 'edit' | 'preview';
    activeTabs: Record<string, string>;
    parentId?: string;
    hiddenNodeIds?: Set<string>;
    forcedVisibleNodeIds?: Set<string>;
    geometryOverrides?: Record<string, Partial<CSSProperties>>;
    simulationOverrides?: Record<string, CloveNodeSimulation>;
    siblings?: CloveNode[];
    snapGuides?: CloveSnapGuides | null;
    onChangeGeometry: (id: string, attributes: Record<string, string>) => void;
    onMoveSelection: (ids: string[], deltaX: number, deltaY: number) => void;
    onSnapGuides: (guides: CloveSnapGuides | null) => void;
    onChangeCaption: (id: string, caption: string) => void;
    onActivateTab: (contextId: string, tabName: string) => void;
    resolveCaption?: (caption: string) => string;
}

const finiteNumber = (value: unknown, fallback = 0) =>
{
    if(value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return fallback;

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
};

const numberAttribute = (node: CloveNode, name: string, fallback = 0) =>
{
    return finiteNumber(node.attributes[name], fallback);
};
const cssColor = (value: number) => `#${ (value & 0xFFFFFF).toString(16).padStart(6, '0') }`;
const variable = (node: CloveNode, key: string) => node.variables.find(value => value.key === key)?.value;
const snapValue = (value: number, snap: number) => snap > 1 ? Math.round(value / snap) * snap : Math.round(value);

const skinForType = (type: string, style: string) =>
{
    const entry = resolveWindowType(type, style);

    return entry?.renderer === 'skin' && entry.registryId && entry.layout ? { registryId: entry.registryId, layout: entry.layout } : null;
};

const isPlaceholder = (node: CloveNode) => node.type === 'widget'
    || node.type === 'bitmap'
    || (node.type === 'static_bitmap' && !variable(node, 'asset_uri'));


const textFormat = (node: CloveNode) =>
{
    const family = styleFamily(node.attributes.style);
    const defaultStyle = node.type === 'frame'
        ? (family === 'ubuntu' ? 'u_frame_title' : family === 'blue' ? 'frame_title' : family === 'illumina-dark' ? 'id_frame_title' : 'il_frame_title')
        : (node.type === 'button' ? 'button_shiny_regular' : family === 'ubuntu' ? 'u_regular' : family === 'blue' ? 'regular' : 'il_regular');
    const styleName = variable(node, 'text_style') || defaultStyle;
    const base = HABBO_STYLES[styleName] || HABBO_STYLES.u_regular;
    const format: Record<string, unknown> = { ...base };
    const size = variable(node, 'font_size');
    const fontFace = variable(node, 'font_face');

    const numericSize = finiteNumber(size, 0);
    const numericSpacing = finiteNumber(variable(node, 'spacing'), 0);

    if(numericSize > 0) format.size = Math.min(256, Math.max(1, numericSize));
    if(fontFace?.trim()) format.fontFamily = fontFace.trim();
    if(variable(node, 'bold')) format.bold = variable(node, 'bold') === 'true';
    if(variable(node, 'italic')) format.italic = variable(node, 'italic') === 'true';
    if(variable(node, 'underline')) format.underline = variable(node, 'underline') === 'true';
    if(variable(node, 'spacing')) format.letterSpacing = Math.min(100, Math.max(-100, numericSpacing));

    return format;
};

export const CloveNodeView: FC<CloveNodeViewProps> = props =>
{
    const { node, selectedIds, snap, zoom, debugRects, mode, activeTabs, parentId = '', hiddenNodeIds, forcedVisibleNodeIds, geometryOverrides, simulationOverrides = {}, siblings = [], snapGuides, onChangeGeometry, onMoveSelection, onSnapGuides, onChangeCaption, onActivateTab, resolveCaption } = props;
    const [ interactionState, setInteractionState ] = useState<'default' | 'hovering' | 'pressed' | 'selected'>('default');
    const [ editingCaption, setEditingCaption ] = useState(false);
    const [ captionDraft, setCaptionDraft ] = useState('');
    const [ inputValue, setInputValue ] = useState(() => displayCaption(node.attributes.caption || ''));
    const [ dropmenuOpen, setDropmenuOpen ] = useState(false);
    const [ toggled, setToggled ] = useState(false);
    const dragCleanupRef = useRef<(() => void) | null>(null);
    const inlineCaptionRef = useRef<HTMLDivElement>(null);
    const captionCommittedRef = useRef(false);
    const nodeSimulation = simulationOverrides[node.id] || {};
    const dropmenuOptions = useMemo(() => nodeSimulation.options?.length ? nodeSimulation.options : [], [ nodeSimulation.options ]);
    const [ dropmenuValue, setDropmenuValue ] = useState(() => dropmenuOptions[0] || '');
    const x = numberAttribute(node, 'x');
    const y = numberAttribute(node, 'y');
    const resolvedSkin = node.editorSkin || resolveNodeSkin(node);
    const skinGeometry = resolvedSkin ? getSkinRegistryLayoutGeometry(resolvedSkin.registryId, resolvedSkin.layout) : null;
    const width = Math.max(1, numberAttribute(node, 'width', 40), numberAttribute(node, 'width_min'), skinGeometry?.minWidth || 0);
    const height = Math.max(1, numberAttribute(node, 'height', 20), numberAttribute(node, 'height_min'), skinGeometry?.minHeight || 0);
    const selected = selectedIds.includes(node.id);
    const visible = !hiddenNodeIds?.has(node.id) && (node.attributes.visible !== 'false' || forcedVisibleNodeIds?.has(node.id));
    const rawCaption = nodeSimulation.caption ?? displayCaption(node.attributes.caption || '');
    const caption = resolveCaption ? resolveCaption(rawCaption) : rawCaption;
    const nodeStyle = node.attributes.style || '0';
    const windowType = resolveWindowType(node.type === 'scrollbar' ? 'scrollbar_vertical' : node.type, nodeStyle);
    const color = finiteNumber(node.attributes.color || windowType?.color, 0xFFFFFF);
    const family = styleFamily(nodeStyle);
    const hasLegacyCaptionBackground = node.type === 'frame' && [ '0', '1', '2' ].includes(nodeStyle);
    const closeSkin = node.type === 'frame' ? skinForType('closebutton', nodeStyle) : null;
    const scalerSkin = node.type === 'frame' && !family.startsWith('illumina-') && (Number(node.attributes.params || 0) & 0x10000) !== 0 ? skinForType('scaler', nodeStyle) : null;
    const marginLeft = finiteNumber(variable(node, 'margin_left'));
    const marginTop = finiteNumber(variable(node, 'margin_top'));
    const marginRight = finiteNumber(variable(node, 'margin_right'));
    const marginBottom = finiteNumber(variable(node, 'margin_bottom'));
    const isShinyButton = node.type === 'button';
    const textAlign = isShinyButton ? 'center' : variable(node, 'auto_size') || 'left';
    const format = useMemo(() => textFormat(node), [ node ]);
    const siblingIndex = siblings.findIndex(item => item.id === node.id);
    const hierarchyZIndex = siblingIndex >= 0 ? siblingIndex : 0;
    const rawGeometryOverride = geometryOverrides?.[node.id] || {};
    const safeGeometryOverride = Object.fromEntries(Object.entries(rawGeometryOverride).filter(([ key, value ]) => ![ 'left', 'top', 'width', 'height' ].includes(key) || (typeof value === 'number' && Number.isFinite(value)))) as Partial<CSSProperties>;
    const style: CSSProperties = { left: x, top: y, width, height, zIndex: hierarchyZIndex, display: visible ? undefined : 'none', isolation: 'isolate', ...safeGeometryOverride };
    const rotation = ((finiteNumber(node.attributes.rotation) % 360) + 360) % 360;
    const flipX = node.attributes.flip_x === 'true';
    const flipY = node.attributes.flip_y === 'true';
    const visualTransform = rotation || flipX || flipY ? `rotate(${ rotation }deg) scale(${ flipX ? -1 : 1 }, ${ flipY ? -1 : 1 })` : undefined;
    const selectedTab = node.type === 'tab_container_button' && activeTabs[parentId] === (node.attributes.name || node.id);
    const toggleControl = [ 'checkbox', 'radiobutton', 'radio_button', 'switch' ].includes(node.type) || node.attributes.intent === 'switch';

    useEffect(() =>
    {
        setDropmenuValue(current => dropmenuOptions.includes(current) ? current : (dropmenuOptions[0] || ''));
        if(!dropmenuOptions.length) setDropmenuOpen(false);
    }, [ dropmenuOptions ]);
    const renderedState = nodeSimulation.disabled ? 'disabled' : (nodeSimulation.selected || selectedTab || (toggleControl && toggled)) ? 'selected' : interactionState;
    const hasInheritedTextChild = node.children.some(child => child.type === 'label' || child.type === 'text');
    const windowLayout = windowType?.windowLayout || '';
    const rendersChrome = hasHabboChromeLayout(windowLayout);
    const bitmapAssetName = node.type === 'static_bitmap' ? variable(node, 'asset_uri') : '';

    useEffect(() => () => dragCleanupRef.current?.(), []);

    const beginMove = (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        if(mode !== 'edit' || event.button !== 0 || (event.target as HTMLElement).closest('.clove-resize-handle, .clove-inline-caption')) return;

        event.preventDefault();
        event.stopPropagation();
        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        const movingIds = selectedIds.includes(node.id) && !additive ? siblings.filter(item => selectedIds.includes(item.id)).map(item => item.id) : [ node.id ];

        dragCleanupRef.current?.();
        const target = event.currentTarget;
        const startX = event.clientX;
        const startY = event.clientY;
        const selectedRects: CloveSnapRect[] = siblings.filter(item => movingIds.includes(item.id)).map(item => ({
            id: item.id,
            x: numberAttribute(item, 'x'),
            y: numberAttribute(item, 'y'),
            width: Math.max(1, numberAttribute(item, 'width', 40)),
            height: Math.max(1, numberAttribute(item, 'height', 20))
        }));
        const movingBounds = boundsOfRects(selectedRects.length ? selectedRects : [ { id: node.id, x, y, width, height } ]);
        const siblingRects: CloveSnapRect[] = siblings.filter(item => !movingIds.includes(item.id) && item.attributes.visible !== 'false').map(item => ({
            id: item.id,
            x: numberAttribute(item, 'x'),
            y: numberAttribute(item, 'y'),
            width: Math.max(1, numberAttribute(item, 'width', 40)),
            height: Math.max(1, numberAttribute(item, 'height', 20))
        }));
        let latestDelta = { x: 0, y: 0 };

        target.setPointerCapture(event.pointerId);

        const move = (moveEvent: PointerEvent) =>
        {
            const gridX = snapValue((moveEvent.clientX - startX) / zoom, snap);
            const gridY = snapValue((moveEvent.clientY - startY) / zoom, snap);
            const snapped = moveEvent.altKey ? { deltaX: gridX, deltaY: gridY } : snapRectToSiblings(movingBounds, gridX, gridY, siblingRects);

            latestDelta = { x: snapped.deltaX, y: snapped.deltaY };
            onSnapGuides(snapped.guideX === undefined && snapped.guideY === undefined ? null : { parentId, x: snapped.guideX, y: snapped.guideY });
            for(const id of movingIds)
            {
                const element = target.closest('.clove-stage')?.querySelector<HTMLElement>(`[data-node-id="${ CSS.escape(id) }"]`);

                if(element) element.style.translate = `${ latestDelta.x }px ${ latestDelta.y }px`;
            }
        };
        const cleanup = () =>
        {
            for(const id of movingIds)
            {
                const element = target.closest('.clove-stage')?.querySelector<HTMLElement>(`[data-node-id="${ CSS.escape(id) }"]`);

                if(element) element.style.translate = '';
            }
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', end);
            target.removeEventListener('pointercancel', end);
            if(target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
            onSnapGuides(null);

            if(dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
        };
        const end = () =>
        {
            cleanup();

            if(latestDelta.x || latestDelta.y) onMoveSelection(movingIds, latestDelta.x, latestDelta.y);
        };

        dragCleanupRef.current = cleanup;
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', end);
        target.addEventListener('pointercancel', end);
    };

    const beginResize = (event: ReactPointerEvent<HTMLSpanElement>, direction: string) =>
    {
        event.preventDefault();
        event.stopPropagation();

        dragCleanupRef.current?.();
        const target = event.currentTarget;
        const pointerId = event.pointerId;
        const startX = event.clientX;
        const startY = event.clientY;

        let latest = { x, y, width, height };
        const geometryAt = (clientX: number, clientY: number, uniform: boolean) =>
        {
            const deltaX = snapValue((clientX - startX) / zoom, snap);
            const deltaY = snapValue((clientY - startY) / zoom, snap);
            const minimumWidth = Math.max(1, numberAttribute(node, 'width_min', 1));
            const configuredMaximumWidth = numberAttribute(node, 'width_max', Number.POSITIVE_INFINITY);
            const maximumWidth = configuredMaximumWidth > 0 ? configuredMaximumWidth : Number.POSITIVE_INFINITY;
            const minimumHeight = Math.max(1, numberAttribute(node, 'height_min', 1));
            const configuredMaximumHeight = numberAttribute(node, 'height_max', Number.POSITIVE_INFINITY);
            const maximumHeight = configuredMaximumHeight > 0 ? configuredMaximumHeight : Number.POSITIVE_INFINITY;
            let nextWidth = width + (direction.includes('e') ? deltaX : direction.includes('w') ? -deltaX : 0);
            let nextHeight = height + (direction.includes('s') ? deltaY : direction.includes('n') ? -deltaY : 0);

            if(uniform && direction.length === 2)
            {
                const widthScale = nextWidth / width;
                const heightScale = nextHeight / height;
                let scale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale;
                const minimumScale = Math.max(minimumWidth / width, minimumHeight / height);
                const maximumScale = Math.min(maximumWidth / width, maximumHeight / height);

                scale = Math.max(minimumScale, Math.min(maximumScale, scale));
                nextWidth = Math.round(width * scale);
                nextHeight = Math.round(height * scale);
            }

            nextWidth = Math.min(maximumWidth, Math.max(minimumWidth, nextWidth));
            nextHeight = Math.min(maximumHeight, Math.max(minimumHeight, nextHeight));

            return {
                x: direction.includes('w') ? x + width - nextWidth : x,
                y: direction.includes('n') ? y + height - nextHeight : y,
                width: nextWidth,
                height: nextHeight
            };
        };

        const move = (moveEvent: PointerEvent) =>
        {
            latest = geometryAt(moveEvent.clientX, moveEvent.clientY, moveEvent.shiftKey);
            const liveTarget = target.closest('.clove-stage')?.querySelector<HTMLElement>(`[data-node-id="${ CSS.escape(node.id) }"]`);

            if(!liveTarget) return;
            if(direction.includes('e') || direction.includes('w')) liveTarget.style.width = `${ latest.width }px`;
            if(direction.includes('n') || direction.includes('s')) liveTarget.style.height = `${ latest.height }px`;
            liveTarget.style.translate = `${ latest.x - x }px ${ latest.y - y }px`;
        };
        const end = () =>
        {
            const attributes: Record<string, string> = {};

            if(direction.includes('e') || direction.includes('w')) attributes.width = String(latest.width);
            if(direction.includes('w')) attributes.x = String(latest.x);
            if(direction.includes('n') || direction.includes('s')) attributes.height = String(latest.height);
            if(direction.includes('n')) attributes.y = String(latest.y);

            cleanup();
            onChangeGeometry(node.id, attributes);
        };
        const cancel = () => cleanup();
        const cleanup = () =>
        {
            const liveTarget = target.closest('.clove-stage')?.querySelector<HTMLElement>(`[data-node-id="${ CSS.escape(node.id) }"]`);

            if(liveTarget)
            {
                liveTarget.style.width = `${ width }px`;
                liveTarget.style.height = `${ height }px`;
                liveTarget.style.translate = '';
            }
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', cancel);
            if(target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
            if(dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
        };

        dragCleanupRef.current = cleanup;
        target.setPointerCapture(pointerId);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', cancel);
    };

    const beginCaptionEdit = () =>
    {
        if(mode !== 'edit' || ![ 'text', 'label', 'input', 'button', 'tab_container_button' ].includes(node.type)) return;

        captionCommittedRef.current = false;
        setCaptionDraft(rawCaption);
        setEditingCaption(true);
    };

    const commitCaption = () =>
    {
        if(captionCommittedRef.current) return;

        captionCommittedRef.current = true;
        setEditingCaption(false);
        if(captionDraft !== rawCaption) onChangeCaption(node.id, captionDraft);
    };

    useEffect(() =>
    {
        if(!editingCaption) return;

        const commitOnClickAway = (event: PointerEvent) =>
        {
            if(!inlineCaptionRef.current?.contains(event.target as Node)) commitCaption();
        };

        document.addEventListener('pointerdown', commitOnClickAway, true);

        return () => document.removeEventListener('pointerdown', commitOnClickAway, true);
    }, [ captionDraft, editingCaption, rawCaption ]);

    const activate = () =>
    {
        if(mode !== 'preview' || nodeSimulation.disabled) return;

        if(node.type === 'tab_container_button')
        {
            onActivateTab(parentId, node.attributes.name || node.id);
            setInteractionState('selected');
        }
        if(toggleControl) setToggled(current => !current);
    };

    const contentStyle: CSSProperties = { left: marginLeft, top: marginTop, right: marginRight, bottom: marginBottom };
    // Sulake source: _assets/1148_button_shiny_xml*.bin.
    const captionStyle: CSSProperties = isShinyButton
        ? { left: marginLeft || 8, top: marginTop || 2, right: marginRight || 8, bottom: marginBottom || 3 }
        : { left: marginLeft, top: marginTop, right: marginRight, bottom: marginBottom };
    return (
        <div
            className={ `clove-node clove-node-${ node.type } ${ selected ? 'is-selected' : '' } ${ nodeSimulation.disabled ? 'is-sim-disabled' : '' } ${ nodeSimulation.selected ? 'is-sim-selected' : '' } ${ debugRects ? 'show-debug-rect' : '' } ${ mode === 'preview' ? 'is-previewing' : '' }` }
            style={ style }
            data-node-id={ node.id }
            aria-disabled={ nodeSimulation.disabled || undefined }
            onPointerDown={ beginMove }
            onMouseEnter={ () => mode === 'preview' && !nodeSimulation.disabled && setInteractionState('hovering') }
            onMouseLeave={ () => mode === 'preview' && setInteractionState('default') }
            onMouseDown={ () => mode === 'preview' && !nodeSimulation.disabled && setInteractionState('pressed') }
            onMouseUp={ () => mode === 'preview' && !nodeSimulation.disabled && setInteractionState('hovering') }
            onClick={ activate }
            onDoubleClick={ beginCaptionEdit }>
            <div className="clove-node-visual" style={ { transform: visualTransform } }>
            { resolvedSkin && (!rendersChrome || habboChromeDrawsOwnSkin(windowLayout)) && <SkinRegistryView registryId={ resolvedSkin.registryId } layout={ resolvedSkin.layout } state={ renderedState } color={ color } /> }
            { rendersChrome && <HabboChromeView windowLayout={ windowLayout } styleId={ nodeStyle } width={ width } height={ height } state={ renderedState } color={ color } /> }
            { node.type === 'separator' && <div className="clove-separator-line" /> }
            { node.type === 'frame' && caption && <div className={ `clove-frame-caption theme-${ family } ${ hasLegacyCaptionBackground ? 'has-background' : '' }` }>{ hasLegacyCaptionBackground
                ? <span className="clove-frame-caption-background" style={ { backgroundColor: cssColor(color) } }><TruffleTextView text={ caption } format={ format } color={ finiteNumber(variable(node, 'text_color'), 0xFFFFFF) } /></span>
                : <TruffleTextView text={ caption } format={ format } color={ finiteNumber(variable(node, 'text_color'), 0xFFFFFF) } /> }</div> }
            { closeSkin && <span className={ `clove-frame-close theme-${ family }` }><SkinRegistryView registryId={ closeSkin.registryId } layout={ closeSkin.layout } state="default" /></span> }
            { scalerSkin && <span className={ `clove-frame-scaler theme-${ family }` }><SkinRegistryView registryId={ scalerSkin.registryId } layout={ scalerSkin.layout } state="default" color={ color } /></span> }
            { bitmapAssetName && <HabboBitmapView className="clove-static-bitmap" assetName={ bitmapAssetName } assetId={ node.editorAssetId } alt={ node.attributes.name || bitmapAssetName } stretchedX={ variable(node, 'stretched_x') !== 'false' } stretchedY={ variable(node, 'stretched_y') !== 'false' } pivotPoint={ variable(node, 'pivot_point') || 'top_left' } /> }
            { mode === 'preview' && node.type === 'input' && <TruffleEditableTextView value={ inputValue } onChange={ setInputValue } className="clove-sim-input" format={ format as never } color={ finiteNumber(variable(node, 'text_color'), 0x000000) } maxLength={ 120 } /> }
            { mode === 'preview' && node.type === 'dropmenu' && <div className={ `clove-sim-dropmenu ${ dropmenuOpen ? 'open' : '' }` } onPointerDown={ event => event.stopPropagation() }>
                <button type="button" disabled={ nodeSimulation.disabled || !dropmenuOptions.length } onClick={ () => dropmenuOptions.length && setDropmenuOpen(current => !current) }><span><TruffleTextView text={ dropmenuValue } format={ VOLTER_REGULAR } /></span><i /></button>
                { dropmenuOpen && <div role="listbox">{ dropmenuOptions.map(option => <button type="button" role="option" aria-selected={ option === dropmenuValue } key={ option } onClick={ () =>
                {
                    setDropmenuValue(option);
                    setDropmenuOpen(false);
                } }><TruffleTextView text={ option } format={ VOLTER_REGULAR } /></button>) }</div> }
            </div> }
            { [ 'text', 'label', 'input', 'button', 'tab_container_button' ].includes(node.type) && caption && !editingCaption && !hasInheritedTextChild && (mode !== 'preview' || node.type !== 'input') &&
                <div className={ `clove-node-caption align-${ textAlign }` } style={ captionStyle }><TruffleTextView text={ caption } format={ format } color={ variable(node, 'text_color') ? finiteNumber(variable(node, 'text_color')) : undefined } wordWrap={ variable(node, 'word_wrap') === 'true' } width={ variable(node, 'word_wrap') === 'true' ? Math.max(1, width - marginLeft - marginRight) : undefined } /></div> }
            { editingCaption && <div ref={ inlineCaptionRef } className="clove-inline-caption"><TruffleEditableTextView className="clove-inline-caption-editor" autoFocus value={ captionDraft } onChange={ setCaptionDraft } format={ format as never } color={ finiteNumber(variable(node, 'text_color'), 0x000000) } onBlur={ commitCaption } onKeyDown={ event =>
            {
                if(event.key === 'Enter') commitCaption();
                if(event.key === 'Escape')
                {
                    captionCommittedRef.current = true;
                    setEditingCaption(false);
                }
            } } /></div> }
            { isPlaceholder(node) && !bitmapAssetName && <div className="clove-placeholder"><TruffleTextView text={ node.attributes.name || variable(node, 'asset_uri') || variable(node, 'widget_type') || node.type } format={ HABBO_STYLES.u_regular } /><TruffleTextView text={ node.type } format={ HABBO_STYLES.u_small } /></div> }
            <div className="clove-node-children" style={ contentStyle }>
                { snapGuides?.parentId === node.id && snapGuides.x !== undefined && <span className="clove-snap-guide vertical" style={ { left: snapGuides.x } } /> }
                { snapGuides?.parentId === node.id && snapGuides.y !== undefined && <span className="clove-snap-guide horizontal" style={ { top: snapGuides.y } } /> }
                { node.children.map(child =>
                {
                    return <CloveNodeView key={ child.id } { ...props } node={ child } parentId={ node.id } siblings={ node.children } />;
                }) }
            </div>
            </div>
            { selected && mode === 'edit' && [ 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w' ].map(direction => <span key={ direction } className={ `clove-resize-handle handle-${ direction }` } data-resize-direction={ direction } onPointerDown={ event => beginResize(event, direction) } />) }
        </div>
    );
};
