import { useEffect, useState } from 'react';
import axios from 'axios';

interface Image {
    src: string;
    width: number;
    height: number;
}
export interface Photo extends Image {
    /** Resized versions, smallest first; absent until the server has generated them */
    srcSet?: Image[];
    /** Tiny data URI shown blurred while the photo loads */
    placeholder?: string;
}

// The API answers 503 while it is still indexing, and omits srcSet until variants are generated
const RETRY_MS = 2000;
const MAX_RETRIES = 10;

export function useGetPhotos(): Photo[] {
    const [photos, setPhotos] = useState<Photo[]>([]);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        let attempt = 0;

        const retry = () => {
            attempt += 1;
            if (!cancelled && attempt <= MAX_RETRIES) {
                timer = setTimeout(fetchImages, RETRY_MS * attempt);
            }
        };

        const fetchImages = async () => {
            try {
                const response = await axios.get(import.meta.env.VITE_METADATA_ENDPOINT);
                if (cancelled) return;
                if (!Array.isArray(response.data)) {
                    console.error('Unexpected image metadata response');
                    retry();
                    return;
                }
                const received: Photo[] = response.data;
                setPhotos(received);
                // Variants may still be generating, so ask again until every photo has them
                if (received.some((photo) => !photo.srcSet)) retry();
            } catch (error) {
                console.error('Error fetching image metadata:', error);
                retry();
            }
        };

        fetchImages();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, []);

    return photos;
}
