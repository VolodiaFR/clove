import { ChangeEvent, FC, PointerEvent as ReactPointerEvent, useMemo, useState } from 'react';
import { HabboSkinState } from '../common/habbo';
import { CloveCustomSkin, CloveSkinRect, CUSTOM_SKIN_STATES } from './customSkins';
import { HabboSelect } from './HabboSelect';
import { HabboButton, HabboInput, HabboScrollArea, HabboText, UbuntuWindow } from './HabboUi';
import './CustomSkinImportDialog.scss';

export interface CloveCustomSkinFile
{
    fileName: string;
    dataUrl: string;
    width: number;
    height: number;
}

interface CustomSkinImportDialogProps
{
    file: CloveCustomSkinFile;
    onCancel: () => void;
    onCreate: (skins: CloveCustomSkin[]) => void;
}

const STATE_LABELS: Record<HabboSkinState, string> = {
    default: 'Default',
    active: 'Active',
    hovering: 'Hover',
    pressed: 'Pressed',
    selected: 'Selected',
    disabled: 'Disabled'
};

const clampRect = (rect: CloveSkinRect, imageWidth: number, imageHeight: number): CloveSkinRect =>
{
    const x = Math.max(0, Math.min(imageWidth - 1, Math.round(rect.x)));
    const y = Math.max(0, Math.min(imageHeight - 1, Math.round(rect.y)));

    return {
        x,
        y,
        width: Math.max(1, Math.min(imageWidth - x, Math.round(rect.width))),
        height: Math.max(1, Math.min(imageHeight - y, Math.round(rect.height)))
    };
};

const evenBoundaries = (size: number, parts: number) => parts > 1
    ? Array.from({ length: parts - 1 }, (_value, index) => Math.round(size * (index + 1) / parts))
    : [];

const CropPreview: FC<{ file: CloveCustomSkinFile; rect?: CloveSkinRect; maxWidth?: number; maxHeight?: number }> = ({ file, rect, maxWidth = 180, maxHeight = 72 }) =>
{
    if(!rect) return <div className="clove-skin-crop-preview empty"><HabboText>Not defined</HabboText></div>;

    const scale = Math.min(1, maxWidth / rect.width, maxHeight / rect.height);

    return <div className="clove-skin-crop-preview" style={ { width: Math.max(1, rect.width * scale), height: Math.max(1, rect.height * scale) } }>
        <img src={ file.dataUrl } alt="" style={ {
            width: file.width * scale,
            height: file.height * scale,
            transform: `translate(${ -rect.x * scale }px, ${ -rect.y * scale }px)`
        } } />
    </div>;
};

export const CustomSkinImportDialog: FC<CustomSkinImportDialogProps> = ({ file, onCancel, onCreate }) =>
{
    const initialName = file.fileName.replace(/\.[^.]+$/i, '').replace(/[^A-Za-z0-9 _-]/g, ' ').trim() || 'Custom button';
    const [ name, setName ] = useState(initialName);
    const [ kind, setKind ] = useState<'button' | 'region'>('button');
    const [ activeState, setActiveState ] = useState<HabboSkinState>('default');
    const [ states, setStates ] = useState<CloveCustomSkin['states']>({ default: { x: 0, y: 0, width: file.width, height: file.height }});
    const [ dragStart, setDragStart ] = useState<{ x: number; y: number } | null>(null);
    const [ importMode, setImportMode ] = useState<'region' | 'grid'>('region');
    const [ zoom, setZoom ] = useState(Math.min(8, Math.max(1, Math.floor(640 / Math.max(file.width, file.height)))));
    const [ divisions, setDivisions ] = useState({ horizontal: 0, vertical: 0 });
    const [ boundaries, setBoundaries ] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
    const [ creating, setCreating ] = useState(false);
    const activeRect = states[activeState];
    const definedStateCount = useMemo(() => Object.values(states).filter(Boolean).length, [ states ]);
    const gridRects = useMemo(() =>
    {
        const rects: CloveSkinRect[] = [];
        const xPositions = [ 0, ...boundaries.x, file.width ];
        const yPositions = [ 0, ...boundaries.y, file.height ];

        for(let yIndex = 0; yIndex < yPositions.length - 1; yIndex++)
        {
            for(let xIndex = 0; xIndex < xPositions.length - 1; xIndex++)
            {
                rects.push({
                    x: xPositions[xIndex],
                    y: yPositions[yIndex],
                    width: xPositions[xIndex + 1] - xPositions[xIndex],
                    height: yPositions[yIndex + 1] - yPositions[yIndex]
                });
            }
        }

        return rects.slice(0, 1000);
    }, [ boundaries, file.height, file.width ]);

    const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        const bounds = event.currentTarget.getBoundingClientRect();

        return {
            x: Math.max(0, Math.min(file.width - 1, Math.floor((event.clientX - bounds.left) * file.width / bounds.width))),
            y: Math.max(0, Math.min(file.height - 1, Math.floor((event.clientY - bounds.top) * file.height / bounds.height)))
        };
    };
    const updateActiveRect = (update: Partial<CloveSkinRect>) => setStates(current => ({
        ...current,
        [activeState]: clampRect({ ...(current[activeState] || current.default), ...update }, file.width, file.height)
    }));
    const beginSelection = (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        if(event.button !== 0) return;

        const point = pointFromEvent(event);

        event.currentTarget.setPointerCapture(event.pointerId);
        setDragStart(point);
        setStates(current => ({ ...current, [activeState]: { x: point.x, y: point.y, width: 1, height: 1 }}));
    };
    const moveSelection = (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        if(!dragStart || !event.currentTarget.hasPointerCapture(event.pointerId)) return;

        const point = pointFromEvent(event);
        const x = Math.min(dragStart.x, point.x);
        const y = Math.min(dragStart.y, point.y);

        setStates(current => ({
            ...current,
            [activeState]: { x, y, width: Math.abs(point.x - dragStart.x) + 1, height: Math.abs(point.y - dragStart.y) + 1 }
        }));
    };
    const finishSelection = (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setDragStart(null);
    };
    const changeDivisions = (direction: 'horizontal' | 'vertical') => (event: ChangeEvent<HTMLInputElement>) =>
    {
        const size = direction === 'horizontal' ? file.height : file.width;
        const parts = Math.max(0, Math.min(size, Math.round(Number(event.target.value) || 0)));

        setDivisions(current => ({ ...current, [direction]: parts }));
        setBoundaries(current => direction === 'horizontal'
            ? { ...current, y: evenBoundaries(file.height, parts) }
            : { ...current, x: evenBoundaries(file.width, parts) });
    };
    const updateBoundaryAt = (axis: 'x' | 'y', index: number, sheet: HTMLElement, clientX: number, clientY: number) =>
    {
        const boundsRect = sheet.getBoundingClientRect();
        const size = axis === 'x' ? file.width : file.height;
        const pointer = axis === 'x' ? clientX - boundsRect.left : clientY - boundsRect.top;
        const coordinate = Math.round(pointer * size / (axis === 'x' ? boundsRect.width : boundsRect.height));

        setBoundaries(current =>
        {
            const values = [ ...current[axis] ];
            const minimum = index ? values[index - 1] + 1 : 1;
            const maximum = index < values.length - 1 ? values[index + 1] - 1 : size - 1;

            values[index] = Math.max(minimum, Math.min(maximum, coordinate));

            return { ...current, [axis]: values };
        });
    };
    const beginBoundaryDrag = (axis: 'x' | 'y', index: number) => (event: ReactPointerEvent<HTMLButtonElement>) =>
    {
        if(event.button > 0) return;

        const sheet = event.currentTarget.parentElement;

        if(!sheet) return;

        event.preventDefault();
        const move = (moveEvent: PointerEvent) => updateBoundaryAt(axis, index, sheet, moveEvent.clientX, moveEvent.clientY);
        const finish = () =>
        {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', finish);
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
    };
    const changeRectField = (field: keyof CloveSkinRect) => (event: ChangeEvent<HTMLInputElement>) => updateActiveRect({ [field]: Number(event.target.value) });
    const createSkin = (skinName: string, rects: CloveCustomSkin['states'], skinKind: CloveCustomSkin['kind'], source = file): CloveCustomSkin =>
    {
        const key = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${ Date.now() }-${ Math.random().toString(16).slice(2) }`;
        const id = `project:${ skinName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'image' }:${ key }`;

        return {
            id,
            name: skinName.trim(),
            kind: skinKind,
            assetName: `${ id }:asset`,
            fileName: source.fileName,
            dataUrl: source.dataUrl,
            imageWidth: source.width,
            imageHeight: source.height,
            states: rects
        };
    };
    const create = async () =>
    {
        if(!name.trim() || creating) return;

        if(importMode === 'grid')
        {
            if(!gridRects.length) return;

            setCreating(true);
            const sourceImage = new Image();
            const loaded = new Promise<void>((resolve, reject) =>
            {
                sourceImage.onload = () => resolve();
                sourceImage.onerror = () => reject(new Error('The imported image could not be sliced.'));
            });

            sourceImage.src = file.dataUrl;

            try
            {
                await loaded;
                const baseFileName = file.fileName.replace(/\.[^.]+$/i, '') || 'image';
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');

                if(!context) return;

                const skins = gridRects.map((rect, index) =>
                {
                    canvas.width = rect.width;
                    canvas.height = rect.height;
                    context.imageSmoothingEnabled = false;
                    context.clearRect(0, 0, rect.width, rect.height);
                    context.drawImage(sourceImage, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
                    const sliceFile: CloveCustomSkinFile = { fileName: `${ baseFileName }-${ index + 1 }.png`, dataUrl: canvas.toDataURL('image/png'), width: rect.width, height: rect.height };

                    return createSkin(`${ name.trim() } ${ index + 1 }`, { default: { x: 0, y: 0, width: rect.width, height: rect.height }}, 'region', sliceFile);
                });

                onCreate(skins);
            }
            finally
            {
                setCreating(false);
            }
            return;
        }

        if(states.default) onCreate([ createSkin(name, states, kind) ]);
    };

    return <div className="clove-dialog-backdrop clove-skin-import-backdrop" role="presentation">
        <UbuntuWindow className="clove-skin-import-dialog" title="Import Image" meta={ `${ file.fileName } · ${ file.width } × ${ file.height } px` } role="dialog" ariaLabel="Import Image" onClose={ onCancel }>
            <div className="clove-skin-import-meta">
                <label><HabboText>Name</HabboText><HabboInput autoFocus caretAtEnd value={ name } maxLength={ 80 } onChange={ event => setName(event.target.value) } /></label>
                <label><HabboText>Slice mode</HabboText><HabboSelect value={ importMode } onChange={ event => setImportMode(event.target.value as 'region' | 'grid') }><option value="region">Region / states</option><option value="grid">Uniform grid</option></HabboSelect></label>
                { importMode === 'region' && <label><HabboText>Semantics</HabboText><HabboSelect value={ kind } onChange={ event => setKind(event.target.value as 'button' | 'region') }><option value="button">Button</option><option value="region">Image region</option></HabboSelect></label> }
                <label className="clove-picker-zoom-field"><HabboText>Picker zoom</HabboText><HabboSelect value={ zoom } onChange={ event => setZoom(Number(event.target.value)) }>{ [ 1, 2, 3, 4, 5, 6, 7, 8 ].map(value => <option key={ value } value={ value }>{ value }×</option>) }</HabboSelect></label>
            </div>
            <div className="clove-skin-import-workspace">
                { importMode === 'region' ? <aside>
                    <HabboText className="clove-skin-states-heading">{ `States · ${ definedStateCount }` }</HabboText>
                    { CUSTOM_SKIN_STATES.map(state => <HabboButton type="button" className={ `${ activeState === state ? 'active' : '' } ${ states[state] ? 'is-defined' : '' }` } label={ STATE_LABELS[state] } key={ state } onClick={ () => setActiveState(state) } />) }
                    { activeState !== 'default' && <HabboButton className="secondary" type="button" label="Copy default" onClick={ () => setStates(current => ({ ...current, [activeState]: { ...current.default }})) } /> }
                    { activeState !== 'default' && activeRect && <HabboButton className="secondary" type="button" label="Clear state" onClick={ () => setStates(current => ({ ...current, [activeState]: undefined })) } /> }
                </aside> : <aside className="clove-grid-slicer">
                    <label><HabboText>Divide Horizontally</HabboText><HabboInput caretAtEnd type="text" inputMode="numeric" value={ divisions.horizontal } onChange={ changeDivisions('horizontal') } /></label>
                    <label><HabboText>Divide Vertically</HabboText><HabboInput caretAtEnd type="text" inputMode="numeric" value={ divisions.vertical } onChange={ changeDivisions('vertical') } /></label>
                </aside> }
                <HabboScrollArea className="clove-skin-sheet-column"><div className="clove-skin-sheet-content">
                    <div className={ `clove-skin-sheet ${ importMode === 'grid' ? 'grid-mode' : '' }` } style={ { width: file.width * zoom, height: file.height * zoom } } onPointerDown={ importMode === 'region' ? beginSelection : undefined } onPointerMove={ importMode === 'region' ? moveSelection : undefined } onPointerUp={ importMode === 'region' ? finishSelection : undefined } onPointerCancel={ importMode === 'region' ? finishSelection : undefined }>
                        <img src={ file.dataUrl } alt="Imported sprite sheet" draggable={ false } />
                        { importMode === 'region' && activeRect && <span className="selection" style={ { left: `${ activeRect.x / file.width * 100 }%`, top: `${ activeRect.y / file.height * 100 }%`, width: `${ activeRect.width / file.width * 100 }%`, height: `${ activeRect.height / file.height * 100 }%` } } /> }
                        { importMode === 'grid' && gridRects.map((rect, index) => <span className="grid-cell" key={ index } style={ { left: `${ rect.x / file.width * 100 }%`, top: `${ rect.y / file.height * 100 }%`, width: `${ rect.width / file.width * 100 }%`, height: `${ rect.height / file.height * 100 }%` } } />) }
                        { importMode === 'grid' && boundaries.x.map((position, index) => <button type="button" className="grid-divider vertical" aria-label={ `Adjust vertical divider ${ index + 1 }` } key={ `x-${ index }` } style={ { left: `${ position / file.width * 100 }%` } } onPointerDown={ beginBoundaryDrag('x', index) } />) }
                        { importMode === 'grid' && boundaries.y.map((position, index) => <button type="button" className="grid-divider horizontal" aria-label={ `Adjust horizontal divider ${ index + 1 }` } key={ `y-${ index }` } style={ { top: `${ position / file.height * 100 }%` } } onPointerDown={ beginBoundaryDrag('y', index) } />) }
                    </div>
                    { importMode === 'region' && <div className="clove-skin-rect-fields">
                        { ([ 'x', 'y', 'width', 'height' ] as (keyof CloveSkinRect)[]).map(field => <label key={ field }><HabboText>{ field }</HabboText><HabboInput caretAtEnd type="text" inputMode="numeric" value={ activeRect?.[field] ?? '' } onChange={ changeRectField(field) } /></label>) }
                    </div> }
                </div></HabboScrollArea>
                { importMode === 'grid' ? <div className="clove-skin-preview-column is-grid">{ gridRects.map((rect, index) => <div className="clove-grid-region-preview" key={ index }><CropPreview file={ file } rect={ rect } maxWidth={ 82 } maxHeight={ 62 } /></div>) }</div> : <div className="clove-skin-preview-column"><HabboText>{ STATE_LABELS[activeState] }</HabboText><CropPreview file={ file } rect={ activeRect } /><HabboText>{ activeRect ? `${ activeRect.width } × ${ activeRect.height } px` : 'No region' }</HabboText></div> }
            </div>
            <footer><HabboButton type="button" label="Cancel" onClick={ onCancel } /><HabboButton className="primary" type="button" label={ creating ? 'Creating…' : importMode === 'grid' ? `Create ${ gridRects.length } part${ gridRects.length === 1 ? '' : 's' }` : 'Create region' } disabled={ creating || !name.trim() || (importMode === 'region' ? !states.default : !gridRects.length) } onClick={ create } /></footer>
        </UbuntuWindow>
    </div>;
};
