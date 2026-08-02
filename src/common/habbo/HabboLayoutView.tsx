import { HABBO_STYLES } from 'truffle-text';
import { getTruffle } from 'truffle-text/react';
import { createContext, CSSProperties, FC, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { applyHabboXmlTextRendering, TruffleTextView } from '../../truffle';
import { HabboBitmapView } from './HabboBitmapView';
import { getHabboChromeContentInsets, habboChromeDrawsOwnSkin, HabboChromeView, hasHabboChromeLayout } from './HabboChromeView';
import { HabboResolvedSkin, resolveHabboNodeSkin, resolveWindowType, styleFamily } from './HabboWindowTypeRegistry';
import { getSkinRegistryLayoutGeometry, HabboSkinState, SkinRegistryView } from './SkinRegistryView';
import './HabboLayoutView.scss';

interface HabboLayoutVariable
{
    key: string;
    value: string;
    type?: string;
}

export interface HabboLayoutNode
{
    id: string;
    type: string;
    attributes: Record<string, string>;
    variables: HabboLayoutVariable[];
    children: HabboLayoutNode[];
    editorSkin?: HabboResolvedSkin;
    editorAssetId?: string;
}

export interface HabboLayoutDefinition
{
    name: string;
    width: number;
    height: number;
    nodes: HabboLayoutNode[];
}

export interface HabboLayoutViewProps
{
    layout: HabboLayoutDefinition;
    className?: string;
    slots?: Partial<Record<string, ReactNode>>;
    visibility?: Partial<Record<string, boolean>>;
    captions?: Partial<Record<string, string>>;
    itemListOrder?: Partial<Record<string, string[]>>;
    geometryOverrides?: Partial<Record<string, Partial<HabboNodeGeometry>>>;
    rootSize?: { width: number; height: number };
    initialActiveTabs?: Record<string, string>;
    resolveCaption?: (caption: string) => string;
    showPlaceholders?: boolean;
    onAction?: (name: string, event: ReactMouseEvent<HTMLElement>) => void;
    onTabChange?: (contextName: string, tabName: string) => void;
    onClose?: () => void;
}

export interface HabboLayoutRuntimeController
{
    rootSize?: HabboLayoutViewProps['rootSize'];
    geometryOverrides?: HabboLayoutViewProps['geometryOverrides'];
    textColors?: Partial<Record<string, number>>;
    backgroundColors?: Partial<Record<string, number>>;
    enabled?: Partial<Record<string, boolean>>;
    interactive?: Partial<Record<string, boolean>>;
    appendedSlots?: Partial<Record<string, ReactNode>>;
    resizable?: boolean;
    onResize?: (size: { width: number; height: number }) => void;
}

const HabboLayoutRuntimeContext = createContext<HabboLayoutRuntimeController | null>(null);

export const HabboLayoutRuntimeProvider: FC<{ controller: HabboLayoutRuntimeController; children: ReactNode }> = ({ controller, children }) =>
    <HabboLayoutRuntimeContext.Provider value={ controller }>{ children }</HabboLayoutRuntimeContext.Provider>;

const INTERACTIVE_TYPES = new Set([ 'button', 'container_button', 'iconbutton', 'closebutton', 'button_group_left', 'button_group_center', 'button_group_right', 'tab_button', 'tab_container_button', 'dropmenu', 'checkbox', 'radiobutton', 'radio_button', 'switch', 'scaler', 'region', 'link', 'bitmap' ]);
const TEXT_TYPES = new Set([ 'text', 'label', 'link', 'input', 'button', 'button_group_left', 'button_group_center', 'button_group_right', 'tab_button', 'tab_container_button' ]);
const ITEMLIST_TYPES = new Set([ 'itemlist_vertical', 'itemlist_horizontal' ]);
// Sulake source: core/window/utils/§_-n1r§.as (Glaze param table).
const WINDOW_PARAM_EXPAND_TO_ACCOMMODATE_CHILDREN = 0x020000;
const WINDOW_PARAM_RESIZE_TO_ACCOMMODATE_CHILDREN = 0x024000;
const missingTextStyles = new Set<string>();
const failedTextMeasurements = new Set<string>();
const warnedMultiTagOverrides = new Set<string>();
const FLASH_FONT_STYLE_ALIASES: Record<string, keyof typeof HABBO_STYLES> = {
    'Volter': 'regular',
    'Volter Bold': 'bold'
};

const variable = (node: HabboLayoutNode, key: string) => node.variables.find(value => value.key === key)?.value;
const numberAttribute = (node: HabboLayoutNode, name: string, fallback = 0) => Number(node.attributes[name] ?? fallback);
const flattenNodes = (nodes: HabboLayoutNode[]): HabboLayoutNode[] => nodes.flatMap(node => [ node, ...flattenNodes(node.children) ]);
const displayCaption = (caption = '') =>
{
    try
    {
        return decodeURIComponent(caption);
    }
    catch
    {
        return caption;
    }
};
const argbBackground = (value = '') =>
{
    const color = Number(value) >>> 0;
    const alpha = color >>> 24;

    if(!alpha) return undefined;

    const red = (color >>> 16) & 0xFF;
    const green = (color >>> 8) & 0xFF;
    const blue = color & 0xFF;

    return `rgba(${ red }, ${ green }, ${ blue }, ${ alpha / 255 })`;
};
const cssColor = (value: number) => `#${ (value & 0xFFFFFF).toString(16).padStart(6, '0') }`;
const skinForType = (type: string, style: string) =>
{
    const entry = resolveWindowType(type, style);

    return entry?.renderer === 'skin' && entry.registryId && entry.layout ? { registryId: entry.registryId, layout: entry.layout } : null;
};
const isPlaceholder = (node: HabboLayoutNode) => node.type === 'widget'
    || node.type === 'bitmap'
    || node.type.includes('itemgrid')
    || (node.type === 'static_bitmap' && !variable(node, 'asset_uri'));
const decodeSlotName = (value: string) =>
{
    try
    {
        return decodeURIComponent(value);
    }
    catch
    {
        return value;
    }
};
const nodeNames = (node: HabboLayoutNode) => [
    node.attributes.name,
    node.attributes.id,
    node.id
].filter(Boolean).map(decodeSlotName);
const nodeTags = (node: HabboLayoutNode) => (node.attributes.tags || '').split(/[\s,]+/).filter(Boolean).map(decodeSlotName);
const warnMultiTagOverride = (kind: string, tag: string, matches: HabboLayoutNode[]) =>
{
    const warningKey = `${ kind }:${ tag }`;

    if(warnedMultiTagOverrides.has(warningKey)) return;

    warnedMultiTagOverrides.add(warningKey);
    console.warn(`[HabboLayoutView] Ambiguous ${ kind } tag "${ tag }" matches ${ matches.length } nodes: ${ matches.map(match => match.attributes.name || match.id).join(', ') }.`);
};
const overrideNameForNode = <T,>(node: HabboLayoutNode, values: Partial<Record<string, T>>, allNodes: HabboLayoutNode[], kind: string) =>
{
    const exactName = nodeNames(node).find(candidate => Object.prototype.hasOwnProperty.call(values, candidate));

    if(exactName) return exactName;

    for(const tag of nodeTags(node))
    {
        if(!Object.prototype.hasOwnProperty.call(values, tag)) continue;

        // A key that names a node is never also treated as a tag. Sulake uses
        // tags as broad lookup groups, so allowing both makes one runtime
        // caption/slot silently overwrite unrelated windows.
        if(allNodes.some(candidate => nodeNames(candidate).includes(tag))) continue;

        const matches = allNodes.filter(candidate => nodeTags(candidate).includes(tag));

        if(matches.length > 1)
        {
            warnMultiTagOverride(kind, tag, matches);
            return tag;
        }

        return tag;
    }

    return undefined;
};
const overrideForNode = <T,>(node: HabboLayoutNode, values: Partial<Record<string, T>>, allNodes: HabboLayoutNode[], kind: string) =>
{
    const name = overrideNameForNode(node, values, allNodes, kind);

    return name ? values[name] : undefined;
};
const textFormat = (node: HabboLayoutNode) =>
{
    const family = styleFamily(node.attributes.style);
    const defaultStyle = node.type === 'frame'
        ? (family === 'ubuntu' ? 'u_frame_title' : family === 'blue' ? 'frame_title' : family === 'illumina-dark' ? 'id_frame_title' : 'il_frame_title')
        : (node.type === 'button' ? 'button_shiny_regular' : family === 'ubuntu' ? 'u_regular' : family === 'blue' ? 'regular' : 'il_regular');
    const styleName = variable(node, 'text_style') || defaultStyle;
    const base = HABBO_STYLES[styleName];

    if(!base && !missingTextStyles.has(styleName))
    {
        missingTextStyles.add(styleName);
        console.warn(`[HabboLayoutView] Unknown Habbo text style "${ styleName }"; using u_regular.`);
    }

    const format: Record<string, unknown> = { ...(base || HABBO_STYLES.u_regular) };
    const size = variable(node, 'font_size');
    const fontFace = variable(node, 'font_face');

    if(size) format.size = Number(size);
    if(fontFace)
    {
        const mappedStyleName = FLASH_FONT_STYLE_ALIASES[fontFace];
        const mappedStyle = mappedStyleName ? HABBO_STYLES[mappedStyleName] : null;

        if(mappedStyle)
        {
            format.fontFamily = mappedStyle.fontFamily;
            format.bold = mappedStyle.bold;
            format.italic = mappedStyle.italic;
        }
        else
        {
            console.error(`[HabboLayoutView] Unknown Flash font_face "${ fontFace }" on ${ node.attributes.name || node.id }.`);
            format.fontFamily = fontFace;
        }
    }
    if(variable(node, 'bold')) format.bold = variable(node, 'bold') === 'true';
    if(variable(node, 'italic')) format.italic = variable(node, 'italic') === 'true';
    if(variable(node, 'underline')) format.underline = variable(node, 'underline') === 'true';
    if(variable(node, 'spacing')) format.letterSpacing = Number(variable(node, 'spacing'));
    if(variable(node, 'leading')) format.leading = Number(variable(node, 'leading'));
    if(variable(node, 'sharpness')) format.sharpness = Number(variable(node, 'sharpness'));
    if(variable(node, 'thickness')) format.thickness = Number(variable(node, 'thickness'));
    if(variable(node, 'kerning')) format.kerning = variable(node, 'kerning') === 'true';

    return applyHabboXmlTextRendering(format, {
        antiAliasType: variable(node, 'antialias_type'),
        gridFitType: variable(node, 'grid_fit_type')
    });
};

export interface HabboNodeGeometry
{
    x: number;
    y: number;
    width: number;
    height: number;
}

const constrainedSize = (node: HabboLayoutNode, axis: 'width' | 'height', value: number) =>
{
    const minimum = numberAttribute(node, `${ axis }_min`, 1);
    const maximum = numberAttribute(node, `${ axis }_max`, 0);
    const constrained = Math.max(1, minimum, Math.ceil(value));

    return maximum > 0 ? Math.min(constrained, maximum) : constrained;
};

const anchoredXAfterResize = (x: number, authoredWidth: number, nextWidth: number, params: number) =>
{
    const horizontalAnchor = params & 0x0C0000;

    if(horizontalAnchor === 0x040000) return x + authoredWidth - nextWidth;
    if(horizontalAnchor === 0x0C0000) return x + Math.trunc((authoredWidth - nextWidth) / 2);

    return x;
};

const measureHabboText = (text: string, format: string | Record<string, unknown>, width?: number) =>
{
    const truffle = getTruffle();

    if(!truffle || !text) return null;

    try
    {
        const measured = truffle.measure(text, format, width ? { width, wordWrap: true } : undefined);
        const charBounds = measured.charBounds as { right?: number; bottom?: number; y?: number; height?: number }[];
        const terminalAdvance = charBounds.reduce((maximum, bounds) => Math.max(maximum, Number(bounds?.right) || 0), 0);
        const terminalBottom = charBounds.reduce((maximum, bounds) => Math.max(maximum, Number(bounds?.bottom) || ((Number(bounds?.y) || 0) + (Number(bounds?.height) || 0))), 0);

        // Flash getCharBoundaries().right is the terminal glyph advance in
        // TextField coordinates, including the authored left field gutter.
        // It therefore captures the final glyph advance and letter spacing
        // without a per-window padding guess. The bottom edge is likewise read
        // from the actual laid-out character bounds so wrapped descenders keep
        // the TextField gutter and per-line rounding used by the renderer.
        return {
            ...measured,
            textWidth: Math.ceil(Math.max(measured.textWidth, terminalAdvance)),
            textHeight: Math.ceil(Math.max(measured.textHeight, terminalBottom))
        };
    }
    catch(error)
    {
        const failureKey = JSON.stringify(format);

        if(!failedTextMeasurements.has(failureKey))
        {
            failedTextMeasurements.add(failureKey);
            console.error('[HabboLayoutView] Truffle failed to measure an authored text format.', { error, format });
        }

        return null;
    }
};

const resolvedNodeCaption = (node: HabboLayoutNode, captions: Partial<Record<string, string>>, resolveCaption: (caption: string) => string, allNodes: HabboLayoutNode[]) =>
{
    const override = overrideForNode(node, captions, allNodes, 'caption override');

    return override !== undefined ? override : resolveCaption(displayCaption(node.attributes.caption || ''));
};

const baseNodeGeometry = (node: HabboLayoutNode, captions: Partial<Record<string, string>>, resolveCaption: (caption: string) => string, allNodes: HabboLayoutNode[]): HabboNodeGeometry =>
{
    let x = numberAttribute(node, 'x');
    const y = numberAttribute(node, 'y');
    const resolvedSkin = resolveHabboNodeSkin(node);
    const skinGeometry = resolvedSkin ? getSkinRegistryLayoutGeometry(resolvedSkin.registryId, resolvedSkin.layout) : null;
    let width = Math.max(1, numberAttribute(node, 'width', 40), numberAttribute(node, 'width_min'), skinGeometry?.minWidth || 0);
    let height = Math.max(1, numberAttribute(node, 'height', 20), numberAttribute(node, 'height_min'), skinGeometry?.minHeight || 0);
    const caption = resolvedNodeCaption(node, captions, resolveCaption, allNodes);

    // Sulake source: core/window/components/ButtonController.as update(),
    // WE_CHILD_RESIZED sets width=0. The themed _BTN_TEXT label contributes its
    // 8px left and right margins, and WindowController.setRectangle() preserves
    // the node's right/center anchor bits while the width changes.
    if(node.type === 'button' && (Number(node.attributes.params || 0) & WINDOW_PARAM_EXPAND_TO_ACCOMMODATE_CHILDREN) !== 0)
    {
        const measured = measureHabboText(caption, textFormat(node));
        const authoredWidth = width;
        const nextWidth = constrainedSize(node, 'width', (measured?.textWidth || 0) + 16);

        x = anchoredXAfterResize(x, authoredWidth, nextWidth, Number(node.attributes.params || 0));
        width = nextWidth;
    }

    const autoSize = variable(node, 'auto_size');
    // Sulake source: TextLabelController.refresh() always resizes labels to
    // their measured TextField bounds. TextController only does so when its
    // auto_size property is enabled.
    const autoSizesToText = node.type === 'label' || (node.type === 'text' && !!autoSize && autoSize !== 'none');

    if(autoSizesToText && caption)
    {
        const marginLeft = Number(variable(node, 'margin_left') || 0);
        const marginRight = Number(variable(node, 'margin_right') || 0);
        const marginTop = Number(variable(node, 'margin_top') || 0);
        const marginBottom = Number(variable(node, 'margin_bottom') || 0);
        const wordWrap = variable(node, 'word_wrap') === 'true';
        const measured = measureHabboText(caption, textFormat(node), wordWrap ? Math.max(1, width - marginLeft - marginRight) : undefined);

        if(measured)
        {
            if(!wordWrap)
            {
                const authoredWidth = width;
                const nextWidth = constrainedSize(node, 'width', measured.textWidth + marginLeft + marginRight);

                x = anchoredXAfterResize(x, authoredWidth, nextWidth, Number(node.attributes.params || 0));
                width = nextWidth;
            }
            height = constrainedSize(node, 'height', Math.max(height, measured.textHeight + marginTop + marginBottom));
        }
    }

    return { x, y, width, height };
};

export interface HabboLayoutGeometryOptions
{
    captions?: Partial<Record<string, string>>;
    itemListOrder?: Partial<Record<string, string[]>>;
    resolveCaption?: (caption: string) => string;
    isVisible?: (node: HabboLayoutNode) => boolean;
    rootSize?: { width: number; height: number };
    geometryOverrides?: Partial<Record<string, Partial<HabboNodeGeometry>>>;
}

export const getHabboLayoutGeometry = (nodes: HabboLayoutNode[], options: HabboLayoutGeometryOptions = {}) =>
{
    const allNodes = flattenNodes(nodes);
    const captions = options.captions || {};
    const itemListOrder = options.itemListOrder || {};
    const resolveCaption = options.resolveCaption || (value => value);
    const isVisible = options.isVisible || (node => node.attributes.visible !== 'false');
    const resolved: Record<string, HabboNodeGeometry> = {};

    allNodes.forEach(node => resolved[node.id] = baseNodeGeometry(node, captions, resolveCaption, allNodes));

    for(const node of allNodes)
    {
        const override = overrideForNode(node, options.geometryOverrides || {}, allNodes, 'geometry override');

        if(override) resolved[node.id] = { ...resolved[node.id], ...override };
    }

    // Sulake source: core/window/WindowController.as updateScaleRelativeToParent().
    // 0x80/0x800 stretch, 0x40/0x400 move, and 0xC0/0xC00 center the child
    // when its parent changes size. WindowRectLimits clamps every result.
    const applyParentResize = (nodesToResize: HabboLayoutNode[], parent?: HabboLayoutNode) =>
    {
        for(const [ index, node ] of nodesToResize.entries())
        {
            const geometry = resolved[node.id];

            if(!parent && index === 0 && options.rootSize)
            {
                geometry.width = constrainedSize(node, 'width', options.rootSize.width);
                geometry.height = constrainedSize(node, 'height', options.rootSize.height);
            }
            else if(parent)
            {
                const parentGeometry = resolved[parent.id];
                const widthDelta = parentGeometry.width - numberAttribute(parent, 'width', parentGeometry.width);
                const heightDelta = parentGeometry.height - numberAttribute(parent, 'height', parentGeometry.height);
                const params = Number(node.attributes.params || 0);
                const horizontalScale = params & 0xC0;
                const verticalScale = params & 0x0C00;

                if(horizontalScale === 0x80) geometry.width = constrainedSize(node, 'width', geometry.width + widthDelta);
                else if(horizontalScale === 0x40) geometry.x += widthDelta;
                else if(horizontalScale === 0xC0) geometry.x = Math.floor(parentGeometry.width / 2) - Math.floor(geometry.width / 2);

                if(verticalScale === 0x0800) geometry.height = constrainedSize(node, 'height', geometry.height + heightDelta);
                else if(verticalScale === 0x0400) geometry.y += heightDelta;
                else if(verticalScale === 0x0C00) geometry.y = Math.floor(parentGeometry.height / 2) - Math.floor(geometry.height / 2);
            }

            applyParentResize(node.children, node);
        }
    };

    applyParentResize(nodes);

    for(const context of allNodes.filter(node => node.type === 'tab_context'))
    {
        const tabs = context.children.filter(child => child.type === 'tab_container_button');
        let x = tabs.length ? numberAttribute(tabs[0], 'x') : 0;

        for(const tab of tabs)
        {
            if(!isVisible(tab)) continue;

            const resizeToAccommodate = (Number(tab.attributes.params || 0) & WINDOW_PARAM_RESIZE_TO_ACCOMMODATE_CHILDREN) === WINDOW_PARAM_RESIZE_TO_ACCOMMODATE_CHILDREN;

            if(!resizeToAccommodate)
            {
                resolved[tab.id] = { ...resolved[tab.id], x };
                x += resolved[tab.id].width;
                continue;
            }

            const titleChildren = tab.children.filter(child => child.type === 'label' || child.type === 'text');
            const titleNodes = titleChildren.length ? titleChildren : [ tab ];
            let accommodatedWidth = 1;

            titleNodes.forEach(child =>
            {
                const childCaption = resolvedNodeCaption(child, captions, resolveCaption, allNodes);
                const measured = measureHabboText(childCaption, textFormat(child));
                const marginLeft = Number(variable(child, 'margin_left') || 0);
                const marginRight = Number(variable(child, 'margin_right') || 0);
                const childWidth = constrainedSize(child, 'width', (measured?.textWidth || 0) + marginLeft + marginRight);

                if(child !== tab) resolved[child.id] = { ...resolved[child.id], width: childWidth };
                accommodatedWidth = Math.max(accommodatedWidth, (child === tab ? 0 : resolved[child.id].x) + childWidth);
            });

            // Sulake source: TabButtonController.as forwards the caption to
            // TAB_BUTTON_TITLE; WindowController.resizeToAccommodateChildren()
            // adopts max(child.x + child.width), including both text margins.
            resolved[tab.id] = { ...resolved[tab.id], x, width: constrainedSize(tab, 'width', accommodatedWidth) };
            x += resolved[tab.id].width;
        }
    }

    // Sulake source: core/window/components/ItemListController.as,
    // updateScrollAreaRegion() lines 684-750. Only visible children advance
    // the cursor; horizontal lists replace x, vertical lists replace y.
    for(const list of allNodes.filter(node => ITEMLIST_TYPES.has(node.type)).reverse())
    {
        const spacing = Number(variable(list, 'spacing') || 0);
        const orderedNames = overrideForNode(list, itemListOrder, allNodes, 'item-list order');
        const children = orderedNames
            ? orderedNames.map(name =>
            {
                const exact = allNodes.find(node => nodeNames(node).includes(name));

                if(exact) return exact;

                const matches = allNodes.filter(node => nodeTags(node).includes(name));

                if(matches.length > 1) warnMultiTagOverride('item-list member', name, matches);

                return matches.length === 1 ? matches[0] : undefined;
            }).filter(Boolean) as HabboLayoutNode[]
            : list.children;
        const directChildren = new Set(list.children.map(child => child.id));
        const firstExternal = children.find(child => !directChildren.has(child.id));
        let cursor = firstExternal
            ? (list.type === 'itemlist_horizontal' ? resolved[firstExternal.id].x - resolved[list.id].x : resolved[firstExternal.id].y - resolved[list.id].y)
            : 0;

        for(const child of children)
        {
            if(!isVisible(child)) continue;

            const isDirectChild = directChildren.has(child.id);

            if(list.type === 'itemlist_horizontal')
            {
                resolved[child.id] = { ...resolved[child.id], x: isDirectChild ? cursor : resolved[list.id].x + cursor };
                cursor += resolved[child.id].width + spacing;
            }
            else
            {
                resolved[child.id] = { ...resolved[child.id], y: isDirectChild ? cursor : resolved[list.id].y + cursor };
                cursor += resolved[child.id].height + spacing;
            }
        }

        if(variable(list, 'resize_on_item_update') === 'true')
        {
            const contentSize = Math.max(0, cursor - (children.some(isVisible) ? spacing : 0));

            if(list.type === 'itemlist_horizontal') resolved[list.id] = { ...resolved[list.id], width: constrainedSize(list, 'width', contentSize) };
            else resolved[list.id] = { ...resolved[list.id], height: constrainedSize(list, 'height', contentSize) };
        }

    }

    return resolved;
};

interface HabboLayoutNodeViewProps
{
    node: HabboLayoutNode;
    parentId?: string;
    siblingIndex?: number;
    allNodes: HabboLayoutNode[];
    activeTabs: Record<string, string>;
    hiddenNodeIds: Set<string>;
    forcedVisibleNodeIds: Set<string>;
    slots: Partial<Record<string, ReactNode>>;
    visibility: Partial<Record<string, boolean>>;
    captions: Partial<Record<string, string>>;
    textColors: Partial<Record<string, number>>;
    backgroundColors: Partial<Record<string, number>>;
    enabled: Partial<Record<string, boolean>>;
    interactiveOverrides: Partial<Record<string, boolean>>;
    appendedSlots: Partial<Record<string, ReactNode>>;
    resizable: boolean;
    resolveCaption: (caption: string) => string;
    showPlaceholders: boolean;
    onAction?: HabboLayoutViewProps['onAction'];
    onClose?: HabboLayoutViewProps['onClose'];
    onBeginResize: (node: HabboLayoutNode, event: ReactPointerEvent<HTMLButtonElement>) => void;
    onActivateTab: (contextId: string, contextName: string, tabName: string) => void;
    geometry: Record<string, HabboNodeGeometry>;
}

interface HabboFrameChromeButtonProps
{
    className: string;
    label: string;
    registryId: string;
    layout: string;
    color?: number;
    onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
    onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

const HabboFrameChromeButton: FC<HabboFrameChromeButtonProps> = props =>
{
    const { className, label, registryId, layout, color = 0xFFFFFF, onClick, onPointerDown } = props;
    const [ state, setState ] = useState<HabboSkinState>('default');

    return <button className={ className } type="button" aria-label={ label } onMouseEnter={ () => setState('hovering') } onMouseLeave={ () => setState('default') } onMouseDown={ () => setState('pressed') } onMouseUp={ () => setState('hovering') } onClick={ event =>
    {
        setState('default');
        onClick?.(event);
    } } onPointerDown={ onPointerDown }><SkinRegistryView registryId={ registryId } layout={ layout } state={ state } color={ color } /></button>;
};

const HabboLayoutNodeView: FC<HabboLayoutNodeViewProps> = props =>
{
    const { node, parentId = '', siblingIndex = 0, allNodes, activeTabs, hiddenNodeIds, forcedVisibleNodeIds, slots, visibility, captions, textColors, backgroundColors, enabled, interactiveOverrides, appendedSlots, resizable, resolveCaption, showPlaceholders, onAction, onClose, onBeginResize, onActivateTab, geometry } = props;
    const [ interactionState, setInteractionState ] = useState<HabboSkinState>('default');
    const [ toggled, setToggled ] = useState(false);
    const hasBeenVisibleRef = useRef(false);
    const nodeGeometry = geometry[node.id] || baseNodeGeometry(node, captions, resolveCaption, allNodes);
    const { x, y, width, height } = nodeGeometry;
    const resolvedSkin = resolveHabboNodeSkin(node);
    const visibilityName = overrideNameForNode(node, visibility, allNodes, 'visibility override');
    const visibleOverride = visibilityName ? visibility[visibilityName] : undefined;
    const visible = visibleOverride ?? (!hiddenNodeIds.has(node.id) && (node.attributes.visible !== 'false' || forcedVisibleNodeIds.has(node.id)));
    const caption = resolvedNodeCaption(node, captions, resolveCaption, allNodes);
    const nodeStyle = node.attributes.style || '0';
    const windowType = resolveWindowType(node.type === 'scrollbar' ? 'scrollbar_vertical' : node.type, nodeStyle);
    const color = node.attributes.color ? Number(node.attributes.color) : Number(windowType?.color || 0xFFFFFF);
    const textColor = overrideForNode(node, textColors, allNodes, 'text color override') ?? (variable(node, 'text_color') ? Number(variable(node, 'text_color')) : undefined);
    const backgroundColor = overrideForNode(node, backgroundColors, allNodes, 'background color override') ?? (node.attributes.color ? Number(node.attributes.color) : undefined);
    const family = styleFamily(nodeStyle);
    const hasLegacyCaptionBackground = node.type === 'frame' && [ '0', '1', '2' ].includes(nodeStyle);
    const closeSkin = node.type === 'frame' ? skinForType('closebutton', nodeStyle) : null;
    const scalerSkin = resizable && node.type === 'frame' && !family.startsWith('illumina-') && (Number(node.attributes.params || 0) & 0x10000) !== 0 ? skinForType('scaler', nodeStyle) : null;
    const windowLayout = windowType?.windowLayout || '';
    const contentInsets = getHabboChromeContentInsets(windowLayout);
    const marginLeft = Number(variable(node, 'margin_left') ?? contentInsets?.left ?? 0);
    const marginTop = Number(variable(node, 'margin_top') ?? contentInsets?.top ?? 0);
    const marginRight = Number(variable(node, 'margin_right') ?? contentInsets?.right ?? 0);
    const marginBottom = Number(variable(node, 'margin_bottom') ?? contentInsets?.bottom ?? 0);
    const isShinyButton = node.type === 'button';
    const textAnchor = Number(node.attributes.params || 0) & 0x0C0000;
    const textAlign = isShinyButton || textAnchor === 0x0C0000 ? 'center' : textAnchor === 0x040000 ? 'right' : 'left';
    const format = useMemo(() => textFormat(node), [ node ]);
    const selectedTab = node.type === 'tab_container_button' && activeTabs[parentId] === (node.attributes.name || node.id);
    const toggleControl = [ 'checkbox', 'radiobutton', 'radio_button', 'switch' ].includes(node.type) || node.attributes.intent === 'switch';
    const enabledOverride = overrideForNode(node, enabled, allNodes, 'enabled override');
    const isEnabled = enabledOverride !== false;
    const renderedState: HabboSkinState = !isEnabled ? 'disabled' : selectedTab || (toggleControl && toggled) ? 'selected' : interactionState;
    const hasInheritedTextChild = node.children.some(child => child.type === 'label' || child.type === 'text');
    const bitmapAssetName = node.type === 'static_bitmap' ? variable(node, 'asset_uri') : '';
    const tooltip = variable(node, 'tool_tip_caption');
    const matchingSlot = overrideNameForNode(node, slots, allNodes, 'slot');
    const slot = matchingSlot ? slots[matchingSlot] : undefined;
    const appendedSlotName = overrideNameForNode(node, appendedSlots, allNodes, 'appended slot');
    const appendedSlot = appendedSlotName ? appendedSlots[appendedSlotName] : undefined;
    const interactiveOverride = overrideForNode(node, interactiveOverrides, allNodes, 'interactive override');
    const interactive = (interactiveOverride ?? INTERACTIVE_TYPES.has(node.type)) && isEnabled;
    const ownsRendering = matchingSlot !== undefined && slot !== undefined;
    const retainHiddenTabPage = hiddenNodeIds.has(node.id) && hasBeenVisibleRef.current && visibleOverride === undefined;
    if(visible) hasBeenVisibleRef.current = true;
    const style: CSSProperties = {
        left: x,
        top: y,
        zIndex: siblingIndex,
        width,
        height,
        display: visible || retainHiddenTabPage ? undefined : 'none',
        visibility: retainHiddenTabPage ? 'hidden' : undefined,
        pointerEvents: retainHiddenTabPage ? 'none' : undefined,
        isolation: 'isolate',
        transform: Number(node.attributes.rotation || 0) || node.attributes.flip_x === 'true' || node.attributes.flip_y === 'true'
            ? `rotate(${ ((Number(node.attributes.rotation || 0) % 360) + 360) % 360 }deg) scale(${ node.attributes.flip_x === 'true' ? -1 : 1 }, ${ node.attributes.flip_y === 'true' ? -1 : 1 })`
            : undefined,
        transformOrigin: 'center center',
        backgroundColor: node.attributes.background === 'true' ? argbBackground(String(backgroundColor ?? '')) : undefined
    };
    const contentStyle: CSSProperties = { left: marginLeft, top: marginTop, right: marginRight, bottom: marginBottom };
    // Sulake source: _assets/1148_button_shiny_xml*.bin. _BTN_TEXT is centered
    // inside its 8/2/8/3 margin box for every shiny button.
    const captionStyle: CSSProperties = isShinyButton
        ? { left: marginLeft || 8, top: marginTop || 2, right: marginRight || 8, bottom: marginBottom || 3 }
        : { left: marginLeft, top: marginTop, right: marginRight, bottom: marginBottom };
    const rendersChrome = hasHabboChromeLayout(windowLayout);
    const rendersOwnSkinWithChrome = habboChromeDrawsOwnSkin(windowLayout);

    const activate = (event: ReactMouseEvent<HTMLElement>) =>
    {
        const name = node.attributes.name || node.attributes.id || node.id;

        if(node.type === 'tab_container_button') onActivateTab(parentId, parentId, name);
        if(toggleControl) setToggled(current => !current);
        if(node.type === 'closebutton') onClose?.();
        onAction?.(name, event);
    };

    return (
        <div
            className={ `habbo-layout-node habbo-layout-node-${ node.type } ${ interactive ? 'is-interactive' : '' }` }
            style={ style }
            data-habbo-node-id={ node.id }
            data-habbo-node-name={ node.attributes.name || '' }
            role={ interactive ? 'button' : undefined }
            title={ tooltip ? resolveCaption(displayCaption(tooltip)) : undefined }
            tabIndex={ interactive ? 0 : undefined }
            onMouseEnter={ () => interactive && setInteractionState('hovering') }
            onMouseLeave={ () => interactive && setInteractionState('default') }
            onMouseDown={ () => interactive && setInteractionState('pressed') }
            onMouseUp={ () => interactive && setInteractionState('hovering') }
            onClick={ interactive ? activate : undefined }>
            { !ownsRendering && resolvedSkin && (!rendersChrome || rendersOwnSkinWithChrome) && <SkinRegistryView registryId={ resolvedSkin.registryId } layout={ resolvedSkin.layout } state={ renderedState } template={ node.type === 'icon' ? `icon_${ nodeStyle }` : undefined } color={ color } /> }
            { !ownsRendering && rendersChrome && <HabboChromeView windowLayout={ windowLayout } styleId={ nodeStyle } width={ width } height={ height } state={ renderedState } color={ color } /> }
            { !ownsRendering && node.type === 'separator' && <div className="habbo-layout-separator" /> }
            { !ownsRendering && node.type === 'frame' && <div className="habbo-layout-frame-drag-region" /> }
            { !ownsRendering && node.type === 'frame' && caption && <div className={ `habbo-layout-frame-caption theme-${ family } ${ hasLegacyCaptionBackground ? 'has-background' : '' }` }>{ hasLegacyCaptionBackground
                ? <span className="habbo-layout-frame-caption-background" style={ { backgroundColor: cssColor(color) } }><TruffleTextView text={ caption } format={ format } color={ textColor ?? 0xFFFFFF } /></span>
                : <TruffleTextView text={ caption } format={ format } color={ textColor ?? 0xFFFFFF } /> }</div> }
            { !ownsRendering && closeSkin && <HabboFrameChromeButton className={ `habbo-layout-frame-close theme-${ family }` } label="Close" registryId={ closeSkin.registryId } layout={ closeSkin.layout } onClick={ event =>
            {
                event.stopPropagation();
                onClose?.();
            } } /> }
            { !ownsRendering && scalerSkin && <HabboFrameChromeButton className={ `habbo-layout-frame-scaler theme-${ family }` } label="Resize" registryId={ scalerSkin.registryId } layout={ scalerSkin.layout } color={ color } onPointerDown={ event => onBeginResize(node, event) } /> }
            { !ownsRendering && bitmapAssetName && <HabboBitmapView className="habbo-layout-static-bitmap" assetName={ bitmapAssetName } assetId={ node.editorAssetId } alt={ node.attributes.name || bitmapAssetName } stretchedX={ variable(node, 'stretched_x') !== 'false' } stretchedY={ variable(node, 'stretched_y') !== 'false' } pivotPoint={ variable(node, 'pivot_point') || 'top_left' } /> }
            { !ownsRendering && TEXT_TYPES.has(node.type) && caption && !hasInheritedTextChild && <div className={ `habbo-layout-node-caption align-${ textAlign }` } style={ captionStyle }><TruffleTextView text={ caption } format={ format } color={ textColor } wordWrap={ variable(node, 'word_wrap') === 'true' } width={ variable(node, 'word_wrap') === 'true' ? Math.max(1, width - marginLeft - marginRight) : undefined } /></div> }
            { ownsRendering && hasBeenVisibleRef.current && <div className="habbo-layout-slot" data-slot={ matchingSlot }>{ slot }</div> }
            { visible && slot === undefined && showPlaceholders && isPlaceholder(node) && !bitmapAssetName && <div className="habbo-layout-placeholder"><span>{ node.attributes.name || variable(node, 'asset_uri') || node.type }</span><small>{ node.type }</small></div> }
            { hasBeenVisibleRef.current && slot === undefined && <div className="habbo-layout-node-children" style={ contentStyle }>{ node.children.map((child, index) => <HabboLayoutNodeView key={ child.id } { ...props } node={ child } parentId={ node.id } siblingIndex={ index } />) }</div> }
            { hasBeenVisibleRef.current && slot === undefined && appendedSlot !== undefined && <div className="habbo-layout-appended-slot" data-slot={ appendedSlotName }>{ appendedSlot }</div> }
        </div>
    );
};

export const HabboLayoutView: FC<HabboLayoutViewProps> = props =>
{
    const { layout, className = '', slots = {}, visibility = {}, captions = {}, itemListOrder = {}, geometryOverrides: directGeometryOverrides, rootSize: directRootSize, initialActiveTabs = {}, resolveCaption = value => value, showPlaceholders = false, onAction, onTabChange, onClose } = props;
    const runtimeController = useContext(HabboLayoutRuntimeContext);
    const geometryOverrides = useMemo(() => directGeometryOverrides || runtimeController?.geometryOverrides || {}, [ directGeometryOverrides, runtimeController?.geometryOverrides ]);
    const controlledRootSize = directRootSize || runtimeController?.rootSize;
    const textColors = runtimeController?.textColors || {};
    const backgroundColors = runtimeController?.backgroundColors || {};
    const enabled = runtimeController?.enabled || {};
    const interactiveOverrides = runtimeController?.interactive || {};
    const appendedSlots = runtimeController?.appendedSlots || {};
    const resizable = runtimeController?.resizable !== false;
    const [ activeTabs, setActiveTabs ] = useState<Record<string, string>>(initialActiveTabs);
    const [ rootSize, setRootSize ] = useState({ width: layout.width, height: layout.height });
    const resizeCleanupRef = useRef<() => void>();
    const allNodes = useMemo(() => flattenNodes(layout.nodes), [ layout.nodes ]);
    const initialActiveTabsSignature = JSON.stringify(initialActiveTabs);
    // A semantic signature avoids reapplying an equivalent inline object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => setActiveTabs(current => ({ ...current, ...initialActiveTabs })), [ initialActiveTabsSignature ]);
    useEffect(() =>
    {
        const nextSize = controlledRootSize || { width: layout.width, height: layout.height };

        setRootSize(current => (current.width === nextSize.width) && (current.height === nextSize.height) ? current : nextSize);
    }, [ controlledRootSize, layout.height, layout.width ]);
    useEffect(() => () => resizeCleanupRef.current?.(), []);
    const tabState = useMemo(() =>
    {
        const resolved = { ...activeTabs };
        const hidden = new Set<string>();
        const forcedVisible = new Set<string>();

        for(const context of allNodes.filter(node => node.type === 'tab_context'))
        {
            const tabs = context.children.filter(child => child.type === 'tab_container_button');
            const visibleTabs = tabs.filter(tab =>
            {
                const visibilityName = overrideNameForNode(tab, visibility, allNodes, 'visibility override');

                return ((visibilityName ? visibility[visibilityName] : undefined) ?? tab.attributes.visible !== 'false');
            });
            const names = visibleTabs.map(tab => tab.attributes.name).filter(Boolean);
            const pages = allNodes.filter(node => node.type !== 'tab_container_button' && names.includes(node.attributes.name));
            const requestedName = names.includes(activeTabs[context.id]) ? activeTabs[context.id] : '';
            const activeName = requestedName || pages.find(page => page.attributes.visible !== 'false')?.attributes.name || names[0];

            if(!activeName) continue;

            resolved[context.id] = activeName;
            for(const page of pages)
            {
                if(page.attributes.name === activeName) forcedVisible.add(page.id);
                else hidden.add(page.id);
            }
        }

        return { resolved, hidden, forcedVisible };
    }, [ activeTabs, allNodes, visibility ]);
    const geometry = useMemo(() =>
    {
        const isVisible = (node: HabboLayoutNode) =>
        {
            const override = overrideForNode(node, visibility, allNodes, 'visibility override');

            return override ?? (!tabState.hidden.has(node.id) && (node.attributes.visible !== 'false' || tabState.forcedVisible.has(node.id)));
        };

        return getHabboLayoutGeometry(layout.nodes, { captions, itemListOrder, geometryOverrides, resolveCaption, isVisible, rootSize });
    }, [ allNodes, captions, geometryOverrides, itemListOrder, layout.nodes, resolveCaption, rootSize, tabState.forcedVisible, tabState.hidden, visibility ]);

    // Sulake source: WindowController.as WME_DOWN locates the 0x10000 scaling
    // target, WindowMouseScaler.as applies the 0x1000/0x2000 axes, and
    // WindowController.setRectangle() clamps WindowRectLimits.
    const beginResize = (node: HabboLayoutNode, event: ReactPointerEvent<HTMLButtonElement>) =>
    {
        if(event.button !== 0) return;

        event.preventDefault();
        event.stopPropagation();
        resizeCleanupRef.current?.();
        const params = Number(node.attributes.params || 0);
        const scaleHorizontal = (params & 0x1000) !== 0 || (params & 0x10000) !== 0;
        const scaleVertical = (params & 0x2000) !== 0 || (params & 0x10000) !== 0;
        const startPointer = { x: event.clientX, y: event.clientY };
        const startSize = rootSize;
        const minWidth = numberAttribute(node, 'width_min', 1);
        const maxWidth = numberAttribute(node, 'width_max', Number.MAX_SAFE_INTEGER);
        const minHeight = numberAttribute(node, 'height_min', 1);
        const maxHeight = numberAttribute(node, 'height_max', Number.MAX_SAFE_INTEGER);
        const move = (moveEvent: PointerEvent) =>
        {
            const nextSize = {
                width: scaleHorizontal ? Math.max(minWidth, Math.min(maxWidth, startSize.width + moveEvent.clientX - startPointer.x)) : startSize.width,
                height: scaleVertical ? Math.max(minHeight, Math.min(maxHeight, startSize.height + moveEvent.clientY - startPointer.y)) : startSize.height
            };

            setRootSize(nextSize);
            runtimeController?.onResize?.(nextSize);
        };
        const end = () =>
        {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            resizeCleanupRef.current = undefined;
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        resizeCleanupRef.current = end;
    };

    const activateTab = (contextId: string, _contextName: string, tabName: string) =>
    {
        const context = allNodes.find(node => node.id === contextId);

        setActiveTabs(current => ({ ...current, [contextId]: tabName }));
        onTabChange?.(context?.attributes.name || contextId, tabName);
    };

    return <div className={ `habbo-layout-view ${ className }` } style={ rootSize } data-layout-name={ layout.name }>
        { layout.nodes.map((node, index) => <HabboLayoutNodeView key={ node.id } node={ node } siblingIndex={ index } allNodes={ allNodes } activeTabs={ tabState.resolved } hiddenNodeIds={ tabState.hidden } forcedVisibleNodeIds={ tabState.forcedVisible } slots={ slots } visibility={ visibility } captions={ captions } textColors={ textColors } backgroundColors={ backgroundColors } enabled={ enabled } interactiveOverrides={ interactiveOverrides } appendedSlots={ appendedSlots } resizable={ resizable } resolveCaption={ resolveCaption } showPlaceholders={ showPlaceholders } onAction={ onAction } onClose={ onClose } onBeginResize={ beginResize } onActivateTab={ activateTab } geometry={ geometry } />) }
    </div>;
};
