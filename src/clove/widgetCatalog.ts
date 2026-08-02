import skinsJson from './data/skins.json';
import windowTypesJson from './data/windowTypes.json';
import { NewCloveNode } from './model/layoutXml';

export type CloveTheme = 'ubuntu' | 'blue' | 'habbo-dark' | 'habbo-gold' | 'illumina-light' | 'illumina-dark' | 'illumina-purple' | 'special';
type WidgetCategory = 'Windows' | 'Controls' | 'Text' | 'Layout' | 'Runtime';

export interface CatalogSkin
{
    registryId: string;
    layout: string;
    naturalWidth?: number;
    naturalHeight?: number;
    minWidth?: number;
    minHeight?: number;
}

export interface WidgetDefinition
{
    id: string;
    label: string;
    description: string;
    category: WidgetCategory;
    width: number;
    height: number;
    skin?: Partial<Record<CloveTheme, CatalogSkin>>;
    registryGenerated?: boolean;
    create: (theme: CloveTheme) => NewCloveNode;
}

interface RegistryEntity
{
    rect: [number, number, number, number];
    scaleH: string;
    scaleV: string;
}

interface RegistrySkin
{
    id: string;
    name: string;
    states: { name: string; layout: string; template: string }[];
    templates: Record<string, { entities: RegistryEntity[] }>;
    layouts: Record<string, { entities: RegistryEntity[] }>;
}

interface WindowTypeEntry
{
    type: string;
    style: string;
    intent: string;
    renderer: string;
    registryId: string;
    layout: string;
    windowLayout: string;
    color?: string;
}

const registry = skinsJson as unknown as { skins: Record<string, RegistrySkin> };
const windowTypes = (windowTypesJson as unknown as { entries: WindowTypeEntry[] }).entries;

export const CLOVE_THEMES: { id: CloveTheme; label: string; style: string }[] = [
    { id: 'ubuntu', label: 'Ubuntu', style: '3' },
    { id: 'blue', label: 'Habbo Blue', style: '0' },
    { id: 'habbo-dark', label: 'Habbo Dark', style: '1' },
    { id: 'habbo-gold', label: 'Habbo Gold', style: '2' },
    { id: 'illumina-light', label: 'Illumina Light', style: '100' },
    { id: 'illumina-dark', label: 'Illumina Dark', style: '200' },
    { id: 'illumina-purple', label: 'Illumina Purple', style: '103' }
];

const styleFor = (theme: CloveTheme) => CLOVE_THEMES.find(item => item.id === theme)?.style || '0';
const mappedFamily = (style = ''): CloveTheme | null =>
{
    if(style === '') return null;

    const value = Number(style);

    if(!Number.isInteger(value) || value < 0) return null;
    if(value === 0) return 'blue';
    if(value === 1) return 'habbo-dark';
    if(value === 2) return 'habbo-gold';
    if(value <= 99) return 'ubuntu';
    if(value <= 199) return value >= 103 && value <= 105 ? 'illumina-purple' : 'illumina-light';
    if(value <= 299) return 'illumina-dark';
    if(value >= 10000) return 'special';

    return null;
};
const fallbackFamilyOf = (id: string): CloveTheme => id.includes('illumina_dark') ? 'illumina-dark'
    : id.includes('illumina_purple') ? 'illumina-purple'
        : id.includes('illumina') ? 'illumina-light'
            : (id.includes('ubuntu') || /(?:^|_)(?:frame|header|dropmenu(?:_item)?|tab_button|tab_context|border|scaler|button[a-z_]*)_3$/.test(id)) ? 'ubuntu' : 'blue';

const baseAttributes = (theme: CloveTheme, width: number, height: number, name: string, style = styleFor(theme)) => ({
    x: '0',
    y: '0',
    width: String(width),
    height: String(height),
    params: '16',
    style,
    name,
    ...(theme.startsWith('illumina-') ? { theme: theme.replace('-', '_') } : {})
});

const boundsOf = (entities: RegistryEntity[]) => entities.reduce((bounds, entity) => ({
    width: Math.max(bounds.width, entity.rect[0] + entity.rect[2]),
    height: Math.max(bounds.height, entity.rect[1] + entity.rect[3])
}), { width: 0, height: 0 });

const minimumAxisSize = (entities: RegistryEntity[], axis: 0 | 1, natural: number) =>
{
    const scaleMode = (entity: RegistryEntity) => axis === 0 ? entity.scaleH : entity.scaleV;
    const leading = entities.filter(entity => scaleMode(entity) === 'fixed').reduce((value, entity) => Math.max(value, entity.rect[axis] + entity.rect[axis + 2]), 0);
    const trailing = entities.filter(entity => scaleMode(entity) === 'move').reduce((value, entity) => Math.max(value, natural - entity.rect[axis]), 0);

    return Math.max(1, Math.min(natural, leading + trailing || leading || trailing || 1));
};

export const catalogSkinGeometry = (registryId: string, layoutName: string) =>
{
    const layout = registry.skins[registryId]?.layouts[layoutName];

    if(!layout) return { width: 1, height: 1, minWidth: 1, minHeight: 1 };

    const natural = boundsOf(layout.entities);

    return {
        width: Math.max(1, natural.width),
        height: Math.max(1, natural.height),
        minWidth: minimumAxisSize(layout.entities, 0, natural.width),
        minHeight: minimumAxisSize(layout.entities, 1, natural.height)
    };
};

type ResolvedCatalogSkin = Required<CatalogSkin>;

const catalogSkin = (registryId: string, layout: string): ResolvedCatalogSkin =>
{
    const geometry = catalogSkinGeometry(registryId, layout);

    return { registryId, layout, naturalWidth: geometry.width, naturalHeight: geometry.height, minWidth: geometry.minWidth, minHeight: geometry.minHeight };
};

const validState = (skin: RegistrySkin, layout?: string) => skin.states.find(state => (!layout || state.layout === layout) && state.name === 'default' && state.template !== 'null' && skin.layouts[state.layout] && skin.templates[state.template]?.entities.length)
    || skin.states.find(state => (!layout || state.layout === layout) && state.template !== 'null' && skin.layouts[state.layout] && skin.templates[state.template]?.entities.length);

const mappingPriority = (entry: WindowTypeEntry) => entry.type === 'scrollbar_vertical' ? 0
    : entry.type === 'frame' ? 1
        : /^(?:button|iconbutton|closebutton|checkbox|radiobutton|dropmenu|tab_|scaler)/.test(entry.type) ? 2
            : /border|scrollbar/.test(entry.type) ? 3 : 4;

const displayName = (skin: RegistrySkin) => skin.name
    .replace(/(?:_skin)?(?:_[037])?$/, '')
    .replace(/^(?:default_|illumina_(?:light|dark|purple)_)/, '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, character => character.toUpperCase());

const normalizedNodeType = (type: string) => type === 'radiobutton' ? 'radio_button' : type;

const registryWidget = (skin: RegistrySkin): WidgetDefinition | null =>
{
    const mappings = windowTypes.filter(entry => entry.renderer === 'skin' && entry.registryId === skin.id && skin.layouts[entry.layout]).sort((left, right) => mappingPriority(left) - mappingPriority(right));
    const mapping = mappings[0];
    const scrollbar = mappings.find(entry => entry.type === 'scrollbar_vertical');
    const fallbackLayout = Object.keys(skin.layouts).find(layout => skin.layouts[layout].entities.length && (skin.templates[layout]?.entities.length || Object.values(skin.templates).some(template => template.entities.length))) || Object.keys(skin.layouts)[0];
    const previewState = scrollbar
        ? validState(skin, Object.keys(skin.layouts).find(name => /lift_vertical/.test(name))) || validState(skin)
        : validState(skin, mapping?.layout) || validState(skin)
            || (fallbackLayout ? { name: 'default', layout: fallbackLayout, template: fallbackLayout } : null);

    if(!previewState) return null;

    const mappingsByTheme: Partial<Record<CloveTheme, WindowTypeEntry>> = {};

    for(const entry of mappings)
    {
        const family = mappedFamily(entry.style);

        if(family && !mappingsByTheme[family]) mappingsByTheme[family] = entry;
    }

    // A registry skin with no authored style-band mapping must remain usable.
    // The fallback is deliberately narrow so ids such as rarity_3 are not
    // mistaken for Sulake's genuine Ubuntu style-3 controls.
    if(!Object.keys(mappingsByTheme).length) mappingsByTheme[fallbackFamilyOf(skin.id)] = mapping;

    const themes = Object.keys(mappingsByTheme) as CloveTheme[];
    const previews: Partial<Record<CloveTheme, ResolvedCatalogSkin>> = {};

    for(const theme of themes)
    {
        const familyMapping = mappingsByTheme[theme];
        const familyState = scrollbar
            ? validState(skin, Object.keys(skin.layouts).find(name => /lift_vertical/.test(name))) || validState(skin, familyMapping?.layout) || previewState
            : validState(skin, familyMapping?.layout) || previewState;

        previews[theme] = catalogSkin(skin.id, familyState.layout);
    }

    const preview = catalogSkin(skin.id, previewState.layout);
    const assembly = mapping ? catalogSkin(skin.id, mapping.layout) : preview;
    const isScrollbar = !!scrollbar;
    const width = isScrollbar ? 17 : assembly.naturalWidth;
    const height = isScrollbar ? 56 : assembly.naturalHeight;
    const type = normalizedNodeType(scrollbar?.type || mapping?.type || 'border');
    const interactive = skin.states.some(state => state.name !== 'default') || !!mapping && /button|checkbox|radio|dropmenu|scrollbar|scaler|tab/.test(mapping.type);
    const intent = mapping?.intent && mapping.intent !== 'default' ? mapping.intent : '';
    return {
        id: `skin:${ skin.id }`,
        label: displayName(skin),
        category: interactive ? 'Controls' : 'Layout',
        description: `${ interactive ? 'Interactive control' : 'Skinned panel' } generated from ${ skin.id } and its window-type semantics.`,
        width,
        height,
        skin: previews,
        registryGenerated: true,
        create: selectedTheme =>
        {
            const selectedMapping = mappingsByTheme[selectedTheme] || mapping;
            const selectedPreview = previews[selectedTheme] || preview;
            const selectedAssembly = selectedMapping ? catalogSkin(skin.id, selectedMapping.layout) : selectedPreview;
            const selectedScrollbar = selectedMapping?.type === 'scrollbar_vertical' || (!selectedMapping && isScrollbar);
            const selectedWidth = selectedScrollbar ? 17 : selectedAssembly.naturalWidth;
            const selectedHeight = selectedScrollbar ? 56 : selectedAssembly.naturalHeight;
            const selectedMinWidth = selectedScrollbar ? 17 : selectedAssembly.minWidth;
            const selectedMinHeight = selectedScrollbar ? 56 : selectedAssembly.minHeight;
            const selectedType = normalizedNodeType(selectedMapping?.type || type);
            const selectedIntent = selectedMapping?.intent && selectedMapping.intent !== 'default' ? selectedMapping.intent : intent;
            const attributes = {
                ...baseAttributes(selectedTheme, selectedWidth, selectedHeight, skin.id, selectedMapping?.style || styleFor(selectedTheme)),
                width_min: String(selectedMinWidth),
                height_min: String(selectedMinHeight),
                ...(selectedMapping?.color ? { color: selectedMapping.color } : {}),
                ...(selectedIntent ? { intent: selectedIntent } : {}),
                ...(/button|tab/.test(selectedType) && !/checkbox|radio|icon|close/.test(selectedType) ? { caption: encodeURIComponent(displayName(skin)) } : {})
            };

            return { type: selectedType, attributes, editorSkin: { registryId: skin.id, layout: selectedMapping?.layout || selectedPreview.layout }};
        }
    };
};

const STRUCTURAL_WIDGETS: WidgetDefinition[] = [
    {
        id: 'tab-context', label: 'Two-tab group', category: 'Controls', description: 'Ready-made tab context with two editable pages.', width: 300, height: 180,
        create: theme => ({
            type: 'tab_context', attributes: { ...baseAttributes(theme, 300, 180, 'tabs'), params: '2064', caption: encodeURIComponent('Tabs') }, children: [
                { type: 'tab_container_button', attributes: { ...baseAttributes(theme, 100, 32, 'tab_one'), x: '0', y: '0', params: '147473', caption: encodeURIComponent('Tab one') }},
                { type: 'tab_container_button', attributes: { ...baseAttributes(theme, 100, 32, 'tab_two'), x: '100', y: '0', params: '147473', caption: encodeURIComponent('Tab two') }},
                { type: 'container', attributes: { ...baseAttributes(theme, 300, 148, 'tab_one'), x: '0', y: '32', params: '2064' }},
                { type: 'container', attributes: { ...baseAttributes(theme, 300, 148, 'tab_two'), x: '0', y: '32', params: '2064' }}
            ]
        })
    },
    {
        id: 'input', label: 'Text input', category: 'Controls', description: 'Editable input using the family border; Purple falls back to Illumina Light.', width: 150, height: 22,
        skin: {
            blue: catalogSkin('habbo_skin_border_white', 'border_white'), ubuntu: catalogSkin('habbo_skin_border_6', 'border_6'),
            'habbo-dark': catalogSkin('habbo_skin_border_black', 'border_black'), 'habbo-gold': catalogSkin('habbo_skin_border_colorless', 'border_colorless'),
            'illumina-light': catalogSkin('illumina_light_skin_border_input', 'illumina_light_border_input'), 'illumina-dark': catalogSkin('illumina_dark_skin_border', 'illumina_dark_border'),
            'illumina-purple': catalogSkin('illumina_light_skin_border_input', 'illumina_light_border_input')
        },
        create: theme => ({ type: 'input', attributes: { ...baseAttributes(theme, 150, 22, 'input'), caption: '' }, editorSkin: { ...(theme === 'illumina-purple' ? catalogSkin('illumina_light_skin_border_input', 'illumina_light_border_input') : theme === 'illumina-dark' ? catalogSkin('illumina_dark_skin_border', 'illumina_dark_border') : theme === 'ubuntu' ? catalogSkin('habbo_skin_border_6', 'border_6') : theme === 'habbo-dark' ? catalogSkin('habbo_skin_border_black', 'border_black') : theme === 'habbo-gold' ? catalogSkin('habbo_skin_border_colorless', 'border_colorless') : theme === 'blue' ? catalogSkin('habbo_skin_border_white', 'border_white') : catalogSkin('illumina_light_skin_border_input', 'illumina_light_border_input')) }})
    },
    { id: 'text', label: 'Text', category: 'Text', description: 'Multiline Truffle-rendered body text.', width: 180, height: 48, create: theme => ({ type: 'text', attributes: { ...baseAttributes(theme, 180, 48, 'text'), caption: encodeURIComponent('Text') }, variables: [ { key: 'text_style', value: theme.startsWith('illumina-') ? 'il_regular' : 'u_regular', type: 'String' } ] }) },
    { id: 'label', label: 'Label', category: 'Text', description: 'Single-line Truffle-rendered label.', width: 120, height: 20, create: theme => ({ type: 'label', attributes: { ...baseAttributes(theme, 120, 20, 'label'), caption: encodeURIComponent('Label') }}) },
    { id: 'container', label: 'Container', category: 'Layout', description: 'Invisible grouping and positioning container.', width: 200, height: 120, create: theme => ({ type: 'container', attributes: baseAttributes(theme, 200, 120, 'container') }) },
    { id: 'separator', label: 'Separator', category: 'Layout', description: 'Horizontal visual divider.', width: 180, height: 1, create: theme => ({ type: 'separator', attributes: baseAttributes(theme, 180, 1, 'separator') }) },
    { id: 'bitmap', label: 'Bitmap', category: 'Runtime', description: 'Static bitmap resolved through an asset_uri.', width: 64, height: 64, create: theme => ({ type: 'static_bitmap', attributes: baseAttributes(theme, 64, 64, 'bitmap'), variables: [ { key: 'asset_uri', value: 'asset_name', type: 'String' } ] }) },
    { id: 'runtime-widget', label: 'Runtime region', category: 'Runtime', description: 'Named placeholder filled by client logic at runtime.', width: 120, height: 90, create: theme => ({ type: 'widget', attributes: baseAttributes(theme, 120, 90, 'runtime_widget'), variables: [ { key: 'widget_type', value: 'custom', type: 'String' } ] }) }
];

const GENERATED_SKIN_WIDGETS = Object.values(registry.skins).map(registryWidget).filter((item): item is WidgetDefinition => !!item)
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));

export const WIDGET_CATALOG: WidgetDefinition[] = [ ...STRUCTURAL_WIDGETS, ...GENERATED_SKIN_WIDGETS ];

export const getCatalogSkin = (definition: WidgetDefinition, theme: CloveTheme) => definition.skin?.[theme]
    || (theme === 'illumina-purple' ? definition.skin?.['illumina-light'] : null)
    || null;
