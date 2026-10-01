import { type ReactNode, useLayoutEffect, useRef } from 'react';

import { type Filter, type FilterOptions, type Option, NO_FILTER, isFiltered } from './filters.ts';
import './FilterBar.css';

interface FilterBarProps {
    options: FilterOptions;
    filter: Filter;
    onChange: (filter: Filter) => void;
}

function FilterButton<T>({
    option,
    active,
    onSelect,
}: {
    option: Option<T>;
    active: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type='button'
            className={`filter-bar__option${active ? ' filter-bar__option--active' : ''}`}
            aria-pressed={active}
            // An active option stays enabled so it can always be cleared
            disabled={!active && option.count === 0}
            onClick={onSelect}
        >
            {option.label}
        </button>
    );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className='filter-bar__group' role='group' aria-label={label}>
            {children}
        </div>
    );
}

// Each row scrolls sideways on its own when it is wider than a phone screen
function Row({
    secondary = false,
    activeKey,
    children,
}: {
    secondary?: boolean;
    /** Changes when the selection does, the only time the active option is brought into view */
    activeKey: string;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);

    // A shared link can select an option that starts off screen, so bring it into view. Only
    // when it is cut off, so this never fights the visitor's own scrolling
    useLayoutEffect(() => {
        const row = ref.current;
        const active = row?.querySelector<HTMLElement>('.filter-bar__option--active');
        if (!row || !active) return;
        const left = active.offsetLeft - row.scrollLeft;
        if (left < 0 || left + active.offsetWidth > row.clientWidth) {
            row.scrollLeft = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
        }
    }, [activeKey]);

    return (
        <div ref={ref} className={`filter-bar__row${secondary ? ' filter-bar__row--secondary' : ''}`}>
            <div className='filter-bar__track'>{children}</div>
        </div>
    );
}

// Quiet rows of words above the gallery; selecting the active option again clears it
export function FilterBar({ options, filter, onChange }: FilterBarProps) {
    const { tags, years, monochrome } = options;
    // A single year has nothing to choose between
    const showYears = years.length > 1;
    if (tags.length === 0 && !showYears && !monochrome) return null;
    const activeKey = JSON.stringify(filter);

    const all = (
        <Group label='All photos'>
            <FilterButton
                option={{ value: null, label: 'all', count: 1 }}
                active={!isFiltered(filter)}
                onSelect={() => onChange(NO_FILTER)}
            />
        </Group>
    );
    const subjects = tags.length > 0 && (
        <Group label='Subject'>
            {tags.map((option) => (
                <FilterButton
                    key={option.value}
                    option={option}
                    active={filter.tag === option.value}
                    onSelect={() => onChange({ ...filter, tag: filter.tag === option.value ? null : option.value })}
                />
            ))}
        </Group>
    );
    const yearGroup = showYears && (
        <Group label='Year'>
            {years.map((option) => (
                <FilterButton
                    key={option.value}
                    option={option}
                    active={filter.year === option.value}
                    onSelect={() => onChange({ ...filter, year: filter.year === option.value ? null : option.value })}
                />
            ))}
        </Group>
    );
    const toneGroup = monochrome && (
        <Group label='Tone'>
            <FilterButton
                option={monochrome}
                active={filter.monochrome}
                onSelect={() => onChange({ ...filter, monochrome: !filter.monochrome })}
            />
        </Group>
    );

    return (
        <nav className='filter-bar' aria-label='Filter photos'>
            {subjects ? (
                <>
                    <Row activeKey={activeKey}>
                        {all}
                        {subjects}
                    </Row>
                    {/* Year and tone refine a subject, so they sit underneath it, quieter */}
                    {(yearGroup || toneGroup) && (
                        <Row secondary activeKey={activeKey}>
                            {yearGroup}
                            {toneGroup}
                        </Row>
                    )}
                </>
            ) : (
                <Row activeKey={activeKey}>
                    {all}
                    {yearGroup}
                    {toneGroup}
                </Row>
            )}
        </nav>
    );
}
