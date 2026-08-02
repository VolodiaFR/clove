import { CSSProperties, FC } from 'react';
import { resolveWindowType } from './HabboWindowTypeRegistry';
import { HabboSkinState, SkinRegistryView } from './SkinRegistryView';
import './HabboChromeView.scss';

interface HabboChromeNode
{
    type: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    widthMin?: number;
    heightMin?: number;
    scaleH: 'fixed' | 'move' | 'stretch' | 'center';
    scaleV: 'fixed' | 'move' | 'stretch' | 'center';
    visible?: boolean;
    boundToParent?: boolean;
    children?: HabboChromeNode[];
}

interface HabboChromeLayout
{
    width: number;
    height: number;
    drawOwnSkin?: boolean;
    contentInsets?: { left: number; top: number; right: number; bottom: number };
    children: HabboChromeNode[];
}

// These are data, not rendering special cases. They are direct transcriptions of
// Sulake's component layouts; the interpreter below applies their fixed/stretch/move
// constraints recursively to any target size.
const CHROME_LAYOUTS: Record<string, HabboChromeLayout> = {
    // Sulake source: _assets/1112_frame_xml*. The FrameController composes
    // this internal header above the frame skin; the header is the authored
    // dotted title texture and mouse-dragging trigger.
    habbo_window_layout_frame: {
        width: 40,
        height: 40,
        drawOwnSkin: true,
        children: [
            { type: 'header', name: 'titlebar', x: 6, y: 6, width: 28, height: 15, scaleH: 'stretch', scaleV: 'fixed' }
        ]
    },
    // Sulake source: _assets/1179_bubble_xml*.bin. BubbleController extends
    // FrameController: the node skin remains visible while internal pointer
    // chrome is painted above it, and authored children are placed in the
    // _CONTENT child. Only the down pointer is visible by default.
    habbo_window_layout_bubble: {
        width: 21,
        height: 21,
        drawOwnSkin: true,
        contentInsets: { left: 8, top: 8, right: 8, bottom: 8 },
        children: [
            { type: 'bubble_pointer_up', name: 'up', x: 4, y: 0, width: 13, height: 9, scaleH: 'center', scaleV: 'fixed', visible: false },
            { type: 'bubble_pointer_down', name: 'down', x: 4, y: 12, width: 13, height: 9, scaleH: 'center', scaleV: 'move' },
            { type: 'bubble_pointer_left', name: 'left', x: 0, y: 4, width: 8, height: 13, scaleH: 'fixed', scaleV: 'center', visible: false },
            { type: 'bubble_pointer_right', name: 'right', x: 13, y: 4, width: 8, height: 13, scaleH: 'move', scaleV: 'center', visible: false }
        ]
    },
    // Sulake source: _assets/1243_tab_context_3_xml*.bin and
    // core/window/components/TabContextController.as. The controller locates
    // these internal children by the _CONTENT and _SELECTOR tags.
    habbo_window_layout_tab_context_3: {
        width: 64,
        height: 64,
        children: [
            { type: 'tab_content', name: 'content', x: 0, y: 30, width: 64, height: 32, scaleH: 'stretch', scaleV: 'stretch' },
            { type: 'tab_selector', name: 'selector', x: 8, y: 0, width: 48, height: 32, scaleH: 'stretch', scaleV: 'fixed' }
        ]
    },
    habbo_window_layout_scrollbar_vertical: {
        width: 17,
        height: 56,
        children: [
            { type: 'scrollbar_slider_button_up', name: 'decrement', x: 0, y: 0, width: 17, height: 16, scaleH: 'fixed', scaleV: 'fixed' },
            {
                type: 'scrollbar_slider_track_vertical', name: 'slider_track', x: 0, y: 16, width: 17, height: 24, scaleH: 'fixed', scaleV: 'stretch', children: [
                    { type: 'scrollbar_slider_bar_vertical', name: 'slider_bar', x: 0, y: 0, width: 17, height: 24, heightMin: 12, scaleH: 'fixed', scaleV: 'fixed', boundToParent: true }
                ]
            },
            { type: 'scrollbar_slider_button_down', name: 'increment', x: 0, y: 40, width: 17, height: 16, scaleH: 'fixed', scaleV: 'move' }
        ]
    },
    illumina_light_scrollbar_vertical: {
        width: 9,
        height: 9,
        children: [ {
            type: 'scrollbar_slider_track_vertical', name: 'slider_track', x: 0, y: 0, width: 9, height: 9, scaleH: 'fixed', scaleV: 'stretch', children: [
                { type: 'scrollbar_slider_bar_vertical', name: 'slider_bar', x: 0, y: 0, width: 9, height: 9, heightMin: 9, scaleH: 'fixed', scaleV: 'fixed', boundToParent: true }
            ]
        } ]
    },
    illumina_dark_scrollbar_vertical: {
        width: 9,
        height: 9,
        children: [ {
            type: 'scrollbar_slider_track_vertical', name: 'slider_track', x: 0, y: 0, width: 9, height: 9, scaleH: 'fixed', scaleV: 'stretch', children: [
                { type: 'scrollbar_slider_bar_vertical', name: 'slider_bar', x: 0, y: 0, width: 9, height: 9, heightMin: 9, scaleH: 'fixed', scaleV: 'fixed', boundToParent: true }
            ]
        } ]
    }
};

const transformAxis = (start: number, size: number, minimum: number, mode: HabboChromeNode['scaleH'], delta: number, parentSize: number) =>
{
    let nextStart = mode === 'move' ? start + delta : mode === 'center' ? Math.floor(parentSize / 2) - Math.floor(size / 2) : start;
    let nextSize = mode === 'stretch' ? Math.max(minimum, size + delta) : Math.max(minimum, size);

    nextStart = Math.max(0, nextStart);
    nextSize = Math.max(0, Math.min(nextSize, parentSize - nextStart));

    return [ nextStart, nextSize ];
};

const ChromeNodeView: FC<{
    node: HabboChromeNode;
    naturalParentWidth: number;
    naturalParentHeight: number;
    parentWidth: number;
    parentHeight: number;
    styleId: string;
    state: HabboSkinState;
    color: number;
}> = ({ node, naturalParentWidth, naturalParentHeight, parentWidth, parentHeight, styleId, state, color }) =>
{
    if(node.visible === false) return null;

    const deltaWidth = parentWidth - naturalParentWidth;
    const deltaHeight = parentHeight - naturalParentHeight;
    const [ x, width ] = transformAxis(node.x, node.width, node.widthMin || 1, node.scaleH, deltaWidth, parentWidth);
    const [ y, height ] = transformAxis(node.y, node.height, node.heightMin || 1, node.scaleV, deltaHeight, parentHeight);
    const entry = resolveWindowType(node.type, styleId);
    const skin = entry?.renderer === 'skin' && entry.registryId && entry.layout ? { registryId: entry.registryId, layout: entry.layout } : null;
    const elementStyle: CSSProperties = { position: 'absolute', left: x, top: y, width, height, overflow: node.boundToParent ? 'hidden' : 'visible' };

    return <span className={ `habbo-chrome-node habbo-chrome-${ node.name }` } style={ elementStyle } data-chrome-type={ node.type }>
        { skin && <SkinRegistryView registryId={ skin.registryId } layout={ skin.layout } state={ state } color={ color } /> }
        { node.children?.map(child => <ChromeNodeView key={ `${ child.type }-${ child.name }` } node={ child } naturalParentWidth={ node.width } naturalParentHeight={ node.height } parentWidth={ width } parentHeight={ height } styleId={ styleId } state={ state } color={ color } />) }
    </span>;
};

export const HabboChromeView: FC<{ windowLayout: string; styleId: string; width: number; height: number; state?: HabboSkinState; color?: number; className?: string }> = ({ windowLayout, styleId, width, height, state = 'default', color = 0xFFFFFF, className = '' }) =>
{
    const layout = CHROME_LAYOUTS[windowLayout];

    if(!layout) return null;

    return <span className={ `habbo-chrome-view ${ className }` } data-window-layout={ windowLayout }>
        { layout.children.map(node => <ChromeNodeView key={ `${ node.type }-${ node.name }` } node={ node } naturalParentWidth={ layout.width } naturalParentHeight={ layout.height } parentWidth={ width } parentHeight={ height } styleId={ styleId } state={ state } color={ color } />) }
    </span>;
};

export const hasHabboChromeLayout = (name: string) => !!CHROME_LAYOUTS[name];
export const habboChromeDrawsOwnSkin = (name: string) => !!CHROME_LAYOUTS[name]?.drawOwnSkin;
export const getHabboChromeContentInsets = (name: string) => CHROME_LAYOUTS[name]?.contentInsets;
