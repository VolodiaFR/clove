import { ChangeEvent, FC, RefObject } from 'react';
import { HABBO_STYLES } from 'truffle-text';
import { HabboButton, HabboCheckbox, HabboText, UbuntuWindow } from './HabboUi';
import { HabboSelect } from './HabboSelect';

type CloveAlignment = 'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v' | 'distribute-h' | 'distribute-v' | 'distribute-grid';

interface CloveToolbarProps
{
    meta: string;
    selectedCount: number;
    fileInputRef: RefObject<HTMLInputElement>;
    projectInputRef: RefObject<HTMLInputElement>;
    skinInputRef: RefObject<HTMLInputElement>;
    onOpenFile: (event: ChangeEvent<HTMLInputElement>) => void;
    onOpenProject: (event: ChangeEvent<HTMLInputElement>) => void;
    onOpenSkin: (event: ChangeEvent<HTMLInputElement>) => void;
    onOpenXmlClick: () => void;
    onOpenProjectClick: () => void;
    onOpenSkinClick: () => void;
    onNew: () => void;
    onSaveTsx: () => void;
    onSaveProject: () => void;
    onSavePng: () => void;
    exportingTsx: boolean;
    exportingPng: boolean;
    pngReady: boolean;
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onDelete: () => void;
    mode: 'edit' | 'preview';
    onMode: (mode: 'edit' | 'preview') => void;
    snap: number;
    onSnap: (value: number) => void;
    zoom: number;
    onZoom: (value: number) => void;
    debugRects: boolean;
    onDebugRects: (value: boolean) => void;
    resolveLocalization: boolean;
    onResolveLocalization: (value: boolean) => void;
    onAlign: (alignment: CloveAlignment) => void;
    updateStatus: CloveUpdateStatus;
    onUpdateClick: () => void;
}

const updateStatusLabel = (status: CloveUpdateStatus) =>
{
    if(status.phase === 'ready') return `Update ${ status.version || '' } ready`;

    return '';
};

export const CloveToolbar: FC<CloveToolbarProps> = props =>
{
    const { meta, selectedCount, fileInputRef, projectInputRef, skinInputRef, onOpenFile, onOpenProject, onOpenSkin, onOpenXmlClick, onOpenProjectClick, onOpenSkinClick, onNew, onSaveTsx, onSaveProject, onSavePng, exportingTsx, exportingPng, pngReady, canUndo, canRedo, onUndo, onRedo, onDelete, mode, onMode, snap, onSnap, zoom, onZoom, debugRects, onDebugRects, resolveLocalization, onResolveLocalization, onAlign, updateStatus, onUpdateClick } = props;
    const updateLabel = updateStatusLabel(updateStatus);
    const updateAccessory = updateLabel ? <button className={ `clove-update-indicator is-${ updateStatus.phase }` } type="button" onClick={ onUpdateClick } aria-label={ updateLabel } title={ updateLabel }>
        <img src="/assets/images/library/1147_event_notification_icon_png.png" width={ 25 } height={ 25 } alt="" draggable={ false } />
        <HabboText format={ HABBO_STYLES.u_bold } color={ 0xFFFFFF }>{ updateLabel }</HabboText>
    </button> : updateStatus.currentVersion ? <HabboText className="clove-version-label" format={ HABBO_STYLES.u_regular } color={ 0xFFFFFF }>{ updateStatus.currentVersion }</HabboText> : null;

    return <UbuntuWindow className={ `clove-toolbar-window ${ selectedCount >= 2 ? 'has-alignment-tools' : '' }` } title="Clove" meta={ meta } metaFormat={ HABBO_STYLES.u_bold } titleAccessory={ updateAccessory } desktopControls>
        <nav className="clove-toolbar" aria-label="Document toolbar">
            <input ref={ fileInputRef } type="file" accept=".xml,.bin,text/xml" hidden onChange={ onOpenFile } />
            <input ref={ projectInputRef } type="file" accept=".json,.clove.json,application/json" hidden onChange={ onOpenProject } />
            <input ref={ skinInputRef } type="file" accept="image/*" hidden onChange={ onOpenSkin } />
            <HabboButton type="button" label="New Window" onClick={ onNew } />
            <HabboButton type="button" label="Import XML" onClick={ onOpenXmlClick } />
            <HabboButton type="button" label="Import Image" onClick={ onOpenSkinClick } />
            <HabboButton type="button" label="Import Project" onClick={ onOpenProjectClick } />
            <span className="clove-toolbar-separator" />
            <HabboButton type="button" label="Save Project" onClick={ onSaveProject } />
            <HabboButton type="button" label={ exportingTsx ? 'Exporting TSX…' : 'Save TSX' } onClick={ onSaveTsx } disabled={ exportingTsx } />
            <HabboButton type="button" label={ exportingPng ? 'Rendering…' : pngReady ? 'Save PNG' : 'PNG loading…' } onClick={ onSavePng } disabled={ exportingPng || !pngReady } />
            <span className="clove-toolbar-separator" />
            <HabboButton type="button" label="Undo" onClick={ onUndo } disabled={ !canUndo } />
            <HabboButton type="button" label="Redo" onClick={ onRedo } disabled={ !canRedo } />
            <HabboButton type="button" label="Delete" onClick={ onDelete } disabled={ !selectedCount } />
            <span className="clove-toolbar-separator" />
            <div className="clove-mode-switch" role="group" aria-label="Editor mode">
                <HabboButton className={ mode === 'edit' ? 'active' : '' } type="button" label="Edit" onClick={ () => onMode('edit') } />
                <HabboButton className={ mode === 'preview' ? 'active' : '' } type="button" label="Preview" onClick={ () => onMode('preview') } />
            </div>
            <span className="clove-toolbar-separator" />
            <label className="clove-toolbar-field"><HabboText>Snap</HabboText><HabboSelect aria-label="Snap" value={ snap } onChange={ event => onSnap(Number(event.target.value)) }>{ [ 1, 2, 4, 8, 10 ].map(value => <option key={ value } value={ value }>{ value } px</option>) }</HabboSelect></label>
            <label className="clove-toolbar-field"><HabboText>Zoom</HabboText><HabboSelect aria-label="Zoom" value={ zoom } onChange={ event => onZoom(Number(event.target.value)) }>{ [ 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2 ].map(value => <option key={ value } value={ value }>{ Math.round(value * 100) }%</option>) }</HabboSelect></label>
            <span className="clove-toolbar-separator" />
            <HabboCheckbox label="Rects" checked={ debugRects } onChange={ event => onDebugRects(event.target.checked) } />
            <HabboCheckbox label="External Texts" checked={ mode === 'preview' || resolveLocalization } disabled={ mode === 'preview' } onChange={ event => onResolveLocalization(event.target.checked) } />
            { selectedCount >= 2 && <div className="clove-alignbar">
                { ([ [ 'left', 'Left' ], [ 'right', 'Right' ], [ 'top', 'Top' ], [ 'bottom', 'Bottom' ], [ 'center-h', 'Center H' ], [ 'center-v', 'Center V' ] ] as [CloveAlignment, string][]).map(([ alignment, label ]) => <HabboButton key={ alignment } type="button" label={ label } onClick={ () => onAlign(alignment) } />) }
                { selectedCount >= 3 && <><HabboButton type="button" label="Distribute H" onClick={ () => onAlign('distribute-h') } /><HabboButton type="button" label="Distribute V" onClick={ () => onAlign('distribute-v') } /></> }
                { selectedCount >= 4 && <HabboButton type="button" label="Distribute Grid" onClick={ () => onAlign('distribute-grid') } /> }
            </div> }
        </nav>
    </UbuntuWindow>;
};
