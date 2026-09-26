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

// The API answers 503 while it is still indexing, so keep asking until it is ready
const RETRY_MS = 2000;

export function useGetPhotos(): Photo[] {
    const [photos, setPhotos] = useState<Photo[]>([]);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;

        const fetchImages = async () => {
            try {
                const response = await axios.get(import.meta.env.VITE_METADATA_ENDPOINT);
                if (!cancelled) setPhotos(response.data);
            } catch (error) {
                console.error('Error fetching image metadata:', error);
                if (!cancelled) timer = setTimeout(fetchImages, RETRY_MS);
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
