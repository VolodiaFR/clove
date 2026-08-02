import { FC, useEffect, useRef, useState } from 'react';
import { SkinRegistryView } from '../common/habbo';
import { HABBO_STYLES } from 'truffle-text';
import { HabboText } from './HabboUi';
import { CLOVE_THEMES, CloveTheme, getCatalogSkin, WidgetDefinition } from './widgetCatalog';

const thumbnailCache = new Map<string, string | null>();
const thumbnailSubscribers = new Map<string, Set<(url: string) => void>>();

const publishThumbnail = (key: string, url: string) =>
{
    thumbnailCache.set(key, url);
    thumbnailSubscribers.get(key)?.forEach(subscriber => subscriber(url));
    thumbnailSubscribers.delete(key);
};

const CachedSkinThumbnail: FC<{ registryId: string; layout: string }> = ({ registryId, layout }) =>
{
    const key = `${ registryId }:${ layout }:66x40`;
    const hostRef = useRef<HTMLSpanElement>(null);
    const [ visible, setVisible ] = useState(false);
    const [ owner, setOwner ] = useState(false);
    const [ url, setUrl ] = useState(() => thumbnailCache.get(key) || '');

    useEffect(() =>
    {
        const host = hostRef.current;

        if(!host) return;

        const observer = new IntersectionObserver(entries =>
        {
            if(entries.some(entry => entry.isIntersecting))
            {
                setVisible(true);
                observer.disconnect();
            }
        }, { rootMargin: '160px' });

        observer.observe(host);

        return () => observer.disconnect();
    }, []);

    useEffect(() =>
    {
        if(!visible || url) return;

        const cached = thumbnailCache.get(key);

        if(cached)
        {
            setUrl(cached);
            return;
        }

        const subscribers = thumbnailSubscribers.get(key) || new Set<(nextUrl: string) => void>();
        const subscriber = (nextUrl: string) => setUrl(nextUrl);

        subscribers.add(subscriber);
        thumbnailSubscribers.set(key, subscribers);

        if(cached === undefined)
        {
            thumbnailCache.set(key, null);
            setOwner(true);
        }

        return () =>
        {
            subscribers.delete(subscriber);
        };
    }, [ key, url, visible ]);

    useEffect(() =>
    {
        if(!owner) return;

        let attempts = 0;
        let disposed = false;
        const capture = () =>
        {
            if(disposed) return;

            const canvas = hostRef.current?.querySelector('canvas');
            const context = canvas?.getContext('2d', { willReadFrequently: true });
            const painted = canvas && context && canvas.width && canvas.height && context.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);

            if(painted)
            {
                publishThumbnail(key, canvas.toDataURL('image/png'));
                setOwner(false);
                return;
            }

            if(++attempts < 40) window.setTimeout(capture, 50);
            else
            {
                thumbnailCache.delete(key);
                setOwner(false);
            }
        };
        const timer = window.setTimeout(capture, 50);

        return () =>
        {
            disposed = true;
            window.clearTimeout(timer);
            if(thumbnailCache.get(key) === null) thumbnailCache.delete(key);
        };
    }, [ key, owner ]);

    return <span ref={ hostRef } className="clove-widget-thumbnail">
        { url ? <img src={ url } alt="" /> : visible && owner ? <SkinRegistryView registryId={ registryId } layout={ layout } /> : null }
    </span>;
};

export const LazyWidgetCard: FC<{ definition: WidgetDefinition; theme: CloveTheme; onAdd: (definition: WidgetDefinition) => void }> = ({ definition, theme, onAdd }) =>
{
    const preview = getCatalogSkin(definition, theme);
    const familyLabel = CLOVE_THEMES.find(item => item.id === theme)?.label || theme;

    return <button
        className={ `clove-widget-card ${ preview ? 'has-preview' : '' }` }
        type="button"
        aria-label={ `${ definition.label } ${ familyLabel }` }
        draggable
        title="Drag to the stage or double-click to add"
        onDragStart={ event =>
        {
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData('application/x-clove-widget', JSON.stringify({ id: definition.id, theme }));
        } }
        onDoubleClick={ () => onAdd(definition) }>
        { preview && <span className="clove-widget-preview"><CachedSkinThumbnail registryId={ preview.registryId } layout={ preview.layout } /></span> }
        <span><HabboText format={ HABBO_STYLES.u_bold }>{ definition.label }</HabboText><HabboText format={ HABBO_STYLES.u_small }>{ familyLabel }</HabboText></span>
    </button>;
};
