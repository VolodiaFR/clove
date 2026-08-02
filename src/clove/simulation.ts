export interface CloveSimulationData
{
    externalTexts: Record<string, string>;
}

export interface CloveNodeSimulation
{
    options?: string[];
    caption?: string;
    visible?: boolean;
    disabled?: boolean;
    selected?: boolean;
    geometry?: { left?: number; top?: number; width?: number; height?: number };
}

export interface CloveProjectScenario
{
    id: string;
    label: string;
    description: string;
    nodeSimulation: Record<string, CloveNodeSimulation>;
    activeTabs: Record<string, string>;
}

const CLOVE_ASSET_BASE = '/assets';

export const loadCloveSimulationData = async (): Promise<CloveSimulationData> =>
{
    const textsResponse = await fetch(`${ CLOVE_ASSET_BASE }/gamedata/ExternalTexts.json`);

    if(!textsResponse.ok)
    {
        throw new Error('Clove could not load its bundled ExternalTexts data.');
    }

    const externalTexts = await textsResponse.json() as Record<string, string>;

    return { externalTexts };
};
