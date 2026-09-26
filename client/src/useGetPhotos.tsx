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
const MAX_RETRY_MS = 30000;
const PENDING_POLL_MS = 15000;
// Variant URLs are content-keyed, so a tab left open would keep a srcSet whose files have been
// pruned; a slow background refresh picks up the new keys. The server prunes a retired variant
// after a multiple of this interval, so keep CLIENT_REFRESH_MS in api/imageCache.js in step.
const REFRESH_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;

export function useGetPhotos(): Photo[] {
    const [photos, setPhotos] = useState<Photo[]>([]);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        let attempt = 0;
        let lastSerialized: string | null = null;

        // Network errors and bad responses back off, but keep retrying so the gallery recovers
        // from an outage of any length without a reload
        const retry = () => {
            attempt += 1;
            if (!cancelled) timer = setTimeout(fetchImages, Math.min(RETRY_MS * attempt, MAX_RETRY_MS));
        };

        // Polls quickly while variants are generating, slowly otherwise
        const scheduleNext = (delay: number) => {
            if (!cancelled) timer = setTimeout(fetchImages, delay);
        };

        const fetchImages = async () => {
            try {
                const response = await axios.get(import.meta.env.VITE_METADATA_ENDPOINT, { timeout: REQUEST_TIMEOUT_MS });
                if (cancelled) return;
                if (!Array.isArray(response.data)) {
                    console.error('Unexpected image metadata response');
                    retry();
                    return;
                }
                const received: Photo[] = response.data;
                // Unchanged metadata would otherwise re-render the album on every poll
                const serialized = JSON.stringify(received);
                if (serialized !== lastSerialized) {
                    lastSerialized = serialized;
                    setPhotos(received);
                }
                attempt = 0;
                // Variants may still be generating, so ask again until the server says they are ready
                scheduleNext(
                    received.some((photo) => photo.variantsReady === false)
                        ? PENDING_POLL_MS
                        : REFRESH_MS
                );
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
