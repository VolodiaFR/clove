import { FC, useMemo } from 'react';
import { HabboSkinState, SkinRegistryLayer, SkinRegistryView } from '../common/habbo/SkinRegistryView';

type HabboSkin = 'frame-3' | 'border-5' | 'border-white' | 'border-slot' | 'dropmenu' | 'dropmenu-list' | 'dropmenu-item' | 'tab-3' | 'button-shiny' | 'close-3' | 'scaler-3' | 'scroll-up' | 'scroll-down' | 'scroll-track' | 'scroll-thumb';

interface HabboSkinViewProps
{
    className?: string;
    skin: HabboSkin;
    state?: HabboSkinState;
    color?: number;
}

const ALIASES: Record<HabboSkin, Omit<SkinRegistryLayer, 'state'>[]> = {
    'frame-3': [ { registryId: 'habbo_skin_frame_3', layout: 'frame_3' } ],
    'border-5': [ { registryId: 'habbo_skin_border_5', layout: 'border_5' } ],
    'border-white': [ { registryId: 'habbo_skin_border_white', layout: 'border_white' } ],
    'border-slot': [ { registryId: 'habbo_skin_border_slot', layout: 'border_slot' } ],
    // dropmenu_frame already contains the right-side arrow. Layering
    // dropmenu_button over it draws the arrow twice on editor controls.
    'dropmenu': [ { registryId: 'habbo_skin_dropmenu', layout: 'dropmenu_frame' } ],
    'dropmenu-list': [ { registryId: 'habbo_skin_dropmenu', layout: 'dropmenu_frame' } ],
    'dropmenu-item': [ { registryId: 'habbo_skin_dropmenu', layout: 'dropmenu_item' } ],
    'tab-3': [ { registryId: 'habbo_skin_button_tab_3', layout: 'button_tab_3' } ],
    'button-shiny': [ { registryId: 'habbo_skin_button_shiny_default', layout: 'button_shiny' } ],
    'close-3': [ { registryId: 'habbo_skin_button_close_3', layout: 'button_close_3' } ],
    'scaler-3': [ { registryId: 'habbo_skin_scaler_3', layout: 'scaler_3' } ],
    'scroll-up': [ { registryId: 'habbo_skin_scrollbar', layout: 'scrollbar_button_up', width: 17, height: 16 } ],
    'scroll-down': [ { registryId: 'habbo_skin_scrollbar', layout: 'scrollbar_button_down', width: 17, height: 16 } ],
    'scroll-track': [ { registryId: 'habbo_skin_scrollbar', layout: 'scrollbar_track_vertical', width: 17 } ],
    'scroll-thumb': [ { registryId: 'habbo_skin_scrollbar', layout: 'scrollbar_lift_vertical', width: 17 } ]
};

export const HabboSkinView: FC<HabboSkinViewProps> = props =>
{
    const { className = '', skin, state = 'default', color = 0xFFFFFF } = props;
    const layers = useMemo(() => ALIASES[skin].map(layer => ({ ...layer, state })), [ skin, state ]);

    return <SkinRegistryView className={ className } layers={ layers } color={ color } />;
};
