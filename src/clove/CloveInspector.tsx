import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { HABBO_STYLES } from 'truffle-text';
import { HabboCheckbox, HabboInput, HabboText } from './HabboUi';
import { CloveColorPicker, normalizeCloveColor } from './CloveColorPicker';
import { displayCaption, encodeCaption } from './model/layoutXml';

export const PropertyField: FC<{ name: string; value: string; type?: 'text' | 'boolean' | 'color'; onCommit: (value: string) => void }> = ({ name, value, type = 'text', onCommit }) =>
{
    const [ draft, setDraft ] = useState(value || '');
    const draftRef = useRef(draft);
    const committedRef = useRef(value || '');
    const onCommitRef = useRef(onCommit);

    draftRef.current = draft;
    onCommitRef.current = onCommit;

    const commitColorDraft = useCallback(() =>
    {
        if(type !== 'color') return;

        const next = normalizeCloveColor(draftRef.current, committedRef.current || '0xffffff');

        if(next === committedRef.current) return;

        draftRef.current = next;
        setDraft(next);
        committedRef.current = next;
        onCommitRef.current(next);
    }, [ type ]);

    useEffect(() =>
    {
        const next = value || '';

        committedRef.current = next;
        draftRef.current = next;
        setDraft(next);
    }, [ value ]);

    if(type === 'boolean') return (
        <HabboCheckbox className="clove-property clove-property-boolean" label={ name } checked={ draft !== 'false' } onChange={ event =>
        {
            const next = event.target.checked ? 'true' : 'false';
            setDraft(next);
            onCommit(next);
        } } />
    );

    const displayValue = name === 'caption' ? displayCaption(draft) : draft;

    if(type === 'color') return (
        <label className="clove-property">
            <HabboText>{ name.replaceAll('_', ' ') }</HabboText>
            <span className="clove-property-control clove-text-color">
                <CloveColorPicker value={ draft } label={ `Choose ${ name }` } onPreview={ next =>
                {
                    draftRef.current = next;
                    setDraft(next);
                } } onCommit={ next =>
                {
                    draftRef.current = next;
                    commitColorDraft();
                } } />
                <code>{ draft }</code>
            </span>
        </label>
    );

    return (
        <label className="clove-property">
            <HabboText>{ name === 'caption' ? 'text / caption' : name.replaceAll('_', ' ') }</HabboText>
            <span className="clove-property-control">
                <HabboInput value={ displayValue } onChange={ event =>
                {
                    const next = name === 'caption' ? encodeCaption(event.target.value) : event.target.value;
                    draftRef.current = next;
                    setDraft(next);
                } } onBlur={ () => draft !== value && onCommit(draft) } onKeyDown={ event =>
                {
                    if(event.key === 'Enter') event.currentTarget.blur();
                    if(event.key === 'Escape')
                    {
                        const next = value || '';
                        draftRef.current = next;
                        setDraft(next);
                        event.currentTarget.blur();
                    }
                } } />
            </span>
        </label>
    );
};

export const ColorVariableField: FC<{ value: string; onCommit: (value: string) => void }> = ({ value, onCommit }) =>
{
    const [ draft, setDraft ] = useState(value || '0x000000');
    const draftRef = useRef(draft);
    const committedRef = useRef(value || '0x000000');
    const onCommitRef = useRef(onCommit);

    draftRef.current = draft;
    onCommitRef.current = onCommit;

    const commitDraft = useCallback(() =>
    {
        const next = normalizeCloveColor(draftRef.current, committedRef.current);

        if(next === committedRef.current) return;

        draftRef.current = next;
        setDraft(next);
        committedRef.current = next;
        onCommitRef.current(next);
    }, []);

    useEffect(() =>
    {
        const next = value || '0x000000';

        committedRef.current = next;
        draftRef.current = next;
        setDraft(next);
    }, [ value ]);

    return <span className="clove-text-color">
        <CloveColorPicker value={ draft } label="Choose text color" onPreview={ next =>
        {
            draftRef.current = next;
            setDraft(next);
        } } onCommit={ next =>
        {
            draftRef.current = next;
            commitDraft();
        } } />
        <code>{ draft || 'style' }</code>
    </span>;
};

export const SectionHeading: FC<{ children: string; hint?: string }> = ({ children, hint }) => <div className="clove-inspector-heading"><HabboText format={ HABBO_STYLES.u_bold }>{ children }</HabboText>{ hint && <HabboText format={ HABBO_STYLES.u_small }>{ hint }</HabboText> }</div>;
