import { HABBO_STYLES } from 'truffle-text';

type TruffleTextFormat = string | Record<string, unknown>;

interface HabboXmlTextRenderingOverrides
{
    antiAliasType?: string;
    gridFitType?: string;
}

const isVolterFormat = (format: Record<string, unknown>) =>
    (format.fontFamily === 'Volter') || (format.fontFamily === 'Volter Bold');

/**
 * Flash TextController/TextFieldCache defaults embedded Volter XML fields to
 * advanced AA with pixel grid fitting. The named Truffle styles intentionally
 * retain the separate CSS/legacy regular defaults, so XML callers normalize
 * through this function instead of changing Truffle's presets globally.
 */
export const applyHabboXmlTextRendering = (format: Record<string, unknown>, overrides: HabboXmlTextRenderingOverrides = {}) =>
{
    if(!isVolterFormat(format)) return format;

    return {
        ...format,
        antiAliasType: overrides.antiAliasType || 'advanced',
        gridFitType: overrides.gridFitType || 'pixel',
        sharpness: format.sharpness ?? 0,
        thickness: format.thickness ?? 0,
        kerning: format.kerning ?? false
    };
};

/** Resolve a named Volter style for a Habbo/Flash-rendered text surface. */
export const resolveHabboXmlTextStyle = (style: TruffleTextFormat): TruffleTextFormat =>
{
    if(typeof style !== 'string')
    {
        return applyHabboXmlTextRendering(style, {
            antiAliasType: style.antiAliasType as string,
            gridFitType: style.gridFitType as string
        });
    }

    const format = HABBO_STYLES[style];

    return format ? applyHabboXmlTextRendering({ ...format }) : style;
};
