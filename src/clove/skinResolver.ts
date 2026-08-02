import type { CloveNode } from './model/layoutXml';
import type { CatalogSkin } from './widgetCatalog';
import { resolveHabboNodeSkin } from '../common/habbo/HabboWindowTypeRegistry';

export { resolveWindowType, styleFamily } from '../common/habbo/HabboWindowTypeRegistry';

export const resolveNodeSkin = (node: CloveNode): CatalogSkin | null =>
{
    return resolveHabboNodeSkin(node);
};
