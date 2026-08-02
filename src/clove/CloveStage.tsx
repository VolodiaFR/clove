import { CSSProperties, DragEvent, FC, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { HabboScrollArea } from './HabboUi';

interface CloveStageProps
{
    stageRef: RefObject<HTMLDivElement>;
    width: number;
    height: number;
    zoom: number;
    marquee: CSSProperties | null;
    onDrop: (event: DragEvent<HTMLDivElement>) => void;
    onPick: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    children: ReactNode;
}

export const CloveStage: FC<CloveStageProps> = ({ stageRef, width, height, zoom, marquee, onDrop, onPick, onPointerDown, children }) => <section className="clove-stage-panel" onDragOver={ event =>
{
    if([ 'application/x-clove-widget', 'application/x-clove-skin', 'application/x-clove-asset' ].some(type => event.dataTransfer.types.includes(type)))
    {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }
} } onDrop={ onDrop }>
    <HabboScrollArea className="clove-stage-scroll-area"><div className="clove-stage-scroller" onPointerDownCapture={ onPick } onPointerDown={ onPointerDown }>
        <div className="clove-stage-canvas" style={ { width: width * zoom, height: height * zoom } }>
            <div ref={ stageRef } className="clove-stage" style={ { width, height, transform: `scale(${ zoom })` } }>{ children }</div>
        </div>
        { marquee && <div className="clove-marquee" style={ marquee } /> }
    </div></HabboScrollArea>
</section>;
