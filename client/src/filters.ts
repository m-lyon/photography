import type { Photo } from './useGetPhotos.tsx';

/** At most one value per group; groups combine, so a tag and a year narrow each other. */
export interface Filter {
    /** Lowercased, since keywords are matched regardless of case */
    tag: string | null;
    year: number | null;
    monochrome: boolean;
}

export const NO_FILTER: Filter = { tag: null, year: null, monochrome: false };

export interface Option<T> {
    value: T;
    label: string;
    /** Photos it would show alongside the other groups' current selections */
    count: number;
}

export interface FilterOptions {
    tags: Option<string>[];
    years: Option<number>[];
    /** Null when it would not narrow anything: no photos are black & white, or all of them are */
    monochrome: Option<true> | null;
}

export function parseFilter(search: string): Filter {
    const params = new URLSearchParams(search);
    const year = Number(params.get('year'));
    return {
        tag: params.get('tag')?.trim().toLowerCase() || null,
        year: Number.isInteger(year) && year > 0 ? year : null,
        monochrome: params.has('bw'),
    };
}

/** Rewrites only the filter's own parameters, leaving any others in the URL alone. */
export function serializeFilter(filter: Filter, search: string): string {
    const params = new URLSearchParams(search);
    params.delete('tag');
    params.delete('year');
    params.delete('bw');
    if (filter.tag) params.set('tag', filter.tag);
    if (filter.year) params.set('year', String(filter.year));
    if (filter.monochrome) params.set('bw', '');
    // A bare "bw" reads better than "bw="
    const query = params.toString().replace(/(^|&)bw=(?=&|$)/, '$1bw');
    return query ? `?${query}` : '';
}

export const isFiltered = (filter: Filter) =>
    filter.tag !== null || filter.year !== null || filter.monochrome;

export function matches(photo: Photo, filter: Filter): boolean {
    if (filter.tag && !photo.tags?.some((tag) => tag.toLowerCase() === filter.tag)) return false;
    if (filter.year && photo.year !== filter.year) return false;
    if (filter.monochrome && !photo.monochrome) return false;
    return true;
}

/** Every value present across the photos, with how many each would show given the rest of `filter`. */
export function filterOptions(photos: Photo[], filter: Filter): FilterOptions {
    const count = (candidate: Filter) => photos.filter((photo) => matches(photo, candidate)).length;

    // Keywords that differ only in case are one tag, labelled as first seen
    const tagLabels = new Map<string, string>();
    for (const tag of photos.flatMap((photo) => photo.tags ?? [])) {
        if (!tagLabels.has(tag.toLowerCase())) tagLabels.set(tag.toLowerCase(), tag);
    }
    const tags = [...tagLabels]
        .map(([value, label]) => ({ value, label, count: count({ ...filter, tag: value }) }))
        .sort((a, b) => a.label.localeCompare(b.label));

    const years = [...new Set(photos.flatMap((photo) => (photo.year ? [photo.year] : [])))]
        // Newest first
        .sort((a, b) => b - a)
        .map((year) => ({ value: year, label: String(year), count: count({ ...filter, year }) }));

    const monochromeCount = photos.filter((photo) => photo.monochrome).length;
    const monochrome =
        monochromeCount > 0 && monochromeCount < photos.length
            ? { value: true as const, label: 'black & white', count: count({ ...filter, monochrome: true }) }
            : null;

    return { tags, years, monochrome };
}

/** Drops selections no photo has (a stale shared link, a tag since removed) so they are ignored. */
export function effectiveFilter(filter: Filter, options: FilterOptions): Filter {
    return {
        tag: options.tags.some((option) => option.value === filter.tag) ? filter.tag : null,
        year: options.years.some((option) => option.value === filter.year) ? filter.year : null,
        monochrome: filter.monochrome && options.monochrome !== null,
    };
}
