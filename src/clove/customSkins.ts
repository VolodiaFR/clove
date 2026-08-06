import { HabboSkinState, RegistrySkin, SkinRegistryExtension } from '../common/habbo';
import { CatalogSkin, CLOVE_THEMES, CloveTheme, WidgetDefinition } from './widgetCatalog';

export interface CloveSkinRect
{
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CloveCustomSkin
{
    id: string;
    name: string;
    kind: 'button' | 'region';
    assetName: string;
    fileName: string;
    dataUrl: string;
    imageWidth: number;
    imageHeight: number;
    states: { default: CloveSkinRect } & Partial<Record<HabboSkinState, CloveSkinRect>>;
}

export const customSkinWidgetId = (skin: CloveCustomSkin) => `custom:${ skin.id }`;

export const customSkinWidgetDefinition = (skin: CloveCustomSkin): WidgetDefinition =>
{
    const width = Math.max(1, skin.states.default.width);
    const height = Math.max(1, skin.states.default.height);
    const preview: CatalogSkin = {
        registryId: skin.id,
        layout: 'default',
        naturalWidth: width,
        naturalHeight: height,
        minWidth: 1,
        minHeight: 1
    };
    const themeSkins = Object.fromEntries(CLOVE_THEMES.map(theme => [ theme.id, preview ])) as Partial<Record<CloveTheme, CatalogSkin>>;

    return {
        id: customSkinWidgetId(skin),
        label: skin.name,
        description: skin.kind === 'button' ? 'Imported button with custom states.' : 'Imported image region.',
        category: 'Controls',
        width,
        height,
        skin: themeSkins,
        create: selectedTheme =>
        {
            const style = CLOVE_THEMES.find(theme => theme.id === selectedTheme)?.style || '0';
            const type = skin.kind === 'button' ? 'button' : 'region';

            return {
                type,
                attributes: {
                    x: '0',
                    y: '0',
                    width: String(width),
                    height: String(height),
                    width_min: '1',
                    height_min: '1',
                    params: '16',
                    style,
                    name: skin.id,
                    ...(selectedTheme.startsWith('illumina-') ? { theme: selectedTheme.replace('-', '_') } : {}),
                    ...(type === 'button' ? { caption: encodeURIComponent(skin.name) } : {})
                },
                editorSkin: { registryId: skin.id, layout: 'default' }
            };
        }
    };
};

export const CUSTOM_SKIN_STATES: HabboSkinState[] = [ 'default', 'hovering', 'pressed', 'selected', 'disabled' ];

const registrySkin = (skin: CloveCustomSkin): RegistrySkin =>
{
    const defaultRect = skin.states.default;
    const stateEntries = Object.entries(skin.states).filter(([ , rect ]) => !!rect) as [ HabboSkinState, CloveSkinRect ][];
    const templates: RegistrySkin['templates'] = Object.fromEntries(stateEntries.map(([ state, rect ]) => [ state, {
        asset: skin.assetName,
        entities: [ { name: 'project_slice', rect: [ rect.x, rect.y, rect.width, rect.height ] as [number, number, number, number], scaleH: 'fixed', scaleV: 'fixed' } ]
    } ]));

    return {
        id: skin.id,
        name: skin.name,
        states: stateEntries.map(([ state ]) => ({ name: state, layout: 'default', template: state })),
        templates,
        layouts: {
            default: {
                transparent: true,
                entities: [ {
                    name: 'project_slice',
                    rect: [ 0, 0, defaultRect.width, defaultRect.height ],
                    scaleH: 'stretch',
                    scaleV: 'stretch'
                } ]
            }
        }
    };
};

export const customSkinsRegistryExtension = (skins: CloveCustomSkin[]): SkinRegistryExtension => ({
    assets: Object.fromEntries(skins.map(skin => [ skin.assetName, skin.dataUrl ])),
    skins: Object.fromEntries(skins.map(skin => [ skin.id, registrySkin(skin) ]))
});

export const normalizeCustomSkin = (skin: CloveCustomSkin): CloveCustomSkin | null =>
{
    if(!skin || typeof skin.id !== 'string' || typeof skin.dataUrl !== 'string' || !/^data:image\/[A-Za-z0-9.+-]+;base64,/.test(skin.dataUrl)) return null;

    const imageWidth = Math.max(1, Math.round(Number(skin.imageWidth) || 1));
    const imageHeight = Math.max(1, Math.round(Number(skin.imageHeight) || 1));
    const states = Object.fromEntries(Object.entries(skin.states || {}).flatMap(([ state, rect ]) =>
    {
        if(!CUSTOM_SKIN_STATES.includes(state as HabboSkinState) || !rect) return [];

        const x = Math.max(0, Math.min(imageWidth - 1, Math.round(Number(rect.x) || 0)));
        const y = Math.max(0, Math.min(imageHeight - 1, Math.round(Number(rect.y) || 0)));
        const width = Math.max(1, Math.min(imageWidth - x, Math.round(Number(rect.width) || 1)));
        const height = Math.max(1, Math.min(imageHeight - y, Math.round(Number(rect.height) || 1)));

        return [ [ state, { x, y, width, height } ] ];
    }));

    if(!states.default) return null;

    const defaultRect = states.default as CloveSkinRect;
    const normalizedStates = Object.fromEntries(Object.entries(states).map(([ state, rect ]) =>
    {
        if(state === 'default' || !rect) return [ state, rect ];

        return [ state, clampRectLike(rect, imageWidth, imageHeight, defaultRect.width, defaultRect.height) ];
    })) as CloveCustomSkin['states'];

    return {
        id: skin.id.replace(/[^A-Za-z0-9_.:-]/g, '_'),
        name: String(skin.name || 'Custom skin').slice(0, 80),
        kind: skin.kind === 'region' ? 'region' : 'button',
        assetName: String(skin.assetName || `${ skin.id }_asset`).replace(/[^A-Za-z0-9_.:-]/g, '_'),
        fileName: String(skin.fileName || 'custom.png').slice(0, 160),
        dataUrl: skin.dataUrl,
        imageWidth,
        imageHeight,
        states: normalizedStates
    };
};

const clampRectLike = (rect: CloveSkinRect, imageWidth: number, imageHeight: number, width: number, height: number): CloveSkinRect =>
{
    const safeWidth = Math.max(1, Math.min(imageWidth, Math.round(width)));
    const safeHeight = Math.max(1, Math.min(imageHeight, Math.round(height)));
    const x = Math.max(0, Math.min(imageWidth - safeWidth, Math.round(Number(rect.x) || 0)));
    const y = Math.max(0, Math.min(imageHeight - safeHeight, Math.round(Number(rect.y) || 0)));

    return { x, y, width: safeWidth, height: safeHeight };
};
