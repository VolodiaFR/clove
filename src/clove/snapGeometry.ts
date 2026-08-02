export interface CloveSnapRect
{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CloveSnapResult
{
    deltaX: number;
    deltaY: number;
    guideX?: number;
    guideY?: number;
}

const nearestAnchor = (moving: number[], targets: number[], threshold: number) =>
{
    let best: { adjustment: number; guide: number } | null = null;

    for(const source of moving)
    {
        for(const target of targets)
        {
            const adjustment = target - source;

            if(Math.abs(adjustment) > threshold) continue;
            if(!best || Math.abs(adjustment) < Math.abs(best.adjustment)) best = { adjustment, guide: target };
        }
    }

    return best;
};

export const snapRectToSiblings = (moving: CloveSnapRect, deltaX: number, deltaY: number, siblings: CloveSnapRect[], threshold = 4): CloveSnapResult =>
{
    const left = moving.x + deltaX;
    const top = moving.y + deltaY;
    const xSnap = nearestAnchor(
        [ left, left + (moving.width / 2), left + moving.width ],
        siblings.flatMap(item => [ item.x, item.x + (item.width / 2), item.x + item.width ]),
        threshold
    );
    const ySnap = nearestAnchor(
        [ top, top + (moving.height / 2), top + moving.height ],
        siblings.flatMap(item => [ item.y, item.y + (item.height / 2), item.y + item.height ]),
        threshold
    );

    return {
        deltaX: deltaX + (xSnap?.adjustment || 0),
        deltaY: deltaY + (ySnap?.adjustment || 0),
        guideX: xSnap?.guide,
        guideY: ySnap?.guide
    };
};

export const boundsOfRects = (rects: CloveSnapRect[]): CloveSnapRect =>
{
    const left = Math.min(...rects.map(rect => rect.x));
    const top = Math.min(...rects.map(rect => rect.y));
    const right = Math.max(...rects.map(rect => rect.x + rect.width));
    const bottom = Math.max(...rects.map(rect => rect.y + rect.height));

    return { id: 'selection', x: left, y: top, width: right - left, height: bottom - top };
};
