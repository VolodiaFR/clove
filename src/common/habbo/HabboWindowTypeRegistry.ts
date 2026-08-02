import windowTypesJson from '../../clove/data/windowTypes.json';

interface HabboWindowTypeEntry
{
    type: string;
    style: string;
    intent: string;
    renderer: string;
    registryId: string;
    layout: string;
    windowLayout: string;
    color: string;
}

export interface HabboNodeLike
{
    type: string;
    attributes: Record<string, string>;
    editorSkin?: HabboResolvedSkin;
}

export interface HabboResolvedSkin
{
    registryId: string;
    layout: string;
}

const entries = (windowTypesJson as { entries: HabboWindowTypeEntry[] }).entries;

export const resolveWindowType = (type: string, style = '0', intent = '') =>
{
    let candidates = entries.filter(entry => entry.type === type && entry.style === style);

    // Illumina Purple was an accent family. Sulake only authored a frame and
    // button variants; every missing control intentionally uses Illumina Light.
    if(!candidates.length && [ '103', '104', '105' ].includes(style))
    {
        if(type === 'tab_button' || type === 'tab_container_button') candidates = entries.filter(entry => entry.type === 'button' && entry.style === '102');
        else if(type === 'input') candidates = entries.filter(entry => entry.type === 'border' && entry.style === '105');
        else candidates = entries.filter(entry => entry.type === type && entry.style === '100');
    }

    // Sulake source: core/window/graphics/SkinContainer.as. Skin renderers,
    // default attributes, and window layouts all retry style 0 when the
    // requested type/style pair is not registered.
    if(!candidates.length && style !== '0') candidates = entries.filter(entry => entry.type === type && entry.style === '0');

    return candidates.find(entry => intent && entry.intent === intent) || candidates.find(entry => entry.intent === 'default') || candidates[0] || null;
};

export const resolveHabboNodeSkin = (node: HabboNodeLike): HabboResolvedSkin | null =>
{
    if(node.editorSkin) return node.editorSkin;

    const entry = resolveWindowType(node.type, node.attributes.style || '0', node.attributes.intent || '');

    if(!entry || entry.renderer !== 'skin' || !entry.registryId || !entry.layout) return null;

    return { registryId: entry.registryId, layout: entry.layout };
};

export const styleFamily = (style = '0') =>
{
    const value = Number(style);

    if(value >= 200 && value < 300) return 'illumina-dark';
    if(value === 103 || value === 104 || value === 105) return 'illumina-purple';
    if(value >= 100 && value < 200) return 'illumina-light';
    if(value === 3 || value === 4 || value === 7) return 'ubuntu';

    return 'blue';
};
