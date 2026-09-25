import { useState } from 'react';
import type { RenderPhotoProps } from 'react-photo-album';

import type { Photo } from './useGetPhotos.tsx';
import './BlurUpPhoto.css';

// Shows the photo's tiny placeholder blurred in its slot, then fades the real image in once loaded
export function BlurUpPhoto({ photo, imageProps, wrapperStyle }: RenderPhotoProps<Photo>) {
    const [loaded, setLoaded] = useState(false);
    const { src, alt, srcSet, sizes, style, className, ...rest } = imageProps;

    return (
        <div className='blur-up' style={{ ...wrapperStyle, cursor: style?.cursor }}>
            {photo.placeholder && (
                <div
                    className='blur-up__placeholder'
                    style={{ backgroundImage: `url(${photo.placeholder})` }}
                    aria-hidden
                />
            )}
            <img
                {...rest}
                ref={(img) => {
                    // Already-cached images can finish loading before React attaches onLoad
                    if (img?.complete && img.naturalWidth) setLoaded(true);
                }}
                src={src}
                srcSet={srcSet}
                sizes={sizes}
                alt={alt}
                className={`${className} blur-up__image${loaded ? ' blur-up__image--loaded' : ''}`}
                onLoad={() => setLoaded(true)}
                onError={() => setLoaded(true)}
            />
        </div>
    );
}
