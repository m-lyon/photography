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
    /** False while the server is still generating this photo's variants */
    variantsReady?: boolean;
}

// The API answers 503 while it is still indexing, and reports variantsReady per photo after that
const RETRY_MS = 2000;
// Only hard failures give up; generating variants for a large album can take much longer
const MAX_RETRIES = 10;
const PENDING_POLL_MS = 15000;

export function useGetPhotos(): Photo[] {
    const [photos, setPhotos] = useState<Photo[]>([]);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        let attempt = 0;

        // Network errors and bad responses get a bounded number of tries
        const retry = () => {
            attempt += 1;
            if (!cancelled && attempt <= MAX_RETRIES) {
                timer = setTimeout(fetchImages, RETRY_MS * attempt);
            }
        };

        // Variants are still generating, which has no useful deadline, so keep asking slowly
        const pollPending = () => {
            if (!cancelled) timer = setTimeout(fetchImages, PENDING_POLL_MS);
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
                attempt = 0;
                // Variants may still be generating, so ask again until the server says they are ready
                if (received.some((photo) => photo.variantsReady === false)) pollPending();
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
