import { expect, test } from 'vitest';

import { NO_FILTER, effectiveFilter, filterOptions, matches, parseFilter, serializeFilter } from './filters.ts';
import type { Photo } from './useGetPhotos.tsx';

const photo = (overrides: Partial<Photo>): Photo => ({ src: 'a.jpg', width: 100, height: 50, ...overrides });

test('round-trips a filter through the query string, keeping unrelated parameters', () => {
    const search = serializeFilter({ tag: 'black swan', year: 2018, monochrome: true }, '?utm=x&tag=old');
    expect(search).toBe('?utm=x&tag=black+swan&year=2018&bw');
    expect(parseFilter(search)).toEqual({ tag: 'black swan', year: 2018, monochrome: true });
    expect(serializeFilter(NO_FILTER, '?tag=zoo&bw')).toBe('');
});

test('ignores malformed values in the query string', () => {
    expect(parseFilter('?tag=%20&year=soon')).toEqual(NO_FILTER);
    expect(parseFilter('?tag=Zoo')).toEqual({ ...NO_FILTER, tag: 'zoo' });
});

test('matches tags regardless of case and combines groups', () => {
    const zoo2015 = photo({ tags: ['Zoo'], year: 2015 });
    expect(matches(zoo2015, { ...NO_FILTER, tag: 'zoo' })).toBe(true);
    expect(matches(zoo2015, { ...NO_FILTER, tag: 'zoo', year: 2018 })).toBe(false);
    expect(matches(zoo2015, { ...NO_FILTER, monochrome: true })).toBe(false);
    expect(matches(photo({}), NO_FILTER)).toBe(true);
});

test('lists options with counts given the other selections', () => {
    const photos = [
        photo({ tags: ['Zoo'], year: 2015, monochrome: true }),
        photo({ tags: ['zoo', 'Brisbane'], year: 2015 }),
        photo({ tags: ['Forest'], year: 2018 }),
    ];
    const options = filterOptions(photos, { ...NO_FILTER, year: 2018 });
    expect(options.tags).toEqual([
        { value: 'brisbane', label: 'Brisbane', count: 0 },
        { value: 'forest', label: 'Forest', count: 1 },
        { value: 'zoo', label: 'Zoo', count: 0 },
    ]);
    // A year's count ignores the selected year, so switching years is always possible
    expect(options.years).toEqual([
        { value: 2018, label: '2018', count: 1 },
        { value: 2015, label: '2015', count: 2 },
    ]);
    expect(options.monochrome?.count).toBe(0);
});

test('offers black & white only when it would narrow the photos', () => {
    expect(filterOptions([photo({ monochrome: true })], NO_FILTER).monochrome).toBeNull();
    expect(filterOptions([photo({})], NO_FILTER).monochrome).toBeNull();
});

test('drops selections that no photo has', () => {
    const options = filterOptions([photo({ tags: ['Zoo'], year: 2015 }), photo({ year: 2018 })], NO_FILTER);
    expect(effectiveFilter({ tag: 'beach', year: 2015, monochrome: true }, options)).toEqual({
        ...NO_FILTER,
        year: 2015,
    });
});

test('drops a year when there is only one to choose from, since the bar hides it', () => {
    const options = filterOptions([photo({ year: 2018 }), photo({})], NO_FILTER);
    expect(effectiveFilter({ ...NO_FILTER, year: 2018 }, options)).toEqual(NO_FILTER);
});
