import { HABBO_CSS_STYLE_NAMES, HABBO_STYLES } from 'truffle-text';
import { ChangeEvent, CSSProperties, DragEvent, FC, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { getCloveSkinRegistry, getHabboLayoutGeometry, getSkinRegistryAssetUrl, setSkinRegistryExtension, SkinRegistryView } from '../common/habbo';
import { warmCloveTruffle } from '../truffle';
import { CloveNodeView, CloveSnapGuides } from './CloveNodeView';
import {
    addNode, canHaveChildren, cloneNode, CloveDocument, CloveNode, CloveNodeDropPosition, copyNodeAsNew, createNewDocument, displayCaption, encodeCaption, findNode, findParentNode,
    flattenNodes, moveNode, NewCloveNode, parseLayoutXml, removeNode, removeNodeVariables, serializeLayoutXml, updateNodeAttributes, updateNodeVariables
} from './model/layoutXml';
import { catalogSkinGeometry, CLOVE_THEMES, CloveTheme, WidgetDefinition, WIDGET_CATALOG } from './widgetCatalog';
import { CloveNodeSimulation, CloveProjectScenario, CloveSimulationData, loadCloveSimulationData } from './simulation';
import { CloveEmbeddedAsset, generateCloveTsxExport } from './exportTsx';
import { CloveCustomSkin, customSkinsRegistryExtension, normalizeCustomSkin } from './customSkins';
import { CloveCustomSkinFile, CustomSkinImportDialog } from './CustomSkinImportDialog';
import { HabboSelect } from './HabboSelect';
import { HabboButton, HabboCheckbox, HabboChromeButton, HabboInput, HabboScrollArea, HabboText, UbuntuWindow } from './HabboUi';
import { CLOVE_ASSET_CATALOG, cloveAssetDataUrl, cloveAssetFallbackImageUrl, cloveAssetImageUrl, CloveAssetImage, getCloveAssetImage, resolveCloveAsset } from './assetCatalog';
import { LazyWidgetCard } from './CloveLibrary';
import { CloveToolbar } from './CloveToolbar';
import { CloveHierarchy, visibleTreeNodeIds } from './CloveHierarchy';
import { ColorVariableField, PropertyField, SectionHeading } from './CloveInspector';
import { CloveStage } from './CloveStage';
import './CloveApp.scss';

type LibraryKind = 'controls' | 'images';
type LibraryFamily = 'all' | CloveTheme;
const BASIC_PROPERTIES = [ 'name', 'caption', 'tags', 'id', 'intent', 'style', 'params', 'visible' ];
const GEOMETRY_PROPERTIES = [ 'x', 'y', 'width', 'width_min', 'width_max', 'height', 'height_min', 'height_max' ];
const MAX_CUSTOM_SKIN_BYTES = 10 * 1024 * 1024;
const MAX_CUSTOM_SKIN_DIMENSION = 4096;
const ASSET_PAGE_SIZE = 120;
const manifestLabel = (component: string) => component.split('.').pop()?.replace(/(?:Component)?Bootstrap$/, '') || component;
const updateHeadline = (status: CloveUpdateStatus) =>
{
    if(status.phase === 'checking') return 'Checking for a newer Clove';
    if(status.phase === 'downloading') return `Clove ${ status.version || '' } is downloading`;
    if(status.phase === 'current') return 'Clove is up to date';
    if(status.phase === 'ready') return `Clove ${ status.version || '' } is ready`;
    if(status.phase === 'installing') return `Installing Clove ${ status.version || '' }`;
    if(status.phase === 'error') return 'Clove could not check for updates';

    return 'Clove updates';
};
const updateDetail = (status: CloveUpdateStatus, installingDots = 3) =>
{
    if(status.phase === 'checking') return 'This normally takes only a moment. You can keep editing while Clove checks.';
    if(status.phase === 'downloading') return 'The update is downloading in the background. Keep Clove open; you can continue editing normally.';
    if(status.phase === 'current') return `You are running the newest version, Clove ${ status.currentVersion }.`;
    if(status.phase === 'ready') return 'The update may take a few moments, Clove will reopen when finished';
    if(status.phase === 'installing') return `Updating${ '.'.repeat(Math.max(1, Math.min(3, installingDots))) }`;
    if(status.phase === 'error') return status.message || 'Check your internet connection and try again.';

    return '';
};

interface HistoryState
{
    past: CloveDocument[];
    present: CloveDocument;
    future: CloveDocument[];
}

interface CloveProjectFile
{
    format: 'clove-project';
    version: 1 | 2 | 3 | 4;
    layoutXml: string;
    activeScenario: string;
    editorSkins: Record<string, { registryId: string; layout: string }>;
    editorAssets?: Record<string, string>;
    nodeSimulation: Record<string, CloveNodeSimulation>;
    activeTabs?: Record<string, string>;
    projectScenarios?: CloveProjectScenario[];
    customSkins?: CloveCustomSkin[];
}

const download = (name: string, contents: string, type: string) =>
{
    const url = URL.createObjectURL(new Blob([ contents ], { type }));
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};

const downloadUrl = (name: string, url: string) =>
{
    const anchor = window.document.createElement('a');

    anchor.href = url;
    anchor.download = name;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
};

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
    'image/png': '.png',
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
    'image/svg+xml': '.svg',
    'image/avif': '.avif'
};
const imageDataUrlMime = (value: string) => value.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,/)?.[1].toLowerCase() || '';
const imageMimeForFileName = (value: string) => Object.entries(IMAGE_EXTENSION_BY_MIME).find(([ , extension ]) => value.toLowerCase().endsWith(extension))?.[0] || '';
const safeExportFileName = (value: string, dataUrl: string) =>
{
    const fileName = (String(value || 'imported').split(/[\\/]/).pop() || 'imported').replace(/[<>:"|?*\x00-\x1f]/g, '_').slice(0, 160) || 'imported';

    return /\.(?:png|gif|jpe?g|webp|bmp|ico|svg|avif)$/i.test(fileName) ? fileName : `${ fileName }${ IMAGE_EXTENSION_BY_MIME[imageDataUrlMime(dataUrl)] || '.png' }`;
};

const nodeLabel = (node: CloveNode) => node.attributes.name || displayCaption(node.attributes.caption) || 'unnamed';
const documentLabel = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
const largestRootSize = (document: CloveDocument) =>
{
    const root = [ ...document.nodes ].sort((left, right) => Number(right.attributes.width || 0) * Number(right.attributes.height || 0) - Number(left.attributes.width || 0) * Number(left.attributes.height || 0))[0];

    return root ? { width: Math.max(1, Number(root.attributes.width || document.width)), height: Math.max(1, Number(root.attributes.height || document.height)) } : { width: document.width, height: document.height };
};
const variableValue = (node: CloveNode, key: string, fallback = '') => node.variables.find(variable => variable.key === key)?.value ?? fallback;
const finiteLayoutNumber = (value: unknown, fallback = 0) =>
{
    const parsed = Number(value);

    return value !== '' && Number.isFinite(parsed) ? parsed : fallback;
};
const absoluteNodePosition = (nodes: CloveNode[], id: string, origin = { x: 0, y: 0 }): { x: number; y: number } | null =>
{
    for(const node of nodes)
    {
        const position = {
            x: origin.x + finiteLayoutNumber(node.attributes.x),
            y: origin.y + finiteLayoutNumber(node.attributes.y)
        };

        if(node.id === id) return position;

        const found = absoluteNodePosition(node.children, id, {
            x: position.x + finiteLayoutNumber(variableValue(node, 'margin_left')),
            y: position.y + finiteLayoutNumber(variableValue(node, 'margin_top'))
        });

        if(found) return found;
    }

    return null;
};
const parentContentOrigin = (document: CloveDocument, parentId: string) =>
{
    if(!parentId) return { x: 0, y: 0 };

    const parent = findNode(document, parentId);
    const position = absoluteNodePosition(document.nodes, parentId);

    if(!parent || !position) return { x: 0, y: 0 };

    return {
        x: position.x + finiteLayoutNumber(variableValue(parent, 'margin_left')),
        y: position.y + finiteLayoutNumber(variableValue(parent, 'margin_top'))
    };
};
const skinFamily = (id: string): CloveTheme => id.includes('illumina_dark') ? 'illumina-dark'
    : id.includes('illumina_purple') ? 'illumina-purple'
        : id.includes('illumina') ? 'illumina-light'
            : (id.includes('ubuntu') || /_3(?:_|$)/.test(id)) ? 'ubuntu' : 'blue';
const restoreEditorMetadata = (nodes: CloveNode[], skins: CloveProjectFile['editorSkins'], assets: CloveProjectFile['editorAssets'] = {}): CloveNode[] => nodes.map(node => ({
    ...node,
    editorSkin: skins[node.id] ? { ...skins[node.id] } : node.editorSkin,
    editorAssetId: assets[node.id] || node.editorAssetId,
    children: restoreEditorMetadata(node.children, skins, assets)
}));
const nodesWithSerializedPaths = (nodes: CloveNode[], parentPath: number[] = []): { node: CloveNode; path: string }[] => nodes.flatMap((node, index) =>
{
    const path = [ ...parentPath, index ];

    return [ { node, path: path.join('.') }, ...nodesWithSerializedPaths(node.children, path) ];
});
const mergeSimulation = (current: Record<string, CloveNodeSimulation>, id: string, values: Partial<CloveNodeSimulation>) =>
{
    const nextValue = Object.fromEntries(Object.entries({ ...current[id], ...values }).filter(([ , value ]) => value !== undefined)) as CloveNodeSimulation;
    const next = { ...current };

    if(Object.keys(nextValue).length) next[id] = nextValue;
    else delete next[id];

    return next;
};

export const CloveApp: FC = () =>
{
    const [ history, setHistory ] = useState<HistoryState>(() => ({ past: [], present: createNewDocument(), future: [] }));
    const [ selectedIds, setSelectedIds ] = useState<string[]>([ '0' ]);
    const [ collapsedTreeIds, setCollapsedTreeIds ] = useState<Set<string>>(() => new Set());
    const [ error, setError ] = useState('');
    const [ snap, setSnap ] = useState(1);
    const [ zoom, setZoom ] = useState(1);
    const [ debugRects, setDebugRects ] = useState(false);
    const [ theme, setTheme ] = useState<CloveTheme>('ubuntu');
    const [ mode, setMode ] = useState<'edit' | 'preview'>('edit');
    const [ activeTabs, setActiveTabs ] = useState<Record<string, string>>({});
    const [ libraryKind, setLibraryKind ] = useState<LibraryKind>('controls');
    const [ libraryFamily, setLibraryFamily ] = useState<LibraryFamily>('all');
    const [ assetPackage, setAssetPackage ] = useState('all');
    const [ assetLimit, setAssetLimit ] = useState(ASSET_PAGE_SIZE);
    const [ controlLibrarySearch, setControlLibrarySearch ] = useState('');
    const [ imageLibrarySearch, setImageLibrarySearch ] = useState('');
    const [ newDialogOpen, setNewDialogOpen ] = useState(false);
    const [ clipboard, setClipboard ] = useState<NewCloveNode | null>(null);
    const [ resolveLocalization, setResolveLocalization ] = useState(false);
    const [ simulationData, setSimulationData ] = useState<CloveSimulationData>({ externalTexts: {}});
    const [ simulationError, setSimulationError ] = useState('');
    const [ nodeSimulation, setNodeSimulation ] = useState<Record<string, CloveNodeSimulation>>({});
    const [ marquee, setMarquee ] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
    const [ snapGuides, setSnapGuides ] = useState<CloveSnapGuides | null>(null);
    const [ exportingScreenshot, setExportingScreenshot ] = useState(false);
    const [ exportingTsx, setExportingTsx ] = useState(false);
    const [ customSkins, setCustomSkins ] = useState<CloveCustomSkin[]>([]);
    const [ customSkinFile, setCustomSkinFile ] = useState<CloveCustomSkinFile | null>(null);
    const [ truffleReady, setTruffleReady ] = useState(false);
    const [ updateStatus, setUpdateStatus ] = useState<CloveUpdateStatus>({ phase: 'idle', currentVersion: '' });
    const [ updateDialogOpen, setUpdateDialogOpen ] = useState(false);
    const [ installingDots, setInstallingDots ] = useState(1);
    const [ newDocumentForm, setNewDocumentForm ] = useState({ name: 'new_window', width: 420, height: 280 });
    const fileInputRef = useRef<HTMLInputElement>(null);
    const projectInputRef = useRef<HTMLInputElement>(null);
    const skinInputRef = useRef<HTMLInputElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const libraryViewportRef = useRef<HTMLDivElement>(null);
    const libraryScrollPositionsRef = useRef<Record<LibraryKind, { top: number; left: number }>>({ controls: { top: 0, left: 0 }, images: { top: 0, left: 0 }});
    const coalescedCommitRef = useRef({ key: '', time: 0 });
    const hierarchySelectionAnchorRef = useRef('');
    const registry = getCloveSkinRegistry();
    const document = history.present;
    const hierarchyVisibleIds = useMemo(() => visibleTreeNodeIds(document.nodes, collapsedTreeIds), [ collapsedTreeIds, document.nodes ]);
    const hierarchyRowIndices = useMemo(() => Object.fromEntries(hierarchyVisibleIds.map((id, index) => [ id, index ])), [ hierarchyVisibleIds ]);
    const rootSize = largestRootSize(document);
    const stageWidth = Math.max(960, rootSize.width + 400);
    const stageHeight = Math.max(640, rootSize.height + 300);
    const selectedNodes = selectedIds.map(id => findNode(document, id)).filter((node): node is CloveNode => node !== null);
    const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
    const selectedAbsolutePosition = selectedNode ? absoluteNodePosition(document.nodes, selectedNode.id) : null;
    const selectedRotation = selectedNode ? ((Number(selectedNode.attributes.rotation || 0) % 360) + 360) % 360 : 0;
    const allNodes = useMemo(() => flattenNodes(document.nodes), [ document.nodes ]);
    const assetManifests = useMemo(() => CLOVE_ASSET_CATALOG.manifests.filter(manifest => manifest.imageCount > 0).sort((left, right) => left.component.localeCompare(right.component)), []);
    const unmappedAssetCount = useMemo(() => CLOVE_ASSET_CATALOG.images.filter(image => !image.packages.length).length, []);
    const effectiveNodeSimulation = nodeSimulation;
    const selectedSimulation = selectedNode ? effectiveNodeSimulation[selectedNode.id] || {} : {};
    const librarySearch = libraryKind === 'controls' ? controlLibrarySearch : imageLibrarySearch;
    const resolveCaption = useCallback((caption: string) =>
    {
        if(mode !== 'preview' && !resolveLocalization) return caption;

        const match = caption.match(/^\$\{(.+)\}$/);

        if(!match) return caption;

        return simulationData.externalTexts[match[1]] || match[1];
    }, [ mode, resolveLocalization, simulationData.externalTexts ]);
    const tabState = useMemo(() =>
    {
        const resolvedActiveTabs = { ...activeTabs };
        const hiddenNodeIds = new Set<string>();
        const forcedVisibleNodeIds = new Set<string>();
        const geometryOverrides: Record<string, Partial<CSSProperties>> = {};

        for(const context of allNodes.filter(node => node.type === 'tab_context'))
        {
            const tabs = context.children.filter(child => child.type === 'tab_container_button');
            const hiddenTabs = new Set<string>();

            for(const tab of tabs) if(effectiveNodeSimulation[tab.id]?.visible === false) hiddenTabs.add(tab.attributes.name);

            const tabNames = tabs.map(child => child.attributes.name).filter(name => !!name && !hiddenTabs.has(name));
            const pages = allNodes.filter(node => node.type !== 'tab_container_button' && tabNames.includes(node.attributes.name));
            const requestedActiveTab = tabNames.includes(activeTabs[context.id]) ? activeTabs[context.id] : '';
            const activeName = requestedActiveTab || pages.find(page => page.attributes.visible !== 'false')?.attributes.name || tabNames[0];
            let tabX = 0;

            for(const tab of tabs)
            {
                if(hiddenTabs.has(tab.attributes.name)) hiddenNodeIds.add(tab.id);
                else if(mode !== 'preview')
                {
                    geometryOverrides[tab.id] = { left: tabX };
                    tabX += Number(tab.attributes.width || 0);
                }
            }

            if(!activeName) continue;

            resolvedActiveTabs[context.id] = activeName;

            for(const page of pages)
            {
                if(page.attributes.name === activeName) forcedVisibleNodeIds.add(page.id);
                else hiddenNodeIds.add(page.id);
            }
        }

        for(const node of allNodes)
        {
            if(effectiveNodeSimulation[node.id]?.visible === true)
            {
                hiddenNodeIds.delete(node.id);
                forcedVisibleNodeIds.add(node.id);
            }
            else if(effectiveNodeSimulation[node.id]?.visible === false)
            {
                forcedVisibleNodeIds.delete(node.id);
                hiddenNodeIds.add(node.id);
            }

        }

        if(mode === 'preview')
        {
            const captions = Object.fromEntries(allNodes
                .filter(node => effectiveNodeSimulation[node.id]?.caption !== undefined)
                .map(node => [ node.id, effectiveNodeSimulation[node.id].caption ]));
            const layoutGeometry = getHabboLayoutGeometry(document.nodes, {
                captions,
                resolveCaption,
                isVisible: node => !hiddenNodeIds.has(node.id) && (node.attributes.visible !== 'false' || forcedVisibleNodeIds.has(node.id))
            });

            for(const [ id, geometry ] of Object.entries(layoutGeometry))
            {
                geometryOverrides[id] = { left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height };
            }
        }

        for(const node of allNodes)
        {
            if(effectiveNodeSimulation[node.id]?.geometry) geometryOverrides[node.id] = { ...geometryOverrides[node.id], ...effectiveNodeSimulation[node.id].geometry };
        }

        return { resolvedActiveTabs, hiddenNodeIds, forcedVisibleNodeIds, geometryOverrides };
    }, [ activeTabs, allNodes, document.nodes, effectiveNodeSimulation, mode, resolveCaption ]);

    const widgetItems = useMemo(() => WIDGET_CATALOG.filter(item =>
        `${ item.label } ${ item.description }`.toLowerCase().includes(librarySearch.toLowerCase())), [ librarySearch ]);
    const rawSkins = useMemo(() => Object.values(registry.skins).filter(skin =>
        `${ skin.id } ${ skin.name }`.toLowerCase().includes(librarySearch.toLowerCase())), [ librarySearch, registry.skins ]);
    const filteredAssets = useMemo(() =>
    {
        const search = librarySearch.trim().toLowerCase();

        return CLOVE_ASSET_CATALOG.images.filter(image =>
            assetPackage !== 'my-images'
            && (assetPackage === 'all' || (assetPackage === 'unpackaged' ? !image.packages.length : image.packages.includes(assetPackage)))
            && (!search || `${ image.name } ${ image.internalName } ${ image.logicalNames.join(' ') } ${ image.id } ${ image.packages.join(' ') }`.toLowerCase().includes(search)));
    }, [ assetPackage, librarySearch ]);
    const projectAssets = useMemo(() => Object.keys(registry.assets).filter(name =>
    {
        if(!name.startsWith('project:')) return false;

        const customSkin = customSkins.find(skin => skin.assetName === name);

        return `${ name } ${ customSkin?.name || '' } ${ customSkin?.fileName || '' }`.toLowerCase().includes(librarySearch.toLowerCase());
    }), [ customSkins, librarySearch, registry.assets ]);

    useEffect(() => setAssetLimit(ASSET_PAGE_SIZE), [ assetPackage, imageLibrarySearch ]);

    const switchLibraryKind = (nextKind: LibraryKind) =>
    {
        if(nextKind === libraryKind) return;

        const viewport = libraryViewportRef.current;

        if(viewport) libraryScrollPositionsRef.current[libraryKind] = { top: viewport.scrollTop, left: viewport.scrollLeft };
        setLibraryKind(nextKind);
        window.requestAnimationFrame(() =>
        {
            const nextViewport = libraryViewportRef.current;
            const position = libraryScrollPositionsRef.current[nextKind];

            if(nextViewport)
            {
                nextViewport.scrollTop = position.top;
                nextViewport.scrollLeft = position.left;
            }
        });
    };

    useEffect(() =>
    {
        warmCloveTruffle().then(() => setTruffleReady(true)).catch(() => undefined);
    }, []);

    useEffect(() =>
    {
        const desktop = window.cloveDesktop;

        if(!desktop) return;

        desktop.loadImportedSkins().then(inputs =>
        {
            const stored = inputs.map(normalizeCustomSkin).filter((skin): skin is CloveCustomSkin => !!skin);

            setCustomSkins(current =>
            {
                const merged = Array.from(new Map([ ...current, ...stored ].map(skin => [ skin.id, skin ])).values());

                setSkinRegistryExtension('clove-project', customSkinsRegistryExtension(merged));
                return merged;
            });
        }).catch(loadError => setError(`Imported image library could not be loaded: ${ loadError instanceof Error ? loadError.message : String(loadError) }`));
    }, []);

    useEffect(() =>
    {
        const desktop = window.cloveDesktop;

        if(!desktop) return;

        let active = true;
        const receiveStatus = (status: CloveUpdateStatus) =>
        {
            if(!active) return;

            setUpdateStatus(status);
        };
        const unsubscribe = desktop.onUpdateStatus(receiveStatus);

        desktop.getUpdateStatus().then(receiveStatus).catch(() => undefined);

        return () =>
        {
            active = false;
            unsubscribe();
        };
    }, []);

    useEffect(() =>
    {
        if(updateStatus.phase !== 'installing')
        {
            setInstallingDots(1);
            return;
        }

        const interval = window.setInterval(() => setInstallingDots(current => current % 3 + 1), 450);

        return () => window.clearInterval(interval);
    }, [ updateStatus.phase ]);

    useEffect(() =>
    {
        let disposed = false;

        loadCloveSimulationData().then(data =>
        {
            if(disposed) return;
            setSimulationData(data);
            setSimulationError('');
        }).catch(loadError =>
        {
            if(!disposed) setSimulationError(loadError instanceof Error ? loadError.message : String(loadError));
        });

        return () =>
        {
            disposed = true;
        };
    }, []);

    const loadXml = useCallback((xml: string) =>
    {
        try
        {
            const next = parseLayoutXml(xml);

            setHistory({ past: [], present: next, future: [] });
            setCollapsedTreeIds(new Set());
            setSelectedIds(next.nodes[0] ? [ next.nodes[0].id ] : []);
            setMode('edit');
            setActiveTabs({});
            setNodeSimulation({});
            setError('');
        }
        catch(loadError)
        {
            setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
    }, []);

    const commit = useCallback((next: CloveDocument, coalesceKey = '') =>
    {
        const now = performance.now();
        const shouldCoalesce = !!coalesceKey && coalescedCommitRef.current.key === coalesceKey && now - coalescedCommitRef.current.time < 350;

        coalescedCommitRef.current = { key: coalesceKey, time: now };
        setHistory(current => ({ past: shouldCoalesce ? current.past : [ ...current.past, current.present ], present: next, future: [] }));
    }, []);

    const changeAttributes = useCallback((id: string, attributes: Record<string, string>, coalesceKey = '') =>
    {
        let next = updateNodeAttributes(document, id, attributes);

        if(document.nodes.some(node => node.id === id) && (attributes.width !== undefined || attributes.height !== undefined))
        {
            const size = largestRootSize(next);

            next = { ...next, width: size.width, height: size.height };
        }

        commit(next, coalesceKey);
    }, [ commit, document ]);
    const changeVariable = useCallback((id: string, key: string, value: string, type = 'String', coalesceKey = '') => commit(updateNodeVariables(document, id, { [key]: { value, type }}), coalesceKey), [ commit, document ]);
    const changeTextStyle = useCallback((id: string, value: string) =>
    {
        const styled = updateNodeVariables(document, id, { text_style: { value, type: 'String' }});
        const cleared = removeNodeVariables(styled, id, [ 'font_face', 'font_size', 'bold', 'italic', 'underline', 'spacing', 'leading' ]);

        commit(cleared);
    }, [ commit, document ]);
    const changeSimulation = useCallback((id: string, values: Partial<CloveNodeSimulation>) => setNodeSimulation(current => mergeSimulation(current, id, values)), []);
    const resetSimulation = useCallback((id: string) =>
    {
        setNodeSimulation(current =>
        {
            const next = { ...current };

            delete next[id];

            return next;
        });
    }, []);
    const activateTab = (contextId: string, tabName: string) => setActiveTabs(current => ({ ...current, [contextId]: tabName }));
    const moveSelection = useCallback((ids: string[], deltaX: number, deltaY: number) =>
    {
        let next = document;

        for(const id of ids)
        {
            const node = findNode(next, id);

            if(node) next = updateNodeAttributes(next, id, { x: String(Number(node.attributes.x || 0) + deltaX), y: String(Number(node.attributes.y || 0) + deltaY) });
        }

        commit(next);
    }, [ commit, document ]);

    const selectNode = (id: string, additive = false, range = false) =>
    {
        const node = findNode(document, id);

        if(node?.type === 'tab_container_button')
        {
            const context = findParentNode(document, node.id);

            if(context?.type === 'tab_context') activateTab(context.id, node.attributes.name || node.id);
        }
        else if(node?.attributes.name)
        {
            const context = allNodes.find(item => item.type === 'tab_context' && item.children.some(child => child.type === 'tab_container_button' && child.attributes.name === node.attributes.name));

            if(context) activateTab(context.id, node.attributes.name);
        }

        if(range)
        {
            const anchorId = hierarchySelectionAnchorRef.current || selectedIds[selectedIds.length - 1] || id;
            const anchorIndex = hierarchyVisibleIds.indexOf(anchorId);
            const targetIndex = hierarchyVisibleIds.indexOf(id);

            if(anchorIndex >= 0 && targetIndex >= 0)
            {
                const start = Math.min(anchorIndex, targetIndex);
                const end = Math.max(anchorIndex, targetIndex);
                const rangeIds = hierarchyVisibleIds.slice(start, end + 1);

                setSelectedIds(current => additive ? Array.from(new Set([ ...current, ...rangeIds ])) : rangeIds);
                return;
            }
        }

        hierarchySelectionAnchorRef.current = id;
        setSelectedIds(current => additive
            ? (current.includes(id) ? current.filter(value => value !== id) : [ ...current, id ])
            : [ id ]);
    };

    const pickStageNode = (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        if(mode !== 'edit' || event.button !== 0 || (event.target as HTMLElement).closest('.clove-resize-handle') || !(event.target as HTMLElement).closest('.clove-stage-canvas')) return;

        const stage = stageRef.current;

        if(!stage) return;

        const target = window.document.elementsFromPoint(event.clientX, event.clientY)
            .find((element): element is HTMLElement => element instanceof HTMLElement && stage.contains(element) && element.matches('[data-node-id]'));

        if(!target?.dataset.nodeId) return;

        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        const keepGroupSelected = !additive && selectedIds.length > 1 && selectedIds.includes(target.dataset.nodeId);

        if(!keepGroupSelected) selectNode(target.dataset.nodeId, additive);
    };
    const toggleTreeCollapsed = (id: string) => setCollapsedTreeIds(current =>
    {
        const next = new Set(current);

        next.has(id) ? next.delete(id) : next.add(id);

        return next;
    });

    const openFile = (event: ChangeEvent<HTMLInputElement>) =>
    {
        const file = event.target.files?.[0];

        if(file) file.text().then(loadXml);
        event.target.value = '';
    };

    const prepareCustomSkinFile = (fileName: string, dataUrl: string, bytes = 0) =>
    {
        if(!imageDataUrlMime(dataUrl))
        {
            setError('The selected file is not a supported image.');
            return;
        }

        if(bytes > MAX_CUSTOM_SKIN_BYTES)
        {
            setError(`Imported images must be ${ MAX_CUSTOM_SKIN_BYTES / 1024 / 1024 } MB or smaller.`);
            return;
        }

        const image = new Image();

        image.onerror = () => setError('The selected file could not be decoded as an image.');
        image.onload = () =>
        {
            if(!image.naturalWidth || !image.naturalHeight || image.naturalWidth > MAX_CUSTOM_SKIN_DIMENSION || image.naturalHeight > MAX_CUSTOM_SKIN_DIMENSION)
            {
                setError(`Custom skin dimensions must be between 1 and ${ MAX_CUSTOM_SKIN_DIMENSION } pixels per axis.`);
                return;
            }

            setCustomSkinFile({ fileName, dataUrl, width: image.naturalWidth, height: image.naturalHeight });
            setError('');
        };
        image.src = dataUrl;
    };

    const openCustomSkinFile = (event: ChangeEvent<HTMLInputElement>) =>
    {
        const file = event.target.files?.[0];

        event.target.value = '';
        if(!file) return;

        if(file.type && !file.type.startsWith('image/'))
        {
            setError('The selected file is not an image.');
            return;
        }

        if(file.size > MAX_CUSTOM_SKIN_BYTES)
        {
            setError(`Imported images must be ${ MAX_CUSTOM_SKIN_BYTES / 1024 / 1024 } MB or smaller.`);
            return;
        }

        const reader = new FileReader();

        reader.onerror = () => setError('The selected image could not be read.');
        reader.onload = () =>
        {
            let dataUrl = String(reader.result || '');

            if(!imageDataUrlMime(dataUrl))
            {
                const inferredMime = imageMimeForFileName(file.name);

                if(inferredMime) dataUrl = dataUrl.replace(/^data:[^;,]*/, `data:${ inferredMime }`);
            }

            prepareCustomSkinFile(file.name, dataUrl, file.size);
        };
        reader.readAsDataURL(file);
    };

    const loadProject = (contents: string) =>
    {
        try
        {
            const project = JSON.parse(contents) as CloveProjectFile;

            if(project.format !== 'clove-project' || ![ 1, 2, 3, 4 ].includes(project.version) || !project.layoutXml) throw new Error('This is not a supported Clove project file.');

            const projectSkinSources = Array.isArray(project.customSkins) ? project.customSkins : [];
            const projectSkins = projectSkinSources.map(normalizeCustomSkin).filter((skin): skin is CloveCustomSkin => !!skin);

            if(projectSkins.length !== projectSkinSources.length) throw new Error('The project contains an invalid or unsupported custom skin.');

            const storedScenarios = Array.isArray(project.projectScenarios) ? project.projectScenarios : [];
            const restoredScenarios = storedScenarios.filter(item => item && typeof item.id === 'string' && item.id.startsWith('project:') && typeof item.label === 'string' && item.nodeSimulation && item.activeTabs).map(item => ({
                id: item.id,
                label: item.label || 'Untitled scenario',
                description: typeof item.description === 'string' ? item.description : '',
                nodeSimulation: { ...item.nodeSimulation },
                activeTabs: { ...item.activeTabs }
            }));

            if(restoredScenarios.length !== storedScenarios.length || new Set(restoredScenarios.map(item => item.id)).size !== restoredScenarios.length) throw new Error('The project contains an invalid scenario definition.');

            const parsed = parseLayoutXml(project.layoutXml);
            const restored = { ...parsed, nodes: restoreEditorMetadata(parsed.nodes, project.editorSkins || {}, project.editorAssets || {}) };
            const mergedSkins = Array.from(new Map([ ...customSkins, ...projectSkins ].map(skin => [ skin.id, skin ])).values());

            setSkinRegistryExtension('clove-project', customSkinsRegistryExtension(mergedSkins));
            setCustomSkins(mergedSkins);
            setHistory({ past: [], present: restored, future: [] });
            setCollapsedTreeIds(new Set());
            setSelectedIds(restored.nodes[0] ? [ restored.nodes[0].id ] : []);
            const restoredActiveScenario = restoredScenarios.find(item => item.id === project.activeScenario);
            setNodeSimulation({ ...(project.nodeSimulation || {}), ...(restoredActiveScenario?.nodeSimulation || {}) });
            setActiveTabs({ ...(project.activeTabs || {}), ...(restoredActiveScenario?.activeTabs || {}) });
            setMode('edit');
            setError('');
        }
        catch(projectError)
        {
            setError(projectError instanceof Error ? projectError.message : String(projectError));
        }
    };

    const openProject = (event: ChangeEvent<HTMLInputElement>) =>
    {
        const file = event.target.files?.[0];

        if(file) file.text().then(loadProject);

        event.target.value = '';
    };

    const openXmlFromToolbar = async () =>
    {
        if(!window.cloveDesktop)
        {
            fileInputRef.current?.click();
            return;
        }

        try
        {
            const result = await window.cloveDesktop.openText('xml');

            if(result) loadXml(result.contents);
        }
        catch(openError)
        {
            setError(openError instanceof Error ? openError.message : String(openError));
        }
    };
    const openProjectFromToolbar = async () =>
    {
        if(!window.cloveDesktop)
        {
            projectInputRef.current?.click();
            return;
        }

        try
        {
            const result = await window.cloveDesktop.openText('project');

            if(result) loadProject(result.contents);
        }
        catch(openError)
        {
            setError(openError instanceof Error ? openError.message : String(openError));
        }
    };
    const openSkinFromToolbar = async () =>
    {
        if(!window.cloveDesktop)
        {
            skinInputRef.current?.click();
            return;
        }

        try
        {
            const result = await window.cloveDesktop.openImage();

            if(result) prepareCustomSkinFile(result.name, result.dataUrl, result.bytes);
        }
        catch(openError)
        {
            setError(openError instanceof Error ? openError.message : String(openError));
        }
    };

    const prepareExportDocument = (desktopExport: boolean) =>
    {
        const referenced = flattenNodes(document.nodes).flatMap(node =>
        {
            if(node.type !== 'static_bitmap') return [];

            const assetName = variableValue(node, 'asset_uri');
            const skin = customSkins.find(item => item.assetName === assetName);

            return skin ? [ { node, skin } ] : [];
        });

        if(!referenced.length) return { document, importedFiles: [] as Array<{ name: string; dataUrl: string }> };

        const selectedFolder = desktopExport ? './assets/images/clove' : window.prompt('Client asset folder for imported images', './assets/images/clove');

        if(selectedFolder === null) throw new Error('Asset export was cancelled.');

        const folder = selectedFolder.trim().replace(/\/+$/, '');
        let next = document;
        const namesBySkin = new Map<string, string>();
        const filesByName = new Map<string, { name: string; dataUrl: string }>();

        for(const { skin } of referenced)
        {
            if(namesBySkin.has(skin.id)) continue;

            const initialName = safeExportFileName(skin.fileName, skin.dataUrl);
            const extensionIndex = initialName.lastIndexOf('.');
            const baseName = extensionIndex > 0 ? initialName.slice(0, extensionIndex) : initialName;
            const extension = extensionIndex > 0 ? initialName.slice(extensionIndex) : '.png';
            let fileName = initialName;
            let suffix = 2;

            while(filesByName.get(fileName.toLowerCase())?.dataUrl !== undefined && filesByName.get(fileName.toLowerCase())?.dataUrl !== skin.dataUrl) fileName = `${ baseName }-${ suffix++ }${ extension }`;

            namesBySkin.set(skin.id, fileName);
            filesByName.set(fileName.toLowerCase(), { name: fileName, dataUrl: skin.dataUrl });
        }

        for(const { node, skin } of referenced) next = updateNodeVariables(next, node.id, { asset_uri: { value: `${ folder ? `${ folder }/` : '' }${ namesBySkin.get(skin.id) }`, type: 'String' }});

        const importedFiles = Array.from(filesByName.values());

        if(!desktopExport) for(const file of importedFiles) downloadUrl(file.name, file.dataUrl);

        return { document: next, importedFiles };
    };

    const saveProject = async () =>
    {
        try
        {
            const serializedNodes = nodesWithSerializedPaths(document.nodes);
            const pathByNodeId = new Map(serializedNodes.map(item => [ item.node.id, item.path ]));
            const editorSkins: CloveProjectFile['editorSkins'] = Object.fromEntries(serializedNodes.flatMap(item => item.node.editorSkin ? [ [ item.path, item.node.editorSkin ] ] : []));
            const editorAssets: NonNullable<CloveProjectFile['editorAssets']> = Object.fromEntries(serializedNodes.flatMap(item => item.node.editorAssetId ? [ [ item.path, item.node.editorAssetId ] ] : []));
            const serializedSimulation = Object.fromEntries(Object.entries(nodeSimulation).flatMap(([ id, value ]) =>
            {
                const path = pathByNodeId.get(id);

                return path === undefined ? [] : [ [ path, value ] ];
            }));
            const project: CloveProjectFile = {
                format: 'clove-project',
                version: 4,
                layoutXml: serializeLayoutXml(document),
                activeScenario: 'none',
                editorSkins,
                editorAssets,
                nodeSimulation: serializedSimulation,
                activeTabs,
                customSkins: customSkins.filter(skin => allNodes.some(node => node.editorSkin?.registryId === skin.id || variableValue(node, 'asset_uri') === skin.assetName))
            };
            const contents = `${ JSON.stringify(project, null, 2) }\n`;

            if(window.cloveDesktop) await window.cloveDesktop.saveText('project', `${ document.name }.clove.json`, contents);
            else download(`${ document.name }.clove.json`, contents, 'application/json');
            setError('');
        }
        catch(saveError)
        {
            setError(saveError instanceof Error ? saveError.message : String(saveError));
        }
    };

    const saveTsx = async () =>
    {
        setExportingTsx(true);

        try
        {
            const prepared = prepareExportDocument(!!window.cloveDesktop);
            const exportDocument = prepared.document;
            const embeddedNodes = flattenNodes(exportDocument.nodes).filter(node =>
            {
                if(node.type !== 'static_bitmap') return false;

                const assetName = variableValue(node, 'asset_uri');

                return !!assetName && !!resolveCloveAsset(assetName, node.editorAssetId) && (!!node.editorAssetId || !getSkinRegistryAssetUrl(assetName));
            });
            const embeddedAssets: CloveEmbeddedAsset[] = await Promise.all(embeddedNodes.map(async node => ({
                nodeId: node.id,
                assetName: variableValue(node, 'asset_uri'),
                dataUrl: await cloveAssetDataUrl(variableValue(node, 'asset_uri'), node.editorAssetId)
            })));
            const generated = generateCloveTsxExport(exportDocument, customSkins, embeddedAssets);

            if(window.cloveDesktop)
            {
                const saved = await window.cloveDesktop.saveExportBundle({ files: [
                    { path: `${ generated.fileBase }.tsx`, contents: generated.tsx },
                    { path: `${ generated.fileBase }.slots.md`, contents: generated.slotGuide },
                    ...prepared.importedFiles.map(file => ({ path: `assets/images/clove/${ file.name }`, dataUrl: file.dataUrl }))
                ] });

                if(!saved)
                {
                    return;
                }

            }
            else
            {
                download(`${ generated.fileBase }.tsx`, generated.tsx, 'text/typescript');
                download(`${ generated.fileBase }.slots.md`, generated.slotGuide, 'text/markdown');
            }
            setError('');
        }
        catch(exportError)
        {
            setError(`TSX export failed: ${ exportError instanceof Error ? exportError.message : String(exportError) }`);
        }
        finally
        {
            setExportingTsx(false);
        }
    };

    const saveScreenshot = async () =>
    {
        const stage = stageRef.current;

        if(!stage || !document.nodes.length || exportingScreenshot || !truffleReady) return;

        setExportingScreenshot(true);
        setSnapGuides(null);
        stage.classList.add('is-capturing');
        stage.classList.add('is-exporting');
        const originalStageStyle = stage.getAttribute('style') || '';
        const topLevelElements = document.nodes.map(node => stage.querySelector<HTMLElement>(`:scope > [data-node-id="${ CSS.escape(node.id) }"]`)).filter((element): element is HTMLElement => !!element);
        const originalTranslations = topLevelElements.map(element => element.style.translate);

        try
        {
            await window.document.fonts?.ready;
            const stageImages = Array.from(stage.querySelectorAll('img'));

            await Promise.all(stageImages.filter(image => !image.complete).map(image => new Promise<void>(resolve =>
            {
                image.addEventListener('load', () => resolve(), { once: true });
                image.addEventListener('error', () => resolve(), { once: true });
            })));

            const expectedNodes = flattenNodes(document.nodes).length;
            const renderDeadline = performance.now() + 5000;

            while(performance.now() < renderDeadline)
            {
                const renderedNodes = stage.querySelectorAll('.clove-node').length;
                const canvases = Array.from(stage.querySelectorAll('canvas'));
                const painted = canvases.length === 0 || canvases.some(canvas =>
                {
                    try
                    {
                        const context = canvas.getContext('2d', { willReadFrequently: true });
                        const sample = context?.getImageData(0, 0, Math.max(1, Math.min(canvas.width, 64)), Math.max(1, Math.min(canvas.height, 64))).data;

                        return !!sample && sample.some((value, index) => (index % 4) === 3 && value > 0);
                    }
                    catch
                    {
                        return canvas.width > 0 && canvas.height > 0;
                    }
                });

                if(renderedNodes >= expectedNodes && painted) break;
                await new Promise(resolve => window.setTimeout(resolve, 50));
            }

            if(stage.querySelectorAll('.clove-node').length < expectedNodes) throw new Error('The canvas did not finish rendering. Try again after it appears.');
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

            const stageRect = stage.getBoundingClientRect();
            const scaleX = stage.offsetWidth ? stageRect.width / stage.offsetWidth : zoom;
            const scaleY = stage.offsetHeight ? stageRect.height / stage.offsetHeight : zoom;
            const visibleElements = Array.from(stage.querySelectorAll<HTMLElement>('[data-node-id]')).filter(element => element.getClientRects().length > 0);
            const rectangles = visibleElements.map(element => element.getBoundingClientRect());

            if(!rectangles.length) throw new Error('The canvas has no visible objects to export.');

            const exportLeft = Math.floor(Math.min(...rectangles.map(rectangle => (rectangle.left - stageRect.left) / scaleX)));
            const exportTop = Math.floor(Math.min(...rectangles.map(rectangle => (rectangle.top - stageRect.top) / scaleY)));
            const exportRight = Math.ceil(Math.max(...rectangles.map(rectangle => (rectangle.right - stageRect.left) / scaleX)));
            const exportBottom = Math.ceil(Math.max(...rectangles.map(rectangle => (rectangle.bottom - stageRect.top) / scaleY)));
            const exportWidth = Math.max(1, exportRight - exportLeft);
            const exportHeight = Math.max(1, exportBottom - exportTop);

            topLevelElements.forEach(element => element.style.translate = `${ -exportLeft }px ${ -exportTop }px`);
            stage.style.position = 'relative';
            stage.style.left = '0';
            stage.style.top = '0';
            stage.style.width = `${ exportWidth }px`;
            stage.style.height = `${ exportHeight }px`;
            stage.style.transform = 'none';
            stage.style.margin = '0';
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

            const dataUrl = await toPng(stage, {
                cacheBust: true,
                pixelRatio: 1,
                width: exportWidth,
                height: exportHeight,
                style: { position: 'relative', left: '0', top: '0', transform: 'none', transformOrigin: 'top left', margin: '0' },
                filter: element => !(element instanceof HTMLElement) || !element.matches('.clove-resize-handle, .clove-marquee, .clove-snap-guide, .clove-inline-caption')
            });
            if(window.cloveDesktop) await window.cloveDesktop.saveDataUrl(`${ document.name }.png`, dataUrl);
            else
            {
                const blob = await (await fetch(dataUrl)).blob();
                const downloadObjectUrl = URL.createObjectURL(blob);

                downloadUrl(`${ document.name }.png`, downloadObjectUrl);
                window.setTimeout(() => URL.revokeObjectURL(downloadObjectUrl), 1000);
            }
            setError('');
        }
        catch(screenshotError)
        {
            setError(`Screenshot failed: ${ screenshotError instanceof Error ? screenshotError.message : String(screenshotError) }`);
        }
        finally
        {
            stage.classList.remove('is-capturing');
            stage.classList.remove('is-exporting');
            stage.setAttribute('style', originalStageStyle);
            topLevelElements.forEach((element, index) => element.style.translate = originalTranslations[index] || '');
            setExportingScreenshot(false);
        }
    };

    const createDocument = () =>
    {
        const next = createNewDocument(newDocumentForm.name || 'new_window', Math.max(120, newDocumentForm.width), Math.max(80, newDocumentForm.height), theme);

        setHistory({ past: [], present: next, future: [] });
        setCollapsedTreeIds(new Set());
        setSelectedIds([ '0' ]);
        setNodeSimulation({});
        setNewDialogOpen(false);
    };

    const resolveInsertionParent = useCallback((candidateId?: string) =>
    {
        let node = candidateId ? findNode(document, candidateId) : selectedNode;

        while(node && !canHaveChildren(node)) node = findParentNode(document, node.id);

        return node || document.nodes.find(canHaveChildren) || null;
    }, [ document, selectedNode ]);

    const addLibraryNode = (input: NewCloveNode, clientX?: number, clientY?: number, candidateId?: string) =>
    {
        const droppedOnStage = clientX !== undefined && clientY !== undefined && !candidateId;
        const parent = droppedOnStage ? null : resolveInsertionParent(candidateId);
        let x = 18;
        let y = 18;

        if(clientX !== undefined && clientY !== undefined)
        {
            const parentElement = parent ? stageRef.current?.querySelector(`[data-node-id="${ parent.id }"] > .clove-node-children`) as HTMLElement : null;
            const bounds = parentElement?.getBoundingClientRect() || stageRef.current?.getBoundingClientRect();

            if(bounds)
            {
                x = Math.round((clientX - bounds.left) / zoom);
                y = Math.round((clientY - bounds.top) / zoom);
            }
        }

        input.attributes.x = String(Math.max(0, Math.round(x / snap) * snap));
        input.attributes.y = String(Math.max(0, Math.round(y / snap) * snap));

        const result = addNode(document, parent?.id || '', input);

        commit(result.document);
        setSelectedIds([ result.node.id ]);
    };

    const addWidget = (definition: WidgetDefinition, clientX?: number, clientY?: number, candidateId?: string, creationTheme = theme) =>
        addLibraryNode(definition.create(creationTheme), clientX, clientY, candidateId);

    const addRawSkin = (registryId: string, layout: string, clientX?: number, clientY?: number, candidateId?: string, customOverride?: CloveCustomSkin) =>
    {
        const normalized = registryId.toLowerCase();
        const customSkin = customOverride || customSkins.find(skin => skin.id === registryId);
        const family = skinFamily(registryId);
        const style = CLOVE_THEMES.find(item => item.id === family)?.style || '0';
        const type = customSkin?.kind === 'button' ? 'button'
            : customSkin?.kind === 'region' ? 'region'
                : normalized.includes('switch') ? 'checkbox'
                    : normalized.includes('dropmenu') ? 'dropmenu'
                        : normalized.includes('scrollbar') ? 'scrollbar_vertical'
                            : normalized.includes('tab') ? 'tab_container_button'
                                : normalized.includes('button') ? 'button'
                                    : normalized.includes('frame') ? 'frame'
                                        : normalized.includes('border') ? 'border' : 'region';
        const geometry = customSkin ? { width: customSkin.states.default!.width, height: customSkin.states.default!.height, minWidth: 1, minHeight: 1 } : catalogSkinGeometry(registryId, layout);
        const wide = type === 'scrollbar_vertical' ? 17 : geometry.width;
        const tall = type === 'scrollbar_vertical' ? 56 : geometry.height;
        const minWidth = type === 'scrollbar_vertical' ? 17 : geometry.minWidth;
        const minHeight = type === 'scrollbar_vertical' ? 56 : geometry.minHeight;

        addLibraryNode({
            type,
            attributes: { x: '0', y: '0', width: String(wide), height: String(tall), width_min: String(minWidth), height_min: String(minHeight), params: '16', style, name: registryId, ...(normalized.includes('switch') ? { intent: 'switch' } : {}), ...(type === 'button' || type === 'tab_container_button' ? { caption: encodeCaption('New control') } : {}) },
            editorSkin: { registryId, layout }
        }, clientX, clientY, candidateId);
    };

    const registerCustomSkins = (inputs: CloveCustomSkin[]) =>
    {
        const skins = inputs.map(normalizeCustomSkin).filter((skin): skin is CloveCustomSkin => !!skin);

        if(skins.length !== inputs.length)
        {
            setError('One or more imported image regions are invalid.');
            return;
        }

        const next = [ ...customSkins, ...skins ];

        setSkinRegistryExtension('clove-project', customSkinsRegistryExtension(next));
        setCustomSkins(next);
        window.cloveDesktop?.storeImportedSkins(next).catch(storeError => setError(`Imported image library could not be saved: ${ storeError instanceof Error ? storeError.message : String(storeError) }`));
    };
    const createCustomSkins = (inputs: CloveCustomSkin[]) =>
    {
        registerCustomSkins(inputs);
        setCustomSkinFile(null);
        libraryScrollPositionsRef.current.images = { top: 0, left: 0 };
        switchLibraryKind('images');
        setLibraryFamily('all');
        setAssetPackage('my-images');
        setImageLibrarySearch(inputs.length === 1 ? inputs[0].name : inputs[0].name.replace(/\s+1$/, ''));
        setError('');
    };
    const deleteCustomImage = (assetName: string) =>
    {
        const next = customSkins.filter(skin => skin.assetName !== assetName);

        setSkinRegistryExtension('clove-project', customSkinsRegistryExtension(next));
        setCustomSkins(next);
        window.cloveDesktop?.storeImportedSkins(next).catch(storeError => setError(`Imported image library could not be saved: ${ storeError instanceof Error ? storeError.message : String(storeError) }`));
    };

    const addRawAsset = (assetName: string, clientX?: number, clientY?: number, candidateId?: string, asset?: CloveAssetImage) =>
    {
        const customAsset = customSkins.find(skin => skin.assetName === assetName);
        const width = Math.max(1, Math.round(asset?.width || customAsset?.imageWidth || 80));
        const height = Math.max(1, Math.round(asset?.height || customAsset?.imageHeight || 60));

        addLibraryNode({
            type: 'static_bitmap',
            attributes: { x: '0', y: '0', width: String(width), height: String(height), params: '16', style: CLOVE_THEMES.find(item => item.id === theme)?.style || '0', name: assetName },
            variables: [ { key: 'asset_uri', value: assetName, type: 'String' }, { key: 'pivot_point', value: 'center', type: 'String' } ],
            editorAssetId: asset?.id
        }, clientX, clientY, candidateId);
    };

    const dropWidget = (event: DragEvent<HTMLDivElement>) =>
    {
        event.preventDefault();
        event.stopPropagation();
        const candidateId = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
        const widgetPayload = event.dataTransfer.getData('application/x-clove-widget');
        const skinPayload = event.dataTransfer.getData('application/x-clove-skin');
        const assetPayload = event.dataTransfer.getData('application/x-clove-asset');

        if(widgetPayload)
        {
            let parsed: { id: string; theme?: CloveTheme };

            try
            {
                parsed = JSON.parse(widgetPayload);
            }
            catch
            {
                parsed = { id: widgetPayload };
            }

            const definition = WIDGET_CATALOG.find(item => item.id === parsed.id);

            if(definition) addWidget(definition, event.clientX, event.clientY, candidateId, parsed.theme || theme);
            return;
        }

        if(skinPayload)
        {
            const parsed = JSON.parse(skinPayload) as { registryId: string; layout: string };

            addRawSkin(parsed.registryId, parsed.layout, event.clientX, event.clientY, candidateId);
            return;
        }

        if(assetPayload)
        {
            let assetName = assetPayload;
            let asset: CloveAssetImage | null = null;

            try
            {
                const parsed = JSON.parse(assetPayload) as { name?: string; id?: string };

                assetName = parsed.name || assetName;
                asset = parsed.id ? getCloveAssetImage(parsed.id) : null;
            }
            catch
            {
                // Project assets retain the legacy plain-name drag payload.
            }

            addRawAsset(assetName, event.clientX, event.clientY, candidateId, asset || undefined);
        }
    };

    const cloneSelected = useCallback(() =>
    {
        if(!selectedNode) return;

        const result = cloneNode(document, selectedNode.id);

        if(result.node)
        {
            commit(result.document);
            setSelectedIds([ result.node.id ]);
        }
    }, [ commit, document, selectedNode ]);

    const copySelected = useCallback(() =>
    {
        if(selectedNode) setClipboard(copyNodeAsNew(selectedNode));
    }, [ selectedNode ]);

    const cutSelected = useCallback(() =>
    {
        if(!selectedNode) return;

        setClipboard(copyNodeAsNew(selectedNode, 0));
        commit(removeNode(document, selectedNode.id));
        setSelectedIds([]);
    }, [ commit, document, selectedNode ]);

    const pasteClipboard = useCallback(() =>
    {
        if(!clipboard) return;

        const parent = resolveInsertionParent();
        const result = addNode(document, parent?.id || '', clipboard);

        commit(result.document);
        setSelectedIds([ result.node.id ]);
    }, [ clipboard, commit, document, resolveInsertionParent ]);

    const reparentNode = (id: string, targetId: string, position: CloveNodeDropPosition) =>
    {
        const absolutePosition = absoluteNodePosition(document.nodes, id);
        const targetParentId = position === 'root'
            ? ''
            : position === 'inside'
                ? targetId
                : findParentNode(document, targetId)?.id || '';
        let next = moveNode(document, id, targetId, position);

        if(next !== document)
        {
            if(absolutePosition)
            {
                const origin = parentContentOrigin(next, targetParentId);

                next = updateNodeAttributes(next, id, {
                    x: String(Math.round(absolutePosition.x - origin.x)),
                    y: String(Math.round(absolutePosition.y - origin.y))
                });
            }

            commit(next);
            setSelectedIds([ id ]);
        }
    };

    const deleteSelected = useCallback(() =>
    {
        if(!selectedIds.length) return;

        let next = document;

        for(const id of selectedIds) next = removeNode(next, id);

        commit(next);
        setSelectedIds([]);
    }, [ commit, document, selectedIds ]);

    const alignSelection = (action: 'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v' | 'distribute-h' | 'distribute-v' | 'distribute-grid') =>
    {
        if(selectedNodes.length < 2) return;

        let next = document;
        const bounds = selectedNodes.map(node =>
        {
            const position = absoluteNodePosition(document.nodes, node.id) || { x: finiteLayoutNumber(node.attributes.x), y: finiteLayoutNumber(node.attributes.y) };
            const parentId = findParentNode(document, node.id)?.id || '';

            return {
                node,
                x: position.x,
                y: position.y,
                width: Math.max(1, finiteLayoutNumber(node.attributes.width, 1)),
                height: Math.max(1, finiteLayoutNumber(node.attributes.height, 1)),
                parentOrigin: parentContentOrigin(document, parentId)
            };
        });
        const minX = Math.min(...bounds.map(item => item.x));
        const maxX = Math.max(...bounds.map(item => item.x + item.width));
        const minY = Math.min(...bounds.map(item => item.y));
        const maxY = Math.max(...bounds.map(item => item.y + item.height));
        const place = (item: typeof bounds[number], x = item.x, y = item.y) =>
        {
            next = updateNodeAttributes(next, item.node.id, {
                x: String(Math.round(x - item.parentOrigin.x)),
                y: String(Math.round(y - item.parentOrigin.y))
            });
        };

        if(action === 'distribute-grid' && bounds.length >= 4)
        {
            const columns = Math.ceil(Math.sqrt(bounds.length));
            const rows = Math.ceil(bounds.length / columns);
            const cellWidth = Math.max(...bounds.map(item => item.width));
            const cellHeight = Math.max(...bounds.map(item => item.height));
            const gapX = columns > 1 ? Math.max(0, (maxX - minX - columns * cellWidth) / (columns - 1)) : 0;
            const gapY = rows > 1 ? Math.max(0, (maxY - minY - rows * cellHeight) / (rows - 1)) : 0;
            const ordered = [ ...bounds ].sort((left, right) => (left.y + left.height / 2) - (right.y + right.height / 2) || (left.x + left.width / 2) - (right.x + right.width / 2));

            ordered.forEach((item, index) =>
            {
                const row = Math.floor(index / columns);
                const column = index % columns;
                const itemsInRow = Math.min(columns, ordered.length - row * columns);
                const rowOffset = (columns - itemsInRow) * (cellWidth + gapX) / 2;
                const x = minX + rowOffset + column * (cellWidth + gapX) + (cellWidth - item.width) / 2;
                const y = minY + row * (cellHeight + gapY) + (cellHeight - item.height) / 2;

                place(item, x, y);
            });
        }
        else if(action.startsWith('distribute') && bounds.length >= 3)
        {
            const horizontal = action === 'distribute-h';
            const sorted = [ ...bounds ].sort((a, b) => horizontal ? a.x - b.x : a.y - b.y);
            const first = sorted[0]!;
            const last = sorted[sorted.length - 1]!;
            const totalSize = sorted.reduce((sum, item) => sum + (horizontal ? item.width : item.height), 0);
            const span = horizontal ? (last.x + last.width - first.x) : (last.y + last.height - first.y);
            const gap = (span - totalSize) / (sorted.length - 1);
            let cursor = horizontal ? first.x : first.y;

            for(const item of sorted)
            {
                place(item, horizontal ? cursor : item.x, horizontal ? item.y : cursor);
                cursor += (horizontal ? item.width : item.height) + gap;
            }
        }
        else
        {
            for(const item of bounds)
            {
                const x = action === 'left' ? minX
                    : action === 'right' ? maxX - item.width
                        : action === 'center-h' ? (minX + maxX - item.width) / 2 : item.x;
                const y = action === 'top' ? minY
                    : action === 'bottom' ? maxY - item.height
                        : action === 'center-v' ? (minY + maxY - item.height) / 2 : item.y;

                place(item, x, y);
            }
        }

        commit(next);
    };

    const beginMarquee = (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        if(mode !== 'edit' || event.button !== 0 || (event.target as HTMLElement).closest('[data-node-id], .clove-resize-handle')) return;

        const scroller = event.currentTarget;
        const scrollerBounds = scroller.getBoundingClientRect();
        const pointerId = event.pointerId;
        const clampX = (clientX: number) => Math.max(scrollerBounds.left, Math.min(scrollerBounds.right, clientX));
        const clampY = (clientY: number) => Math.max(scrollerBounds.top, Math.min(scrollerBounds.bottom, clientY));
        const startX = clampX(event.clientX);
        const startY = clampY(event.clientY);

        event.preventDefault();
        scroller.setPointerCapture(pointerId);
        setSelectedIds([]);
        setMarquee({ left: startX, top: startY, width: 0, height: 0 });

        const move = (moveEvent: PointerEvent) =>
        {
            const currentX = clampX(moveEvent.clientX);
            const currentY = clampY(moveEvent.clientY);

            setMarquee({ left: Math.min(startX, currentX), top: Math.min(startY, currentY), width: Math.abs(currentX - startX), height: Math.abs(currentY - startY) });
        };
        const cleanup = () =>
        {
            setMarquee(null);
            scroller.removeEventListener('pointermove', move);
            scroller.removeEventListener('pointerup', end);
            scroller.removeEventListener('pointercancel', cancel);
            if(scroller.hasPointerCapture(pointerId)) scroller.releasePointerCapture(pointerId);
        };
        const cancel = () => cleanup();
        const end = (upEvent: PointerEvent) =>
        {
            const endX = clampX(upEvent.clientX);
            const endY = clampY(upEvent.clientY);
            const left = Math.min(startX, endX);
            const top = Math.min(startY, endY);
            const right = Math.max(startX, endX);
            const bottom = Math.max(startY, endY);
            const ids = Array.from(stageRef.current?.querySelectorAll<HTMLElement>('[data-node-id]') || []).filter(element =>
            {
                const bounds = element.getBoundingClientRect();

                return bounds.width > 0 && bounds.height > 0 && bounds.right >= left && bounds.left <= right && bounds.bottom >= top && bounds.top <= bottom;
            }).map(element => element.dataset.nodeId).filter((id, index, ids) => !!id && ids.indexOf(id) === index);

            setSelectedIds(Math.abs(endX - startX) > 2 || Math.abs(endY - startY) > 2 ? ids as string[] : []);
            cleanup();
        };

        scroller.addEventListener('pointermove', move);
        scroller.addEventListener('pointerup', end);
        scroller.addEventListener('pointercancel', cancel);
    };

    const undo = useCallback(() => setHistory(current => current.past.length ? {
        past: current.past.slice(0, -1), present: current.past[current.past.length - 1], future: [ current.present, ...current.future ]
    } : current), []);
    const redo = useCallback(() => setHistory(current => current.future.length ? {
        past: [ ...current.past, current.present ], present: current.future[0], future: current.future.slice(1)
    } : current), []);

    useEffect(() =>
    {
        const onKeyDown = (event: KeyboardEvent) =>
        {
            const inputFocused = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;

            if((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z')
            {
                event.preventDefault();
                event.shiftKey ? redo() : undo();
            }
            else if((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y')
            {
                event.preventDefault();
                redo();
            }
            else if((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && !inputFocused)
            {
                event.preventDefault();
                copySelected();
            }
            else if((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x' && !inputFocused)
            {
                event.preventDefault();
                cutSelected();
            }
            else if((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && !inputFocused)
            {
                event.preventDefault();
                pasteClipboard();
            }
            else if((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && !inputFocused)
            {
                event.preventDefault();
                cloneSelected();
            }
            else if(!inputFocused && (event.key === 'Delete' || event.key === 'Backspace'))
            {
                event.preventDefault();
                deleteSelected();
            }
            else if(!inputFocused && event.key === 'Escape' && selectedNodes.length)
            {
                event.preventDefault();
                const parent = findParentNode(document, selectedNodes[0]!.id);

                if(parent) setSelectedIds([ parent.id ]);
            }
            else if(!inputFocused && selectedNodes.length && [ 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown' ].includes(event.key))
            {
                event.preventDefault();
                const amount = event.shiftKey ? 10 : 1;
                let next = document;

                for(const node of selectedNodes)
                {
                    const x = Number(node.attributes.x || 0) + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0);
                    const y = Number(node.attributes.y || 0) + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0);

                    next = updateNodeAttributes(next, node.id, { x: String(x), y: String(y) });
                }

                commit(next, `nudge:${ selectedIds.join(',') }`);
            }
        };

        window.addEventListener('keydown', onKeyDown);

        return () => window.removeEventListener('keydown', onKeyDown);
    }, [ cloneSelected, commit, copySelected, cutSelected, deleteSelected, document, pasteClipboard, redo, selectedIds, selectedNodes, undo ]);

    return (
        <main className="clove-app">
            <CloveToolbar meta={ `${ documentLabel(document.name) } ${ rootSize.width } × ${ rootSize.height }` } selectedCount={ selectedNodes.length } fileInputRef={ fileInputRef } projectInputRef={ projectInputRef } skinInputRef={ skinInputRef } onOpenFile={ openFile } onOpenProject={ openProject } onOpenSkin={ openCustomSkinFile } onOpenXmlClick={ openXmlFromToolbar } onOpenProjectClick={ openProjectFromToolbar } onOpenSkinClick={ openSkinFromToolbar } onNew={ () => setNewDialogOpen(true) } onSaveTsx={ saveTsx } onSaveProject={ saveProject } onSavePng={ saveScreenshot } exportingTsx={ exportingTsx } exportingPng={ exportingScreenshot } pngReady={ truffleReady } canUndo={ !!history.past.length } canRedo={ !!history.future.length } onUndo={ undo } onRedo={ redo } onDelete={ deleteSelected } mode={ mode } onMode={ nextMode =>
            {
                setMode(nextMode);
                if(nextMode === 'preview') setSelectedIds([]);
            } } snap={ snap } onSnap={ setSnap } zoom={ zoom } onZoom={ setZoom } debugRects={ debugRects } onDebugRects={ setDebugRects } resolveLocalization={ resolveLocalization } onResolveLocalization={ setResolveLocalization } onAlign={ alignSelection } updateStatus={ updateStatus } onUpdateClick={ () => setUpdateDialogOpen(true) } />
            { error && <div className="clove-error" role="alert"><HabboText format={ HABBO_STYLES.u_bold } color={ 0xFFFFFF }>{ error }</HabboText><HabboButton type="button" label="Dismiss" onClick={ () => setError('') } /></div> }
            { simulationError && <div className="clove-warning" role="status"><HabboText format={ HABBO_STYLES.u_bold }>Simulation data unavailable.</HabboText><HabboText>{ simulationError }</HabboText></div> }
            <section className="clove-workspace">
                <div className="clove-left-panel">
                    <CloveHierarchy nodes={ document.nodes } selectedIds={ selectedIds } collapsedIds={ collapsedTreeIds } rowIndices={ hierarchyRowIndices } onSelect={ selectNode } onToggleVisible={ item => changeAttributes(item.id, { visible: item.attributes.visible === 'false' ? 'true' : 'false' }) } onToggleCollapsed={ toggleTreeCollapsed } onReparent={ reparentNode } />
                    <UbuntuWindow className="clove-library-window" title="Library">
                        <div className="clove-library-filters" role="group" aria-label="Library kind">
                            { ([ [ 'controls', 'Controls' ], [ 'images', 'Images' ] ] as [ LibraryKind, string ][]).map(([ value, label ]) => <HabboButton className={ libraryKind === value ? 'active' : '' } label={ label } type="button" key={ value } onClick={ () =>
                            {
                                switchLibraryKind(value);
                            } } />) }
                        </div>
                        <div className="clove-palette-search"><HabboInput aria-label="Filter library" placeholder={ libraryKind === 'controls' ? 'Search controls…' : 'Search images…' } value={ librarySearch } onChange={ event => libraryKind === 'controls' ? setControlLibrarySearch(event.target.value) : setImageLibrarySearch(event.target.value) } /></div>
                        <div className="clove-library-refiners">
                            { libraryKind === 'controls' && <label><HabboText>Family</HabboText><HabboSelect aria-label="Control family" value={ libraryFamily } onChange={ event => setLibraryFamily(event.target.value as LibraryFamily) }><option value="all">All families</option>{ CLOVE_THEMES.map(item => <option key={ item.id } value={ item.id }>{ item.label }</option>) }</HabboSelect></label> }
                            { libraryKind === 'images' && <label><HabboText>Library</HabboText><HabboSelect aria-label="Image library" value={ assetPackage } onChange={ event => setAssetPackage(event.target.value) }><option value="all">All { assetManifests.length } libraries</option><option value="my-images">My Images · { customSkins.length }</option>{ unmappedAssetCount > 0 && <option value="unpackaged">Unmapped core assets · { unmappedAssetCount }</option> }{ assetManifests.map(manifest => <option key={ manifest.id } value={ manifest.id }>{ manifestLabel(manifest.component) } · { manifest.imageCount }</option>) }</HabboSelect></label> }
                        </div>
                        <HabboScrollArea className="clove-unified-library" viewportRef={ libraryViewportRef }>
                            { libraryKind === 'controls' && <section className="clove-library-section clove-control-library">
                                { CLOVE_THEMES.filter(item => libraryFamily === 'all' || item.id === libraryFamily).flatMap(family => widgetItems.filter(item => item.skin?.[family.id] || (!item.skin && family.id === 'ubuntu')).map(item => <LazyWidgetCard key={ `${ item.id }-${ family.id }` } definition={ item } theme={ family.id } onAdd={ definition => addWidget(definition, undefined, undefined, undefined, family.id) } />)) }
                            </section> }
                            { libraryKind === 'images' && assetPackage === 'all' && <section className="clove-library-section clove-raw-skins">
                                { rawSkins.filter(skin => !skin.id.startsWith('project:')).map(skin =>
                                {
                                    const state = skin.states.find(value => value.name === 'default' && skin.layouts[value.layout] && skin.templates[value.template]) || skin.states.find(value => skin.layouts[value.layout] && skin.templates[value.template]);

                                    if(!state) return null;

                                    return <button type="button" draggable key={ skin.id } aria-label={ `${ skin.name.replaceAll('_', ' ') }${ skin.id.startsWith('project:') ? ' · project' : '' }` } title={ `${ skin.id } · drag to create a skinned ${ skin.name } region` } onDoubleClick={ () => addRawSkin(skin.id, state.layout) } onDragStart={ event =>
                                    {
                                        event.dataTransfer.effectAllowed = 'copy';
                                        event.dataTransfer.setData('application/x-clove-skin', JSON.stringify({ registryId: skin.id, layout: state.layout }));
                                    } }><span><SkinRegistryView registryId={ skin.id } layout={ state.layout } /></span><HabboText format={ HABBO_STYLES.u_small }>{ `${ skin.name.replaceAll('_', ' ') }${ skin.id.startsWith('project:') ? ' · project' : '' }` }</HabboText></button>;
                                }) }
                            </section> }
                            { libraryKind === 'images' && <section className="clove-library-section clove-asset-library" onErrorCapture={ event =>
                            {
                                const target = event.target;

                                if(!(target instanceof HTMLImageElement) || target.dataset.fallbackApplied) return;

                                const id = target.closest<HTMLButtonElement>('[data-clove-asset-id]')?.dataset.cloveAssetId || '';
                                const image = getCloveAssetImage(id);
                                const fallback = image ? cloveAssetFallbackImageUrl(image) : '';

                                if(!fallback) return;

                                target.dataset.fallbackApplied = 'true';
                                target.src = fallback;
                            } }>
                                { (assetPackage === 'all' || assetPackage === 'my-images') && projectAssets.map(name =>
                                {
                                    const customImage = customSkins.find(skin => skin.assetName === name);
                                    const displayName = customImage?.fileName || customImage?.name || name;

                                    return <div className="clove-project-asset-card" key={ name }><button className="clove-project-asset-open" type="button" draggable aria-label={ `${ displayName } · My Images` } title={ `${ displayName } · My Images · drag to create a static_bitmap` } onDoubleClick={ () => addRawAsset(name) } onDragStart={ event =>
                                    {
                                        event.dataTransfer.effectAllowed = 'copy';
                                        event.dataTransfer.setData('application/x-clove-asset', name);
                                    } }><span className="clove-asset-thumbnail"><img draggable={ false } loading="lazy" decoding="async" src={ getSkinRegistryAssetUrl(name) } alt="" /></span><HabboText format={ HABBO_STYLES.u_small }>{ displayName }</HabboText><HabboText format={ HABBO_STYLES.u_small }>{ `${ customImage?.imageWidth || 0 }×${ customImage?.imageHeight || 0 } · My Images` }</HabboText></button><HabboChromeButton className="clove-project-asset-delete" label={ `Delete ${ displayName }` } registryId="habbo_skin_button_close_3" layout="button_close_3" onClick={ () => deleteCustomImage(name) } /></div>;
                                }) }
                                { filteredAssets.slice(0, assetLimit).map(image =>
                                {
                                    const assetName = image.name;
                                    const packageNames = image.packages.map(id => manifestLabel(CLOVE_ASSET_CATALOG.manifests.find(manifest => manifest.id === id)?.component || id)).join(', ') || 'physical source';

                                    return <button type="button" draggable key={ image.id } aria-label={ `${ assetName } · ${ image.width }×${ image.height }` } data-clove-asset-id={ image.id } data-clove-asset-name={ assetName } title={ `${ assetName } · ${ image.width }×${ image.height } · ${ packageNames } · drag to create a static_bitmap` } onDoubleClick={ () => addRawAsset(assetName, undefined, undefined, undefined, image) } onDragStart={ event =>
                                    {
                                        event.dataTransfer.effectAllowed = 'copy';
                                        event.dataTransfer.setData('application/x-clove-asset', JSON.stringify({ name: assetName, id: image.id }));
                                    } }><span className="clove-asset-thumbnail"><img draggable={ false } loading="lazy" decoding="async" src={ cloveAssetImageUrl(image) } alt="" /></span><HabboText format={ HABBO_STYLES.u_small }>{ assetName }</HabboText><HabboText format={ HABBO_STYLES.u_small }>{ `${ image.width }×${ image.height }${ image.variantCount > 1 ? ` · variant ${ image.variant }/${ image.variantCount }` : '' }` }</HabboText></button>;
                                }) }
                                { assetLimit < filteredAssets.length && <HabboButton className="clove-asset-load-more" type="button" label={ `Show ${ Math.min(ASSET_PAGE_SIZE, filteredAssets.length - assetLimit) } more · ${ (filteredAssets.length - assetLimit).toLocaleString() } remaining` } onClick={ () => setAssetLimit(limit => limit + ASSET_PAGE_SIZE) } /> }
                            </section> }
                        </HabboScrollArea>
                    </UbuntuWindow>
                </div>
                <CloveStage stageRef={ stageRef } width={ stageWidth } height={ stageHeight } zoom={ zoom } marquee={ marquee } onDrop={ dropWidget } onPick={ pickStageNode } onPointerDown={ beginMarquee }>
                    { snapGuides?.parentId === '' && snapGuides.x !== undefined && <span className="clove-snap-guide vertical" style={ { left: snapGuides.x } } /> }
                    { snapGuides?.parentId === '' && snapGuides.y !== undefined && <span className="clove-snap-guide horizontal" style={ { top: snapGuides.y } } /> }
                    { document.nodes.map(node => <CloveNodeView key={ node.id } node={ node } siblings={ document.nodes } selectedIds={ selectedIds } snap={ snap } zoom={ zoom } snapGuides={ snapGuides } debugRects={ debugRects } theme={ theme } mode={ mode } activeTabs={ tabState.resolvedActiveTabs } hiddenNodeIds={ tabState.hiddenNodeIds } forcedVisibleNodeIds={ tabState.forcedVisibleNodeIds } geometryOverrides={ tabState.geometryOverrides } simulationOverrides={ effectiveNodeSimulation } resolveCaption={ resolveCaption } onChangeGeometry={ changeAttributes } onMoveSelection={ moveSelection } onSnapGuides={ setSnapGuides } onChangeCaption={ (id, caption) => changeAttributes(id, { caption: encodeCaption(caption) }) } onActivateTab={ activateTab } />) }
                </CloveStage>
                <UbuntuWindow className="clove-inspector" title="Property Editor" meta={ selectedNodes.length > 1 ? `${ selectedNodes.length } selected` : selectedNode?.type || undefined }>
                    { selectedNode ? <HabboScrollArea className="clove-inspector-scroll">
                        <div className="clove-inspector-summary"><HabboText format={ HABBO_STYLES.u_small }>{ selectedNode.type }</HabboText><HabboText format={ HABBO_STYLES.u_bold }>{ nodeLabel(selectedNode) }</HabboText><HabboText format={ HABBO_STYLES.u_small }>{ `#${ selectedNode.id }` }</HabboText></div>
                        <SectionHeading>Common</SectionHeading>
                        <div className="clove-properties">{ BASIC_PROPERTIES.map(name => <PropertyField key={ `${ selectedNode.id }-${ name }` } name={ name } type={ name === 'visible' ? 'boolean' : 'text' } value={ selectedNode.attributes[name] || '' } onCommit={ value => changeAttributes(selectedNode.id, { [name]: value }) } />) }</div>
                        <div className="clove-inspector-separator" />
                        <SectionHeading>Geometry</SectionHeading>
                        <div className="clove-properties clove-properties-grid">{ GEOMETRY_PROPERTIES.map(name => <PropertyField key={ `${ selectedNode.id }-${ name }` } name={ name } value={ name === 'x' ? String(selectedAbsolutePosition?.x ?? finiteLayoutNumber(selectedNode.attributes.x)) : name === 'y' ? String(selectedAbsolutePosition?.y ?? finiteLayoutNumber(selectedNode.attributes.y)) : selectedNode.attributes[name] || '' } onCommit={ value =>
                        {
                            if(name !== 'x' && name !== 'y')
                            {
                                changeAttributes(selectedNode.id, { [name]: value });
                                return;
                            }

                            const parentId = findParentNode(document, selectedNode.id)?.id || '';
                            const origin = parentContentOrigin(document, parentId);

                            changeAttributes(selectedNode.id, { [name]: String(finiteLayoutNumber(value) - origin[name]) });
                        } } />) }</div>
                        <div className="clove-inspector-separator" />
                        <SectionHeading>Appearance</SectionHeading>
                        <div className="clove-properties">
                            <PropertyField name="color" type="color" value={ selectedNode.attributes.color || '0xffffff' } onCommit={ value => changeAttributes(selectedNode.id, { color: value }, `color:${ selectedNode.id }`) } />
                            <PropertyField name="background" type="boolean" value={ selectedNode.attributes.background || 'true' } onCommit={ value => changeAttributes(selectedNode.id, { background: value }) } />
                        </div>
                        <div className="clove-inspector-separator" />
                        <SectionHeading>Rotation</SectionHeading>
                        <div className="clove-transform-tools" role="group" aria-label="Object transform">
                            <div className="clove-transform-actions">
                                <HabboButton type="button" style={ { minWidth: 0 } } className={ selectedNode.attributes.flip_x === 'true' ? 'active' : '' } label="Horizontal" onClick={ () => changeAttributes(selectedNode.id, { flip_x: String(selectedNode.attributes.flip_x !== 'true') }) } />
                                <HabboButton type="button" style={ { minWidth: 0 } } className={ selectedNode.attributes.flip_y === 'true' ? 'active' : '' } label="Vertical" onClick={ () => changeAttributes(selectedNode.id, { flip_y: String(selectedNode.attributes.flip_y !== 'true') }) } />
                                <HabboButton type="button" style={ { minWidth: 0 } } label="90°" onClick={ () => changeAttributes(selectedNode.id, { rotation: String((selectedRotation + 90) % 360) }) } />
                                <HabboButton type="button" style={ { minWidth: 0 } } label="180°" onClick={ () => changeAttributes(selectedNode.id, { rotation: String((selectedRotation + 180) % 360) }) } />
                            </div>
                            <HabboButton className="clove-transform-reset" type="button" label="Reset" disabled={ !selectedRotation && selectedNode.attributes.flip_x !== 'true' && selectedNode.attributes.flip_y !== 'true' } onClick={ () => changeAttributes(selectedNode.id, { rotation: '0', flip_x: 'false', flip_y: 'false' }) } />
                        </div>
                        <div className="clove-inspector-separator" />
                        <SectionHeading>Simulation</SectionHeading>
                        <div className="clove-simulation-tools">
                            <label><HabboText>Visibility</HabboText><HabboSelect value={ selectedSimulation.visible === undefined ? 'layout' : String(selectedSimulation.visible) } onChange={ event => changeSimulation(selectedNode.id, { visible: event.target.value === 'layout' ? undefined : event.target.value === 'true' }) }><option value="layout">Use layout</option><option value="true">Visible</option><option value="false">Hidden</option></HabboSelect></label>
                            { [ 'button', 'dropmenu', 'input', 'tab_container_button', 'checkbox', 'radio_button', 'switch' ].includes(selectedNode.type) && <label><HabboText>Control state</HabboText><HabboSelect value={ selectedSimulation.disabled ? 'disabled' : selectedSimulation.selected ? 'selected' : 'default' } onChange={ event => changeSimulation(selectedNode.id, { disabled: event.target.value === 'disabled' || undefined, selected: event.target.value === 'selected' || undefined }) }><option value="default">Default / interactive</option><option value="selected">Selected</option><option value="disabled">Disabled</option></HabboSelect></label> }
                            { selectedNode.type === 'dropmenu' && <label><HabboText>Options</HabboText><HabboInput value={ (selectedSimulation.options || []).join(', ') } placeholder="All, Floor items, Wall items" onChange={ event => changeSimulation(selectedNode.id, { options: event.target.value ? event.target.value.split(',').map(value => value.trim()).filter(Boolean) : undefined }) } /></label> }
                            { [ 'text', 'label', 'input', 'button', 'tab_container_button' ].includes(selectedNode.type) && <label><HabboText>Mock caption</HabboText><HabboInput value={ selectedSimulation.caption || '' } placeholder="Use layout caption" onChange={ event => changeSimulation(selectedNode.id, { caption: event.target.value || undefined }) } /></label> }
                            <HabboButton type="button" label="Reset node state" disabled={ !effectiveNodeSimulation[selectedNode.id] } onClick={ () => resetSimulation(selectedNode.id) } />
                        </div>
                        { [ 'frame', 'text', 'label', 'input', 'button', 'tab_container_button' ].includes(selectedNode.type) && <>
                            <div className="clove-inspector-separator" />
                            <SectionHeading>Typography</SectionHeading>
                            <div className="clove-text-tools">
                                <label><HabboText>Style</HabboText><HabboSelect value={ variableValue(selectedNode, 'text_style', selectedNode.type === 'frame' ? 'u_frame_title' : 'u_regular') } onChange={ event => changeTextStyle(selectedNode.id, event.target.value) }>{ HABBO_CSS_STYLE_NAMES.map(name => <option value={ name } key={ name }>{ name }</option>) }</HabboSelect></label>
                                <label><HabboText>Size</HabboText><HabboInput type="number" min="6" max="72" value={ variableValue(selectedNode, 'font_size', '') } placeholder="style default" onChange={ event => changeVariable(selectedNode.id, 'font_size', event.target.value, 'uint') } /></label>
                                <label><HabboText>Text color</HabboText><ColorVariableField value={ variableValue(selectedNode, 'text_color', '0x000000') } onCommit={ value => changeVariable(selectedNode.id, 'text_color', value, 'hex', `text-color:${ selectedNode.id }`) } /></label>
                                <label><HabboText>Alignment</HabboText><HabboSelect value={ variableValue(selectedNode, 'auto_size', 'left') } onChange={ event => changeVariable(selectedNode.id, 'auto_size', event.target.value) }><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></HabboSelect></label>
                                <div className="clove-text-toggles">
                                    { [ 'bold', 'italic', 'underline', 'word_wrap', 'multiline' ].map(key => <HabboCheckbox key={ key } label={ key.replace('_', ' ') } checked={ variableValue(selectedNode, key, 'false') === 'true' } onChange={ event => changeVariable(selectedNode.id, key, String(event.target.checked), 'Boolean') } />) }
                                </div>
                                <div className="clove-text-number-row">
                                    <label><HabboText>Spacing</HabboText><HabboInput type="number" value={ variableValue(selectedNode, 'spacing', '0') } onChange={ event => changeVariable(selectedNode.id, 'spacing', event.target.value, 'Number') } /></label>
                                    <label><HabboText>Leading</HabboText><HabboInput type="number" value={ variableValue(selectedNode, 'leading', '0') } onChange={ event => changeVariable(selectedNode.id, 'leading', event.target.value, 'Number') } /></label>
                                </div>
                            </div>
                        </> }
                        <div className="clove-inspector-separator" />
                        <SectionHeading hint={ String(selectedNode.variables.length) }>Advanced variables</SectionHeading>
                        <div className="clove-variables">{ selectedNode.variables.map(item => <label key={ item.key }><HabboText>{ item.key }</HabboText><HabboInput value={ item.value } onChange={ event => changeVariable(selectedNode.id, item.key, event.target.value, item.type) } /><HabboText format={ HABBO_STYLES.u_small }>{ item.type }</HabboText></label>) }</div>
                    </HabboScrollArea> : null }
                </UbuntuWindow>
            </section>
            { updateDialogOpen && updateStatus.phase !== 'idle' && <div className="clove-dialog-backdrop" role="presentation" onMouseDown={ () => updateStatus.phase !== 'installing' && setUpdateDialogOpen(false) }>
                <div className="clove-update-dialog-shell" onMouseDown={ event => event.stopPropagation() }>
                    <UbuntuWindow className="clove-update-dialog" title="Clove update" role="dialog" ariaLabel="Clove update" onClose={ updateStatus.phase === 'installing' ? undefined : () => setUpdateDialogOpen(false) }>
                        <div className="clove-update-dialog-message">
                            <img src="/assets/images/library/1147_event_notification_icon_png.png" width={ 25 } height={ 25 } alt="" draggable={ false } />
                            <div>
                                <HabboText format={ HABBO_STYLES.u_bold }>{ updateHeadline(updateStatus) }</HabboText>
                                { [ 'ready', 'installing' ].includes(updateStatus.phase)
                                    ? <HabboText className="clove-update-dialog-detail" format={ HABBO_STYLES.il_regular } color={ 0x4F4D47 }>{ updateDetail(updateStatus, installingDots) }</HabboText>
                                    : <p>{ updateDetail(updateStatus) }</p> }
                            </div>
                        </div>
                        { updateStatus.phase === 'downloading' && <div className="clove-update-progress" role="progressbar" aria-label="Update download" aria-valuemin={ 0 } aria-valuemax={ 100 } aria-valuenow={ Math.round(updateStatus.percent || 0) }>
                            <span style={ { width: `${ Math.max(0, Math.min(100, updateStatus.percent || 0)) }%` } } />
                            <HabboText format={ HABBO_STYLES.u_bold }>{ `${ Math.round(updateStatus.percent || 0) }%` }</HabboText>
                        </div> }
                        <footer>
                            { updateStatus.phase !== 'installing' && <HabboButton type="button" label={ updateStatus.phase === 'ready' ? 'Later' : 'Close' } onClick={ () => setUpdateDialogOpen(false) } /> }
                            { updateStatus.phase === 'error' && <HabboButton className="primary" type="button" label="Try again" onClick={ () =>
                            {
                                setUpdateStatus(current => ({ ...current, phase: 'checking', message: undefined }));
                                window.cloveDesktop?.checkForUpdates().catch(() => undefined);
                            } } /> }
                            { updateStatus.phase === 'ready' && <HabboButton className="primary" type="button" label="Restart & update" onClick={ () =>
                            {
                                setUpdateStatus(current => ({ ...current, phase: 'installing' }));
                                window.cloveDesktop?.installUpdate().then(started =>
                                {
                                    if(!started) setUpdateStatus(current => ({ ...current, phase: 'error', message: 'The update could not be started. Please restart Clove and try again.' }));
                                }).catch(installError => setUpdateStatus(current => ({ ...current, phase: 'error', message: installError instanceof Error ? installError.message : String(installError) })));
                            } } /> }
                        </footer>
                    </UbuntuWindow>
                </div>
            </div> }
            { newDialogOpen && <div className="clove-dialog-backdrop" role="presentation" onMouseDown={ () => setNewDialogOpen(false) }>
                <form className="clove-dialog-form" onMouseDown={ event => event.stopPropagation() } onSubmit={ event =>
                {
                    event.preventDefault();
                    createDocument();
                } }>
                    <UbuntuWindow className="clove-dialog" title="Create a UI window" role="dialog" ariaLabel="Create a UI window" onClose={ () => setNewDialogOpen(false) }>
                        <label><HabboText>Name</HabboText><HabboInput autoFocus value={ newDocumentForm.name } onChange={ event => setNewDocumentForm(current => ({ ...current, name: event.target.value.replace(/[^a-zA-Z0-9_-]/g, '_') })) } /></label>
                        <div><label><HabboText>Width</HabboText><HabboInput type="number" min="120" value={ newDocumentForm.width } onChange={ event => setNewDocumentForm(current => ({ ...current, width: Number(event.target.value) })) } /></label><label><HabboText>Height</HabboText><HabboInput type="number" min="80" value={ newDocumentForm.height } onChange={ event => setNewDocumentForm(current => ({ ...current, height: Number(event.target.value) })) } /></label></div>
                        <label><HabboText>Theme</HabboText><HabboSelect value={ theme } onChange={ event => setTheme(event.target.value as CloveTheme) }>{ CLOVE_THEMES.map(item => <option key={ item.id } value={ item.id }>{ item.label }</option>) }</HabboSelect></label>
                        <footer><HabboButton type="button" label="Cancel" onClick={ () => setNewDialogOpen(false) } /><HabboButton className="primary" type="submit" label="Create window" /></footer>
                    </UbuntuWindow>
                </form>
            </div> }
            { customSkinFile && <CustomSkinImportDialog file={ customSkinFile } onCancel={ () => setCustomSkinFile(null) } onCreate={ createCustomSkins } /> }
        </main>
    );
};
