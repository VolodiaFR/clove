import { Children, ChangeEvent, FC, isValidElement, KeyboardEvent, ReactNode, SelectHTMLAttributes, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getTruffle } from 'truffle-text/react';
import { HabboSkinView, TruffleTextView, VOLTER_REGULAR } from '../truffle';
import { HabboText } from './HabboUi';

interface HabboSelectOption
{
    value: string;
    label: string;
    disabled: boolean;
}

const optionText = (value: ReactNode): string => Children.toArray(value).map(child =>
{
    if(typeof child === 'string' || typeof child === 'number') return String(child);
    if(isValidElement<{ children?: ReactNode }>(child)) return optionText(child.props.children);

    return '';
}).join('');

const collectOptions = (children: ReactNode): HabboSelectOption[] =>
{
    const options: HabboSelectOption[] = [];

    Children.forEach(children, child =>
    {
        if(!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return;

        if(child.type === 'option') options.push({ value: String(child.props.value ?? ''), label: optionText(child.props.children ?? child.props.value ?? ''), disabled: !!child.props.disabled });
        else if(child.props.children) options.push(...collectOptions(child.props.children));
    });

    return options;
};

const HabboSelectOptionView: FC<{ option: HabboSelectOption; selected: boolean; onChoose: () => void }> = ({ option, selected, onChoose }) =>
{
    const [ hovering, setHovering ] = useState(false);

    return <button
        type="button"
        role="option"
        aria-selected={ selected }
        disabled={ option.disabled }
        onMouseEnter={ () => setHovering(true) }
        onMouseLeave={ () => setHovering(false) }
        onClick={ onChoose }>
        <HabboSkinView skin="dropmenu-item" state={ hovering ? 'hovering' : (selected ? 'selected' : 'default') } />
        <TruffleTextView text={ option.label } format={ VOLTER_REGULAR } />
    </button>;
};

export const HabboSelect: FC<SelectHTMLAttributes<HTMLSelectElement>> = ({ children, className = '', disabled, value, onChange, 'aria-label': ariaLabel, ...props }) =>
{
    const options = useMemo(() => collectOptions(children), [ children ]);
    const selectedValue = String(value ?? '');
    const label = options.find(option => option.value === selectedValue)?.label || '';
    const [ isOpen, setIsOpen ] = useState(false);
    const [ menuPosition, setMenuPosition ] = useState({ left: 0, top: 0, width: 119, height: 21 });
    const elementRef = useRef<HTMLSpanElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const optionsRef = useRef(options);
    optionsRef.current = options;

    const positionMenu = useCallback(() =>
    {
        const element = elementRef.current;

        if(!element) return;

        const bounds = element.getBoundingClientRect();
        const truffle = getTruffle();
        const naturalWidth = truffle ? Math.max(bounds.width, ...optionsRef.current.map(option => truffle.measure(option.label.slice(0, 203), VOLTER_REGULAR).textWidth + 14)) : bounds.width;
        const naturalHeight = Math.max(bounds.height, (optionsRef.current.length * 15) + 7);
        const height = Math.min(naturalHeight, Math.max(21, window.innerHeight - 30));
        const width = Math.min(naturalWidth, window.innerWidth);

        setMenuPosition({
            left: Math.round(Math.max(0, Math.min(bounds.left, window.innerWidth - width))),
            top: Math.round(Math.max(0, Math.min(bounds.top, window.innerHeight - height))),
            width: Math.round(width),
            height: Math.round(height)
        });
    }, []);

    useLayoutEffect(() =>
    {
        if(!isOpen) return;

        positionMenu();
        const close = (event: MouseEvent) =>
        {
            const target = event.target as Node;

            if(!elementRef.current?.contains(target) && !menuRef.current?.contains(target)) setIsOpen(false);
        };
        const deactivate = () => setIsOpen(false);

        document.addEventListener('mousedown', close);
        window.addEventListener('blur', deactivate);
        window.addEventListener('resize', positionMenu);
        window.addEventListener('scroll', positionMenu, true);

        return () =>
        {
            document.removeEventListener('mousedown', close);
            window.removeEventListener('blur', deactivate);
            window.removeEventListener('resize', positionMenu);
            window.removeEventListener('scroll', positionMenu, true);
        };
    }, [ isOpen, positionMenu ]);

    const choose = (nextValue: string) =>
    {
        if(nextValue === selectedValue)
        {
            setIsOpen(false);
            return;
        }

        onChange?.({ target: { value: nextValue }, currentTarget: { value: nextValue }} as unknown as ChangeEvent<HTMLSelectElement>);
        setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) =>
    {
        if(event.key === 'Escape')
        {
            setIsOpen(false);
            return;
        }
        if(![ 'ArrowDown', 'ArrowUp', 'Home', 'End' ].includes(event.key)) return;

        event.preventDefault();
        const enabled = options.filter(option => !option.disabled);
        const currentIndex = enabled.findIndex(option => option.value === selectedValue);
        const nextIndex = event.key === 'Home' ? 0
            : event.key === 'End' ? enabled.length - 1
                : event.key === 'ArrowUp' ? Math.max(0, currentIndex - 1)
                    : Math.min(enabled.length - 1, currentIndex + 1);

        if(enabled[nextIndex]) choose(enabled[nextIndex].value);
    };
    const menu = isOpen && createPortal(
        <div ref={ menuRef } className="clove-habbo-select-menu" style={ menuPosition } role="listbox" aria-label={ ariaLabel || label }>
            <HabboSkinView skin="dropmenu-list" />
            <div className="clove-habbo-select-options">
                { options.map(option => <HabboSelectOptionView option={ option } selected={ option.value === selectedValue } key={ option.value } onChoose={ () => !option.disabled && choose(option.value) } />) }
            </div>
        </div>, document.body);

    return <span ref={ elementRef } className={ `clove-habbo-select ${ isOpen ? 'open' : '' } ${ className }` }>
        <HabboSkinView skin="dropmenu" />
        <span className="clove-habbo-select-label"><HabboText format={ VOLTER_REGULAR }>{ label }</HabboText></span>
        <button
            { ...(props as Record<string, unknown>) }
            className="clove-habbo-select-toggle"
            type="button"
            aria-label={ ariaLabel || label }
            aria-haspopup="listbox"
            aria-expanded={ isOpen }
            disabled={ disabled }
            onKeyDown={ onKeyDown }
            onClick={ () => setIsOpen(current => !current) } />
        { menu }
    </span>;
};
