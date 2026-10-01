import { useEffect, useMemo, useState } from 'react';
import PhotoAlbum from 'react-photo-album';

import Lightbox from 'yet-another-react-lightbox';
import 'yet-another-react-lightbox/styles.css';

// import optional lightbox plugins
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import Slideshow from 'yet-another-react-lightbox/plugins/slideshow';
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/plugins/thumbnails.css';

// import photos from './photos.ts';
import { useGetPhotos } from './useGetPhotos.tsx';
import { BlurUpPhoto } from './BlurUpPhoto.tsx';
import { FilterBar } from './FilterBar.tsx';
import { NO_FILTER, effectiveFilter, filterOptions, matches } from './filters.ts';
import { useUrlFilter } from './useUrlFilter.ts';
import './Gallery.css';

export default function App() {
    // Tracked by src rather than position: metadata refreshes can add or remove photos while the
    // lightbox is open, which would shift a stored index onto a different photo
    const [selectedSrc, setSelectedSrc] = useState<string | null>(null);
    const allPhotos = useGetPhotos();
    const [requestedFilter, setFilter] = useUrlFilter();
    // Until the photos arrive nothing can be checked, so a shared link's filter is kept as given
    const filter = useMemo(
        () =>
            allPhotos.length
                ? effectiveFilter(requestedFilter, filterOptions(allPhotos, requestedFilter))
                : requestedFilter,
        [allPhotos, requestedFilter]
    );
    // Counted against the filter actually applied, so a dropped selection does not disable the rest
    const options = useMemo(() => filterOptions(allPhotos, filter), [allPhotos, filter]);
    const photos = useMemo(() => allPhotos.filter((photo) => matches(photo, filter)), [allPhotos, filter]);
    const filterKey = JSON.stringify(filter);
    // Variant URLs can 404 once pruned, and the lightbox has no srcSet fallback; it wants full
    // detail anyway, and the original's URL is stable. Only the filtered photos, so paging through
    // the lightbox stays within the current selection
    const slides = useMemo(() => photos.map((photo) => ({ ...photo, srcSet: undefined })), [photos]);
    const index = selectedSrc === null ? -1 : slides.findIndex((slide) => slide.src === selectedSrc);

    // Otherwise the lightbox would reopen on the stale selection if that src ever came back
    useEffect(() => {
        if (selectedSrc !== null && index < 0) setSelectedSrc(null);
    }, [selectedSrc, index]);

    return (
        <>
            <header className='site-header'>
                <FilterBar options={options} filter={filter} onChange={setFilter} />
            </header>
            {/* Keyed on the filter so each new selection fades in instead of re-flowing in place */}
            <main className='gallery' key={filterKey}>
                {photos.length === 0 && allPhotos.length > 0 ? (
                    <p className='gallery__empty'>
                        No photos match this combination.{' '}
                        <button type='button' onClick={() => setFilter(NO_FILTER)}>
                            Show all
                        </button>
                    </p>
                ) : (
                    <PhotoAlbum
                        photos={photos}
                        layout='rows'
                        onClick={({ photo }) => setSelectedSrc(photo.src)}
                        spacing={10}
                        renderPhoto={(props) => <BlurUpPhoto {...props} />}
                        componentsProps={{ imageProps: { loading: 'lazy', decoding: 'async' } }}
                    />
                )}
            </main>
            <Lightbox
                slides={slides}
                open={index >= 0}
                index={index}
                close={() => setSelectedSrc(null)}
                // Metadata refreshes replace the slides array, which makes the lightbox reset to
                // `index`; following the current slide keeps that reset a no-op
                on={{ view: ({ index }) => setSelectedSrc(slides[index]?.src ?? null) }}
                // enable optional lightbox plugins
                plugins={[Fullscreen, Slideshow, Thumbnails, Zoom]}
            />
        </>
    );
}
