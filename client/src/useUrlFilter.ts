import { useCallback, useEffect, useState } from 'react';

import { type Filter, parseFilter, serializeFilter } from './filters.ts';

/** The gallery filter, kept in the query string so a filtered view can be shared and undone with Back. */
export function useUrlFilter(): [Filter, (filter: Filter) => void] {
    const [filter, setFilterState] = useState(() => parseFilter(window.location.search));

    useEffect(() => {
        const onPopState = () => setFilterState(parseFilter(window.location.search));
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    const setFilter = useCallback((next: Filter) => {
        const search = serializeFilter(next, window.location.search);
        // Re-selecting the current filter would otherwise add a Back step that changes nothing
        if (search !== window.location.search) {
            window.history.pushState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
        }
        setFilterState(next);
    }, []);

    return [filter, setFilter];
}
