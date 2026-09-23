import { useState } from 'react';
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

    return (
        <>
            <header style={{ visibility: 'hidden' }}>Photos</header>
            <PhotoAlbum
                photos={photos}
                layout='rows'
                onClick={({ index }) => setIndex(index)}
                spacing={10}
                // Album width: #root is capped at 1280px with 2rem padding each side
                sizes={{
                    size: '1280px',
                    sizes: [{ viewport: '(max-width: 1344px)', size: 'calc(100vw - 4rem)' }],
                }}
                renderPhoto={(props) => <BlurUpPhoto {...props} />}
            />
            <Lightbox
                slides={photos}
                open={index >= 0}
                index={index}
                close={() => setIndex(-1)}
                // enable optional lightbox plugins
                plugins={[Fullscreen, Slideshow, Thumbnails, Zoom]}
            />
        </>
    );
}
