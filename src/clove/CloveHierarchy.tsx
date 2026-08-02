import { DragEvent, FC, useEffect, useRef, useState } from 'react';
import { HABBO_STYLES } from 'truffle-text';
import { canHaveChildren, CloveNode, CloveNodeDropPosition, displayCaption } from './model/layoutXml';
import { HabboCheckbox, HabboScrollArea, HabboText, UbuntuWindow } from './HabboUi';

const nodeLabel = (node: CloveNode) => node.attributes.name || displayCaption(node.attributes.caption) || 'unnamed';
const compactLabel = (value: string, limit = 28) => value.length > limit ? `${ value.slice(0, Math.max(1, limit - 3)).trimEnd() }...` : value;

export const visibleTreeNodeIds = (nodes: CloveNode[], collapsedIds: Set<string>): string[] => nodes.flatMap(node => [
    node.id,
    ...(collapsedIds.has(node.id) ? [] : visibleTreeNodeIds(node.children, collapsedIds))
]);

const TreeNode: FC<{
    node: CloveNode;
    selectedIds: string[];
    collapsedIds: Set<string>;
    rowIndices: Record<string, number>;
    onSelect: (id: string, additive?: boolean, range?: boolean) => void;
    onToggleVisible: (node: CloveNode) => void;
    onToggleCollapsed: (id: string) => void;
    onReparent: (id: string, targetId: string, position: CloveNodeDropPosition) => void;
    depth?: number;
    ancestorHidden?: boolean;
}> = ({ node, selectedIds, collapsedIds, rowIndices, onSelect, onToggleVisible, onToggleCollapsed, onReparent, depth = 0, ancestorHidden = false }) =>
{
    const hasChildren = node.children.length > 0;
    const collapsed = hasChildren && collapsedIds.has(node.id);
    const selfHidden = node.attributes.visible === 'false';
    const descendantsHidden = ancestorHidden || selfHidden;
    const [ dropPosition, setDropPosition ] = useState<Exclude<CloveNodeDropPosition, 'root'> | null>(null);
    const expandTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const cancelExpand = () =>
    {
        if(!expandTimerRef.current) return;
        clearTimeout(expandTimerRef.current);
        expandTimerRef.current = undefined;
    };

    useEffect(() => cancelExpand, []);
    const dropPositionAt = (event: DragEvent<HTMLDivElement>): Exclude<CloveNodeDropPosition, 'root'> =>
    {
        const bounds = event.currentTarget.getBoundingClientRect();
        const ratio = bounds.height ? (event.clientY - bounds.top) / bounds.height : .5;

        if(ratio < .3) return 'before';
        if(ratio > .7) return 'after';

        return canHaveChildren(node) ? 'inside' : (ratio < .5 ? 'before' : 'after');
    };

    return <li>
        <div
            className={ `clove-tree-row ${ dropPosition ? `drop-${ dropPosition }` : '' } ${ (rowIndices[node.id] || 0) % 2 ? 'is-alt' : '' } ${ selectedIds.includes(node.id) ? 'selected' : '' } ${ selfHidden ? 'is-hidden' : '' } ${ ancestorHidden ? 'is-inherited-hidden' : '' }` }
            style={ { paddingLeft: Math.min(48, depth * 10) } }
            draggable
            title={ canHaveChildren(node) ? 'Drag to reorder. Drop another node here to place it inside.' : 'Drag to reorder.' }
            onDragStart={ event =>
            {
                event.stopPropagation();
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-clove-node', node.id);
            } }
            onDragOver={ event =>
            {
                if(event.dataTransfer.types.includes('application/x-clove-node'))
                {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    const nextPosition = dropPositionAt(event);

                    if(nextPosition !== dropPosition) setDropPosition(nextPosition);
                    if(nextPosition === 'inside' && collapsed && !expandTimerRef.current)
                    {
                        expandTimerRef.current = setTimeout(() =>
                        {
                            expandTimerRef.current = undefined;
                            onToggleCollapsed(node.id);
                        }, 400);
                    }
                    else if(nextPosition !== 'inside') cancelExpand();
                }
            } }
            onDragLeave={ event =>
            {
                if(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                cancelExpand();
                setDropPosition(null);
            } }
            onDrop={ event =>
            {
                const sourceId = event.dataTransfer.getData('application/x-clove-node');

                if(sourceId)
                {
                    event.preventDefault();
                    event.stopPropagation();
                    // Paint state may not have committed during a fast drag/drop.
                    // The event coordinates are the source of truth for the move.
                    const position = dropPositionAt(event);

                    cancelExpand();
                    setDropPosition(null);
                    onReparent(sourceId, node.id, position);
                }
            } }>
            { hasChildren ? <button className={ `clove-tree-chevron ${ collapsed ? 'is-collapsed' : '' }` } type="button" draggable={ false } aria-label={ collapsed ? `Expand ${ nodeLabel(node) }` : `Collapse ${ nodeLabel(node) }` } aria-expanded={ !collapsed } onPointerDown={ event => event.stopPropagation() } onClick={ event =>
            {
                event.stopPropagation();
                onToggleCollapsed(node.id);
            } }><span /></button> : <span className="clove-tree-chevron-spacer" /> }
            <HabboCheckbox className="clove-tree-visibility" label="" aria-label="Toggle visibility" checked={ !selfHidden } disabled={ ancestorHidden } onClick={ event => event.stopPropagation() } onChange={ () => onToggleVisible(node) } />
            <button className="clove-tree-select" type="button" aria-label={ `${ nodeLabel(node) } [${ node.type }]` } onClick={ event => onSelect(node.id, event.ctrlKey || event.metaKey, event.shiftKey) }>
                <HabboText className="clove-tree-name">{ compactLabel(nodeLabel(node)) }</HabboText>
                <HabboText className="clove-tree-type" format={ HABBO_STYLES.u_small }>{ compactLabel(`[${ node.type }]`, 20) }</HabboText>
            </button>
        </div>
        { hasChildren && !collapsed && <ul>{ node.children.map(child => <TreeNode key={ child.id } node={ child } selectedIds={ selectedIds } collapsedIds={ collapsedIds } rowIndices={ rowIndices } onSelect={ onSelect } onToggleVisible={ onToggleVisible } onToggleCollapsed={ onToggleCollapsed } onReparent={ onReparent } depth={ depth + 1 } ancestorHidden={ descendantsHidden } />) }</ul> }
    </li>;
};

const HierarchyRootDropZone: FC<{ onReparent: (id: string, targetId: string, position: CloveNodeDropPosition) => void }> = ({ onReparent }) =>
{
    const [ active, setActive ] = useState(false);

    return <div className={ `clove-tree-root-drop ${ active ? 'active' : '' }` } onDragOver={ event =>
    {
        if(!event.dataTransfer.types.includes('application/x-clove-node')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setActive(true);
    } } onDragLeave={ event =>
    {
        if(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setActive(false);
    } } onDrop={ event =>
    {
        const sourceId = event.dataTransfer.getData('application/x-clove-node');

        if(!sourceId) return;
        event.preventDefault();
        event.stopPropagation();
        setActive(false);
        onReparent(sourceId, '', 'root');
    } }><HabboText>Drop here for top level</HabboText></div>;
};


interface CloveHierarchyProps
{
    nodes: CloveNode[];
    selectedIds: string[];
    collapsedIds: Set<string>;
    rowIndices: Record<string, number>;
    onSelect: (id: string, additive?: boolean, range?: boolean) => void;
    onToggleVisible: (node: CloveNode) => void;
    onToggleCollapsed: (id: string) => void;
    onReparent: (id: string, targetId: string, position: CloveNodeDropPosition) => void;
}

export const CloveHierarchy: FC<CloveHierarchyProps> = props =>
{
    const { nodes, selectedIds, collapsedIds, rowIndices, onSelect, onToggleVisible, onToggleCollapsed, onReparent } = props;

    return <UbuntuWindow className="clove-hierarchy-window" title="Hierarchy" meta={ `${ Object.keys(rowIndices).length } nodes` }>
        <HabboScrollArea className="clove-tree"><ul>{ nodes.map(node => <TreeNode key={ node.id } node={ node } selectedIds={ selectedIds } collapsedIds={ collapsedIds } rowIndices={ rowIndices } onSelect={ onSelect } onToggleVisible={ onToggleVisible } onToggleCollapsed={ onToggleCollapsed } onReparent={ onReparent } />) }</ul><HierarchyRootDropZone onReparent={ onReparent } /></HabboScrollArea>
    </UbuntuWindow>;
};
