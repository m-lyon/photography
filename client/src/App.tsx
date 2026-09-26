import { useMemo, useState } from 'react';
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

export default function App() {
    const [index, setIndex] = useState(-1);
    const photos = useGetPhotos();
    // Variant URLs can 404 once pruned, and the lightbox has no srcSet fallback; it wants full
    // detail anyway, and the original's URL is stable
    const slides = useMemo(() => photos.map((photo) => ({ ...photo, srcSet: undefined })), [photos]);

    return (
        <>
            <header style={{ visibility: 'hidden' }}>Photos</header>
            <PhotoAlbum
                photos={photos}
                layout='rows'
                onClick={({ index }) => setIndex(index)}
                spacing={10}
                renderPhoto={(props) => <BlurUpPhoto {...props} />}
                componentsProps={{ imageProps: { loading: 'lazy', decoding: 'async' } }}
            />
            <Lightbox
                slides={slides}
                open={index >= 0}
                index={index}
                close={() => setIndex(-1)}
                // enable optional lightbox plugins
                plugins={[Fullscreen, Slideshow, Thumbnails, Zoom]}
            />
        </>
    );
}
