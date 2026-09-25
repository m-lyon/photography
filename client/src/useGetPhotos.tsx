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
export function useGetPhotos(): Photo[] {
    const [photos, setPhotos] = useState<Photo[]>([]);

    useEffect(() => {
        // Function to fetch image list from the server
        const fetchImages = async () => {
            try {
                const response = await axios.get(import.meta.env.VITE_METADATA_ENDPOINT);
                setPhotos(response.data);
            } catch (error) {
                console.error('Error fetching image metadata:', error);
            }
        };

        fetchImages();
    }, []);

    return photos;
}
