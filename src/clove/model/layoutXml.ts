interface CloveVariable
{
    key: string;
    value: string;
    type: string;
}

export interface CloveNode
{
    id: string;
    type: string;
    attributes: Record<string, string>;
    originalAttributes: Record<string, string>;
    variables: CloveVariable[];
    originalVariables: CloveVariable[];
    children: CloveNode[];
    editorSkin?: { registryId: string; layout: string };
    editorAssetId?: string;
    isNew?: boolean;
}

export interface CloveDocument
{
    name: string;
    width: number;
    height: number;
    attributes: Record<string, string>;
    sourceXml: string;
    nodes: CloveNode[];
    structureChanged: boolean;
}

export interface NewCloveNode
{
    type: string;
    attributes: Record<string, string>;
    variables?: CloveVariable[];
    children?: NewCloveNode[];
    editorSkin?: { registryId: string; layout: string };
    editorAssetId?: string;
}

const CONTAINER_TYPES = new Set([ 'frame', 'container', 'border', 'region', 'tab_context', 'tab_content', 'itemlist_horizontal', 'itemlist_vertical' ]);
let newNodeSequence = 0;

const attributesOf = (element: Element) => Object.fromEntries(Array.from(element.attributes, attribute => [ attribute.name, attribute.value ]));
const directChild = (element: Element, tagName: string) => Array.from(element.children).find(child => child.tagName === tagName);

const widgetChildren = (element: Element) =>
{
    if(element.tagName === 'layout') return Array.from(directChild(element, 'window')?.children || []);

    return Array.from(directChild(element, 'children')?.children || []);
};

const parseVariables = (element: Element): CloveVariable[] =>
{
    const variablesElement = directChild(element, 'variables');

    return Array.from(variablesElement?.children || [])
        .filter(child => child.tagName === 'var')
        .map(child => ({
            key: child.getAttribute('key') || '',
            value: child.getAttribute('value') || '',
            type: child.getAttribute('type') || 'String'
        }));
};

const parseNode = (element: Element, path: number[]): CloveNode =>
{
    const attributes = attributesOf(element);
    const variables = parseVariables(element);

    return {
        id: path.join('.'),
        type: element.tagName,
        attributes,
        originalAttributes: { ...attributes },
        variables,
        originalVariables: variables.map(variable => ({ ...variable })),
        children: widgetChildren(element).map((child, index) => parseNode(child, [ ...path, index ]))
    };
};

export const parseLayoutXml = (sourceXml: string): CloveDocument =>
{
    const parsed = new DOMParser().parseFromString(sourceXml, 'application/xml');
    const parserError = parsed.querySelector('parsererror');

    if(parserError) throw new Error(parserError.textContent || 'The selected file is not valid XML.');

    const layout = parsed.documentElement;

    if(layout.tagName !== 'layout') throw new Error(`Expected a <layout> root, received <${ layout.tagName }>.`);

    const attributes = attributesOf(layout);

    return {
        name: attributes.name || 'untitled',
        width: Number(attributes.width || 320),
        height: Number(attributes.height || 200),
        attributes,
        sourceXml,
        nodes: widgetChildren(layout).map((child, index) => parseNode(child, [ index ])),
        structureChanged: false
    };
};

export const createNewDocument = (name = 'new_window', width = 420, height = 280, theme = 'ubuntu') =>
{
    const style = theme === 'ubuntu' ? '3' : theme === 'blue' ? '0' : theme === 'habbo-dark' ? '1' : theme === 'habbo-gold' ? '2' : theme === 'illumina-dark' ? '200' : theme === 'illumina-purple' ? '103' : '100';
    const marginTop = theme === 'ubuntu' ? '35' : ([ 'blue', 'habbo-dark', 'habbo-gold' ].includes(theme) ? '25' : '34');
    const frameColor = theme === 'habbo-dark' ? '0xff4c4c4c' : theme === 'habbo-gold' ? '0xfffac200' : '0xff418db0';
    const themeAttribute = theme.startsWith('illumina-') ? ` theme="${ theme.replace('-', '_') }"` : '';

    return parseLayoutXml(
        `<?xml version="1.0" encoding="UTF-8"?>\n<layout name="${ name }" width="${ width }" height="${ height }" version="0.1">\n  <window>\n    <frame x="0" y="0" width="${ width }" height="${ height }" params="98305" style="${ style }"${ themeAttribute } name="${ name }_frame" caption="${ encodeCaption('New Window') }" color="${ frameColor }">\n      <children/>\n      <variables>\n        <var key="margin_left" value="6" type="int"/>\n        <var key="margin_top" value="${ marginTop }" type="int"/>\n        <var key="margin_right" value="6" type="int"/>\n        <var key="margin_bottom" value="6" type="int"/>\n      </variables>\n    </frame>\n  </window>\n</layout>\n`);
};

export const flattenNodes = (nodes: CloveNode[]): CloveNode[] => nodes.flatMap(node => [ node, ...flattenNodes(node.children) ]);
export const findNode = (document: CloveDocument, id: string) => flattenNodes(document.nodes).find(node => node.id === id) || null;
export const canHaveChildren = (node: CloveNode) => CONTAINER_TYPES.has(node.type);

export const findParentNode = (document: CloveDocument, id: string): CloveNode | null =>
{
    const visit = (nodes: CloveNode[], parent: CloveNode | null = null): CloveNode | null =>
    {
        for(const node of nodes)
        {
            if(node.id === id) return parent;

            const found = visit(node.children, node);

            if(found) return found;
        }

        return null;
    };

    return visit(document.nodes);
};

const updateNodes = (nodes: CloveNode[], id: string, update: (node: CloveNode) => CloveNode): CloveNode[] => nodes.map(node =>
{
    if(node.id === id) return update(node);

    return { ...node, children: updateNodes(node.children, id, update) };
});

export const updateNodeAttributes = (document: CloveDocument, id: string, attributes: Record<string, string>): CloveDocument => ({
    ...document,
    nodes: updateNodes(document.nodes, id, node => ({ ...node, attributes: { ...node.attributes, ...attributes }}))
});

export const updateNodeVariables = (document: CloveDocument, id: string, values: Record<string, { value: string; type?: string }>): CloveDocument => ({
    ...document,
    structureChanged: true,
    nodes: updateNodes(document.nodes, id, node =>
    {
        const variables = node.variables.map(variable => values[variable.key]
            ? { ...variable, value: values[variable.key].value, type: values[variable.key].type || variable.type }
            : variable);

        for(const [ key, next ] of Object.entries(values))
        {
            if(!variables.some(variable => variable.key === key)) variables.push({ key, value: next.value, type: next.type || 'String' });
        }

        return { ...node, variables };
    })
});

export const removeNodeVariables = (document: CloveDocument, id: string, keys: string[]): CloveDocument => ({
    ...document,
    structureChanged: true,
    nodes: updateNodes(document.nodes, id, node => ({ ...node, variables: node.variables.filter(variable => !keys.includes(variable.key)) }))
});

const instantiateNode = (node: NewCloveNode): CloveNode =>
{
    const variables = (node.variables || []).map(variable => ({ ...variable }));

    return {
        id: `new-${ ++newNodeSequence }`,
        type: node.type,
        attributes: { ...node.attributes },
        originalAttributes: {},
        variables,
        originalVariables: [],
        children: (node.children || []).map(instantiateNode),
        editorSkin: node.editorSkin ? { ...node.editorSkin } : undefined,
        editorAssetId: node.editorAssetId,
        isNew: true
    };
};

export const addNode = (document: CloveDocument, parentId: string, input: NewCloveNode) =>
{
    const node = instantiateNode(input);

    if(!parentId) return { document: { ...document, structureChanged: true, nodes: [ ...document.nodes, node ] }, node };

    return {
        document: {
            ...document,
            structureChanged: true,
            nodes: updateNodes(document.nodes, parentId, parent => ({ ...parent, children: [ ...parent.children, node ] }))
        },
        node
    };
};

export const removeNode = (document: CloveDocument, id: string): CloveDocument =>
{
    const remove = (nodes: CloveNode[]): CloveNode[] => nodes.filter(node => node.id !== id).map(node => ({ ...node, children: remove(node.children) }));

    return { ...document, structureChanged: true, nodes: remove(document.nodes) };
};

const cloneWithNewIds = (node: CloveNode): CloveNode => ({
    ...node,
    id: `new-${ ++newNodeSequence }`,
    attributes: {
        ...node.attributes,
        ...(node.attributes.name ? { name: `${ node.attributes.name }_copy` } : {}),
        x: String(Number(node.attributes.x || 0) + 10),
        y: String(Number(node.attributes.y || 0) + 10)
    },
    originalAttributes: {},
    originalVariables: [],
    editorSkin: node.editorSkin ? { ...node.editorSkin } : undefined,
    editorAssetId: node.editorAssetId,
    isNew: true,
    children: node.children.map(cloneWithNewIds)
});

export const cloneNode = (document: CloveDocument, id: string) =>
{
    const source = findNode(document, id);

    if(!source) return { document, node: null };

    const clone = cloneWithNewIds(source);
    const parent = findParentNode(document, id);

    if(!parent) return { document: { ...document, structureChanged: true, nodes: [ ...document.nodes, clone ] }, node: clone };

    return {
        document: {
            ...document,
            structureChanged: true,
            nodes: updateNodes(document.nodes, parent.id, node => ({ ...node, children: [ ...node.children, clone ] }))
        },
        node: clone
    };
};

export const copyNodeAsNew = (node: CloveNode, offset = 10): NewCloveNode => ({
    type: node.type,
    attributes: {
        ...node.attributes,
        ...(node.attributes.name ? { name: `${ node.attributes.name }_copy` } : {}),
        x: String(Number(node.attributes.x || 0) + offset),
        y: String(Number(node.attributes.y || 0) + offset)
    },
    variables: node.variables.map(variable => ({ ...variable })),
    children: node.children.map(child => copyNodeAsNew(child, 0)),
    editorSkin: node.editorSkin ? { ...node.editorSkin } : undefined,
    editorAssetId: node.editorAssetId
});

export type CloveNodeDropPosition = 'before' | 'inside' | 'after' | 'root';

const insertNodeAt = (nodes: CloveNode[], parentId: string, index: number, moving: CloveNode): CloveNode[] =>
{
    if(!parentId)
    {
        const next = [ ...nodes ];

        next.splice(Math.max(0, Math.min(index, next.length)), 0, moving);

        return next;
    }

    return nodes.map(node =>
    {
        if(node.id === parentId)
        {
            const children = [ ...node.children ];

            children.splice(Math.max(0, Math.min(index, children.length)), 0, moving);

            return { ...node, children };
        }

        return { ...node, children: insertNodeAt(node.children, parentId, index, moving) };
    });
};

export const moveNode = (document: CloveDocument, id: string, targetId: string, position: CloveNodeDropPosition = 'inside'): CloveDocument =>
{
    const moving = findNode(document, id);
    const target = targetId ? findNode(document, targetId) : null;

    if(!moving || id === targetId || flattenNodes(moving.children).some(node => node.id === targetId)) return document;
    if(position !== 'root' && !target) return document;
    if(position === 'inside' && (!target || !canHaveChildren(target))) return document;

    const without = removeNode(document, id);

    if(position === 'root') return { ...without, nodes: insertNodeAt(without.nodes, '', without.nodes.length, moving), structureChanged: true };

    if(position === 'inside')
    {
        const currentTarget = findNode(without, targetId);

        if(!currentTarget) return document;

        return { ...without, nodes: insertNodeAt(without.nodes, targetId, currentTarget.children.length, moving), structureChanged: true };
    }

    const targetParent = findParentNode(without, targetId);
    const siblings = targetParent ? targetParent.children : without.nodes;
    const targetIndex = siblings.findIndex(node => node.id === targetId);

    if(targetIndex < 0) return document;

    return {
        ...without,
        structureChanged: true,
        nodes: insertNodeAt(without.nodes, targetParent?.id || '', targetIndex + (position === 'after' ? 1 : 0), moving)
    };
};

export const displayCaption = (caption = '') =>
{
    try
    {
        return decodeURIComponent(caption);
    }
    catch
    {
        return caption;
    }
};

export const encodeCaption = (caption: string) => encodeURIComponent(caption);

const escapeAttribute = (value: string, quote: string) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll(quote, quote === '"' ? '&quot;' : '&apos;');

const patchStartTag = (startTag: string, changes: Record<string, string>) =>
{
    let next = startTag;

    for(const [ name, value ] of Object.entries(changes))
    {
        const expression = new RegExp(`(\\s${ name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') }\\s*=\\s*)(["'])(.*?)\\2`, 's');
        const match = next.match(expression);

        if(match) next = next.replace(expression, `${ match[1] }${ match[2] }${ escapeAttribute(value, match[2]) }${ match[2] }`);
        else next = next.replace(/\s*\/?\>$/, ending => ` ${ name }="${ escapeAttribute(value, '"') }"${ ending }`);
    }

    return next;
};

interface SourceElement
{
    tagName: string;
    start: number;
    startTagEnd: number;
    endTagStart: number;
    end: number;
    selfClosing: boolean;
    parent: SourceElement | null;
    children: SourceElement[];
}

interface SourcePatch
{
    start: number;
    end: number;
    value: string;
}

const markupEnd = (source: string, start: number) =>
{
    let quote = '';

    for(let index = start + 1; index < source.length; index++)
    {
        const character = source[index];

        if(quote)
        {
            if(character === quote) quote = '';
            continue;
        }

        if(character === '"' || character === '\'') quote = character;
        else if(character === '>') return index + 1;
    }

    throw new Error('Unterminated XML tag while preserving the source document.');
};

const parseSourceElements = (source: string) =>
{
    const roots: SourceElement[] = [];
    const stack: SourceElement[] = [];
    let cursor = 0;

    while(cursor < source.length)
    {
        const start = source.indexOf('<', cursor);

        if(start < 0) break;

        if(source.startsWith('<!--', start))
        {
            const end = source.indexOf('-->', start + 4);

            if(end < 0) throw new Error('Unterminated XML comment while preserving the source document.');
            cursor = end + 3;
            continue;
        }

        if(source.startsWith('<![CDATA[', start))
        {
            const end = source.indexOf(']]>', start + 9);

            if(end < 0) throw new Error('Unterminated CDATA section while preserving the source document.');
            cursor = end + 3;
            continue;
        }

        if(source.startsWith('<?', start))
        {
            const end = source.indexOf('?>', start + 2);

            if(end < 0) throw new Error('Unterminated XML processing instruction while preserving the source document.');
            cursor = end + 2;
            continue;
        }

        const end = markupEnd(source, start);
        const tag = source.slice(start, end);

        if(/^<!/.test(tag))
        {
            cursor = end;
            continue;
        }

        const closing = tag.match(/^<\s*\/\s*([A-Za-z_][\w:.-]*)/);

        if(closing)
        {
            const element = stack.pop();

            if(!element || element.tagName !== closing[1]) throw new Error(`Mismatched </${ closing[1] }> while preserving the source document.`);

            element.endTagStart = start;
            element.end = end;
            cursor = end;
            continue;
        }

        const opening = tag.match(/^<\s*([A-Za-z_][\w:.-]*)/);

        if(!opening)
        {
            cursor = end;
            continue;
        }

        const parent = stack[stack.length - 1] || null;
        const selfClosing = /\/\s*>$/.test(tag);
        const element: SourceElement = {
            tagName: opening[1],
            start,
            startTagEnd: end,
            endTagStart: selfClosing ? end : -1,
            end,
            selfClosing,
            parent,
            children: []
        };

        if(parent) parent.children.push(element);
        else roots.push(element);
        if(!selfClosing) stack.push(element);
        cursor = end;
    }

    if(stack.length) throw new Error(`Unterminated <${ stack[stack.length - 1].tagName }> while preserving the source document.`);

    return roots;
};

const sourceDirectChild = (element: SourceElement, tagName: string) => element.children.find(child => child.tagName === tagName) || null;
const sourceWidgetChildren = (element: SourceElement) => element.tagName === 'window'
    ? element.children
    : (sourceDirectChild(element, 'children')?.children || []);

const applyPatches = (source: string, base: number, patches: SourcePatch[]) =>
{
    let output = source;

    for(const patch of [ ...patches ].sort((left, right) => right.start - left.start))
    {
        const start = patch.start - base;
        const end = patch.end - base;

        if(start < 0 || end > output.length || start > end) throw new Error('An XML source patch escaped its owning element.');
        output = `${ output.slice(0, start) }${ patch.value }${ output.slice(end) }`;
    }

    return output;
};

const lineIndentAt = (source: string, index: number) =>
{
    const lineStart = Math.max(source.lastIndexOf('\n', index - 1), source.lastIndexOf('\r', index - 1)) + 1;
    const prefix = source.slice(lineStart, index);

    return /^\s*$/.test(prefix) ? prefix : '';
};

const serializeVariable = (variable: CloveVariable) => `<var key="${ escapeAttribute(variable.key, '"') }" value="${ escapeAttribute(variable.value, '"') }" type="${ escapeAttribute(variable.type, '"') }"/>`;

const serializeLossless = (document: CloveDocument) =>
{
    const source = document.sourceXml;
    const roots = parseSourceElements(source);
    const layout = roots.find(element => element.tagName === 'layout');
    const windowElement = layout && sourceDirectChild(layout, 'window');

    if(!layout || !windowElement) throw new Error('Could not locate the source <layout><window> structure.');

    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const sourceById = new Map<string, SourceElement>();
    const idBySource = new Map<SourceElement, string>();

    const collect = (elements: SourceElement[], path: number[]) => elements.forEach((element, index) =>
    {
        const id = [ ...path, index ].join('.');

        sourceById.set(id, element);
        idBySource.set(element, id);
        collect(sourceWidgetChildren(element), [ ...path, index ]);
    });

    collect(sourceWidgetChildren(windowElement), []);

    const allSourceElements = Array.from(sourceById.values());
    const firstNested = allSourceElements.find(element => element.parent && lineIndentAt(source, element.start).length > lineIndentAt(source, element.parent.start).length);
    const indentUnit = firstNested?.parent
        ? lineIndentAt(source, firstNested.start).slice(lineIndentAt(source, firstNested.parent.start).length) || '  '
        : '  ';

    const sequenceMatches = (elements: SourceElement[], nodes: CloveNode[]) => elements.length === nodes.length
        && elements.every((element, index) => idBySource.get(element) === nodes[index].id);

    const rebuildContent = (container: SourceElement, originalElements: SourceElement[], rendered: string[]) =>
    {
        const containerIndent = lineIndentAt(source, container.start);
        const childIndent = originalElements.length ? lineIndentAt(source, originalElements[0].start) : `${ containerIndent }${ indentUnit }`;
        const defaultSeparator = `${ newline }${ childIndent }`;

        if(!originalElements.length)
        {
            if(!rendered.length) return source.slice(container.startTagEnd, container.endTagStart);

            return `${ newline }${ childIndent }${ rendered.join(defaultSeparator) }${ newline }${ containerIndent }`;
        }

        const gaps: string[] = [];
        let cursor = container.startTagEnd;

        for(const element of originalElements)
        {
            gaps.push(source.slice(cursor, element.start));
            cursor = element.end;
        }

        gaps.push(source.slice(cursor, container.endTagStart));

        let output = gaps[0];

        rendered.forEach((value, index) =>
        {
            if(index) output += index < originalElements.length ? gaps[index] : defaultSeparator;
            output += value;
        });

        for(let index = Math.min(rendered.length, originalElements.length); index < gaps.length; index++) output += gaps[index];

        return output;
    };

    const serializeNewNode = (node: CloveNode, indent: string): string =>
    {
        const attributes = Object.entries(node.attributes)
            .filter(([ , value ]) => value !== undefined)
            .map(([ name, value ]) => ` ${ name }="${ escapeAttribute(value, '"') }"`)
            .join('');

        if(!node.children.length && !node.variables.length) return `<${ node.type }${ attributes }/>`;

        const childIndent = `${ indent }${ indentUnit }`;
        const valueIndent = `${ childIndent }${ indentUnit }`;
        let content = '';

        if(node.children.length)
        {
            const children = node.children.map(child => serializeNewNode(child, valueIndent)).join(`${ newline }${ valueIndent }`);

            content += `${ newline }${ childIndent }<children>${ newline }${ valueIndent }${ children }${ newline }${ childIndent }</children>`;
        }

        if(node.variables.length)
        {
            const variables = node.variables.map(serializeVariable).join(`${ newline }${ valueIndent }`);

            content += `${ newline }${ childIndent }<variables>${ newline }${ valueIndent }${ variables }${ newline }${ childIndent }</variables>`;
        }

        return `<${ node.type }${ attributes }>${ content }${ newline }${ indent }</${ node.type }>`;
    };

    const renderNode = (node: CloveNode, targetIndent = ''): string =>
    {
        const element = sourceById.get(node.id);

        if(!element) return serializeNewNode(node, targetIndent);

        const patches: SourcePatch[] = [];
        const startTag = source.slice(element.start, element.startTagEnd);
        const attributeChanges = Object.fromEntries(Object.entries(node.attributes).filter(([ key, value ]) => node.originalAttributes[key] !== value));

        if(Object.keys(attributeChanges).length)
        {
            patches.push({ start: element.start, end: element.startTagEnd, value: patchStartTag(startTag, attributeChanges) });
        }

        const variablesElement = sourceDirectChild(element, 'variables');
        const originalVariableElements = variablesElement?.children.filter(child => child.tagName === 'var') || [];
        const originalVariableByKey = new Map(originalVariableElements.map(variableElement =>
        {
            const tag = source.slice(variableElement.start, variableElement.startTagEnd);
            const key = tag.match(/\skey\s*=\s*(["'])(.*?)\1/s)?.[2] || '';

            return [ key, variableElement ];
        }));
        const newVariables = node.variables.filter(variable => !originalVariableByKey.has(variable.key));

        for(const variable of node.variables)
        {
            const variableElement = originalVariableByKey.get(variable.key);
            const original = node.originalVariables.find(value => value.key === variable.key);

            if(!variableElement || (original && original.value === variable.value && original.type === variable.type)) continue;

            const variableStartTag = source.slice(variableElement.start, variableElement.startTagEnd);

            patches.push({
                start: variableElement.start,
                end: variableElement.startTagEnd,
                value: patchStartTag(variableStartTag, { value: variable.value, type: variable.type })
            });
        }

        if(newVariables.length)
        {
            const nodeIndent = lineIndentAt(source, element.start) || targetIndent;
            const wrapperIndent = `${ nodeIndent }${ indentUnit }`;
            const variableIndent = `${ wrapperIndent }${ indentUnit }`;
            const variables = newVariables.map(serializeVariable).join(`${ newline }${ variableIndent }`);

            if(variablesElement?.selfClosing)
            {
                const opening = source.slice(variablesElement.start, variablesElement.startTagEnd).replace(/\/\s*>$/, '>');
                const value = `${ opening }${ newline }${ variableIndent }${ variables }${ newline }${ wrapperIndent }</variables>`;

                patches.push({ start: variablesElement.start, end: variablesElement.end, value });
            }
            else if(variablesElement)
            {
                const content = source.slice(variablesElement.startTagEnd, variablesElement.endTagStart);
                const trailing = content.match(/\s*$/)?.[0] || '';
                const insertAt = variablesElement.endTagStart - trailing.length;
                const hasContent = content.slice(0, content.length - trailing.length).trim().length > 0;

                patches.push({ start: insertAt, end: insertAt, value: `${ hasContent ? newline : '' }${ variableIndent }${ variables }` });
            }
            else
            {
                const block = `<variables>${ newline }${ variableIndent }${ variables }${ newline }${ wrapperIndent }</variables>`;
                const beforeClose = source.slice(element.startTagEnd, element.endTagStart);
                const trailing = beforeClose.match(/\s*$/)?.[0] || '';
                const insertAt = element.endTagStart - trailing.length;

                patches.push({ start: insertAt, end: insertAt, value: `${ newline }${ wrapperIndent }${ block }` });
            }
        }

        const originalChildren = sourceWidgetChildren(element);

        if(sequenceMatches(originalChildren, node.children))
        {
            node.children.forEach((child, index) =>
            {
                const childElement = originalChildren[index];
                const rendered = renderNode(child, lineIndentAt(source, childElement.start));
                const original = source.slice(childElement.start, childElement.end);

                if(rendered !== original) patches.push({ start: childElement.start, end: childElement.end, value: rendered });
            });
        }
        else
        {
            const childrenElement = sourceDirectChild(element, 'children');
            const nodeIndent = lineIndentAt(source, element.start) || targetIndent;
            const childIndent = childrenElement ? `${ lineIndentAt(source, childrenElement.start) }${ indentUnit }` : `${ nodeIndent }${ indentUnit }${ indentUnit }`;
            const rendered = node.children.map(child => renderNode(child, childIndent));

            if(childrenElement?.selfClosing)
            {
                const opening = source.slice(childrenElement.start, childrenElement.startTagEnd).replace(/\/\s*>$/, '>');
                const content = rendered.length ? `${ newline }${ childIndent }${ rendered.join(`${ newline }${ childIndent }`) }${ newline }${ lineIndentAt(source, childrenElement.start) }` : '';

                patches.push({ start: childrenElement.start, end: childrenElement.end, value: `${ opening }${ content }</children>` });
            }
            else if(childrenElement)
            {
                patches.push({
                    start: childrenElement.startTagEnd,
                    end: childrenElement.endTagStart,
                    value: rebuildContent(childrenElement, originalChildren, rendered)
                });
            }
            else if(rendered.length)
            {
                const wrapperIndent = `${ nodeIndent }${ indentUnit }`;
                const block = `<children>${ newline }${ childIndent }${ rendered.join(`${ newline }${ childIndent }`) }${ newline }${ wrapperIndent }</children>`;
                const insertBefore = variablesElement?.start ?? element.endTagStart;

                patches.push({ start: insertBefore, end: insertBefore, value: `${ newline }${ wrapperIndent }${ block }` });
            }
        }

        return applyPatches(source.slice(element.start, element.end), element.start, patches);
    };

    const originalRoots = sourceWidgetChildren(windowElement);
    const patches: SourcePatch[] = [];

    if(sequenceMatches(originalRoots, document.nodes))
    {
        document.nodes.forEach((node, index) =>
        {
            const element = originalRoots[index];
            const rendered = renderNode(node, lineIndentAt(source, element.start));
            const original = source.slice(element.start, element.end);

            if(rendered !== original) patches.push({ start: element.start, end: element.end, value: rendered });
        });
    }
    else
    {
        const indent = originalRoots.length ? lineIndentAt(source, originalRoots[0].start) : `${ lineIndentAt(source, windowElement.start) }${ indentUnit }`;
        const rendered = document.nodes.map(node => renderNode(node, indent));

        patches.push({
            start: windowElement.startTagEnd,
            end: windowElement.endTagStart,
            value: rebuildContent(windowElement, originalRoots, rendered)
        });
    }

    return applyPatches(source, 0, patches);
};

export const serializeLayoutXml = (document: CloveDocument) => serializeLossless(document);
