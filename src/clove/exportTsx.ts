import { HabboLayoutDefinition, HabboLayoutNode } from '../common/habbo';
import { CloveCustomSkin, customSkinsRegistryExtension } from './customSkins';
import { CloveDocument, CloveNode, flattenNodes } from './model/layoutXml';

export interface CloveTsxExport
{
    componentName: string;
    fileBase: string;
    tsx: string;
    slots: string[];
    slotGuide: string;
}

export interface CloveEmbeddedAsset
{
    nodeId: string;
    assetName: string;
    dataUrl: string;
}

export interface CloveTsxExportOptions
{
    componentName?: string;
    fileBase?: string;
    rootClassName?: string;
    banner?: string;
}

const componentNameOf = (name: string) =>
{
    const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
    const base = words.map(word => `${ word.charAt(0).toUpperCase() }${ word.slice(1) }`).join('') || 'HabboWindow';

    return `${ /^\d/.test(base) ? `Layout${ base }` : base }View`;
};

const classNameOf = (name: string) => `generated-${ name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9-]+/g, '-').toLowerCase() }`;

const runtimeNode = (node: CloveNode, embeddedAssetKeys: Map<string, string>): HabboLayoutNode => ({
    id: node.id,
    type: node.type,
    attributes: { ...node.attributes },
    variables: node.variables.map(variable => variable.key === 'asset_uri' && embeddedAssetKeys.has(node.id) ? { ...variable, value: embeddedAssetKeys.get(node.id)! } : { ...variable }),
    children: node.children.map(child => runtimeNode(child, embeddedAssetKeys)),
    ...(node.editorSkin ? { editorSkin: { ...node.editorSkin }} : {})
});

const toHabboLayoutDefinition = (document: CloveDocument, embeddedAssetKeys = new Map<string, string>()): HabboLayoutDefinition => ({
    name: document.name,
    width: document.width,
    height: document.height,
    nodes: document.nodes.map(node => runtimeNode(node, embeddedAssetKeys))
});

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

const slotNamesOf = (document: CloveDocument) => Array.from(new Set(flattenNodes(document.nodes).flatMap(node => [
    node.attributes.name,
    node.attributes.id,
    ...(node.attributes.tags || '').split(/[\s,]+/)
]).filter(Boolean).map(decodeSlotName))).sort((left, right) => left.localeCompare(right));

export const generateCloveTsxExport = (document: CloveDocument, customSkins: CloveCustomSkin[] = [], embeddedAssets: CloveEmbeddedAsset[] = [], options: CloveTsxExportOptions = {}): CloveTsxExport =>
{
    const componentName = options.componentName || componentNameOf(document.name);
    const fileBase = options.fileBase || componentName;
    const rootClassName = options.rootClassName || classNameOf(componentName);
    const embeddedAssetKeys = new Map(embeddedAssets.map((asset, index) => [ asset.nodeId, `clove-export:${ componentName }:${ index }` ]));
    const layout = toHabboLayoutDefinition(document, embeddedAssetKeys);
    const slots = slotNamesOf(document);
    const referencedSkinIds = new Set(flattenNodes(document.nodes).map(node => node.editorSkin?.registryId).filter(Boolean));
    const referencedCustomSkins = customSkins.filter(skin => referencedSkinIds.has(skin.id));
    const customSkinExtension = referencedCustomSkins.length ? customSkinsRegistryExtension(referencedCustomSkins) : null;
    const embeddedAssetUrls = Object.fromEntries(embeddedAssets.map((asset, index) => [ `clove-export:${ componentName }:${ index }`, asset.dataUrl ]));
    const registryExtension = customSkinExtension || embeddedAssets.length ? {
        assets: { ...(customSkinExtension?.assets || {}), ...embeddedAssetUrls },
        skins: { ...(customSkinExtension?.skins || {}) }
    } : null;
    const slotType = slots.length ? slots.map(name => JSON.stringify(name)).join(' | ') : 'never';
    const nodes = flattenNodes(document.nodes);
    const slotGuide = [
        `# ${ componentName } slot mapping`,
        '',
        '| Slot | XML node type | Wiring |',
        '| --- | --- | --- |',
        ...slots.map(name =>
        {
            const node = nodes.find(candidate => [ candidate.attributes.name, candidate.attributes.id, ...(candidate.attributes.tags || '').split(/[\s,]+/) ].filter(Boolean).map(decodeSlotName).includes(name));
            const wiring = /(?:itemgrid|widget|bitmap)/.test(node?.type || '') ? 'Pass rendered runtime content through `slots`.'
                : /(?:empty|loading)_container/i.test(name) ? 'Toggle with `visibility`; optionally pass replacement content through `slots`.'
                    : /\.options$/.test(name) ? 'Pass real option controls through `slots`.' : 'Pass replacement content through `slots`, or handle actions with `onAction`.';

            return `| \`${ name.replaceAll('|', '\\|') }\` | \`${ node?.type || 'unknown' }\` | ${ wiring } |`;
        }),
        '',
        'Tabs report through `onTabChange(contextName, tabName)`. Captions default to `LocalizeText` and can be overridden with `resolveCaption`.',
        ''
    ].join('\n');
    const layoutJson = JSON.stringify(layout, null, 4);
    const registryImports = registryExtension ? ', setSkinRegistryExtension, SkinRegistryExtension' : '';
    const registrySetup = registryExtension ? `
const registryExtension: SkinRegistryExtension = ${ JSON.stringify(registryExtension, null, 4) };

setSkinRegistryExtension(${ JSON.stringify(componentName) }, registryExtension);
` : '';
    const banner = options.banner ? `${ options.banner.trim() }\n` : '';
    const tsx = `${ banner }/* eslint-disable quotes */
import { FC, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { LocalizeText } from '@/api';
import { HabboLayoutDefinition, HabboLayoutView${ registryImports } } from '@/common/habbo';

export type ${ componentName }Slot = ${ slotType };

export interface ${ componentName }Props
{
    className?: string;
    slots?: Partial<Record<${ componentName }Slot, ReactNode>>;
    visibility?: Partial<Record<${ componentName }Slot, boolean>>;
    captions?: Partial<Record<${ componentName }Slot, string>>;
    itemListOrder?: Partial<Record<${ componentName }Slot, ${ componentName }Slot[]>>;
    initialActiveTabs?: Record<string, string>;
    resolveCaption?: (caption: string) => string;
    onAction?: (name: string, event: ReactMouseEvent<HTMLElement>) => void;
    onTabChange?: (contextName: string, tabName: string) => void;
    onClose?: () => void;
}

const layout: HabboLayoutDefinition = ${ layoutJson };
${ registrySetup }
const localizeCaption = (caption: string) => caption.replace(/\\$\\{([^}]+)\\}/g, (_match, key: string) => LocalizeText(key));

export const ${ componentName }: FC<${ componentName }Props> = props =>
{
    const { className = '', slots = {}, visibility = {}, captions = {}, itemListOrder = {}, initialActiveTabs = {}, resolveCaption = localizeCaption, onAction, onTabChange, onClose } = props;

    return <HabboLayoutView
        layout={ layout }
        className={ \`${ rootClassName } \${ className }\` }
        slots={ slots }
        visibility={ visibility }
        captions={ captions }
        itemListOrder={ itemListOrder }
        initialActiveTabs={ initialActiveTabs }
        resolveCaption={ resolveCaption }
        onAction={ onAction }
        onTabChange={ onTabChange }
        onClose={ onClose } />;
};
`;

    return { componentName, fileBase, tsx, slots, slotGuide };
};
