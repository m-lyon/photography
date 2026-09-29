import { useState } from 'react';
import type { RenderPhotoProps } from 'react-photo-album';

import type { Photo } from './useGetPhotos.tsx';
import './BlurUpPhoto.css';

// Shows the photo's tiny placeholder blurred in its slot, then fades the real image in once loaded
export function BlurUpPhoto({ photo, imageProps, wrapperStyle }: RenderPhotoProps<Photo>) {
    const [loaded, setLoaded] = useState(false);
    // A variant URL can 404 after it has been pruned; browsers do not fall back from srcSet to src.
    // Remembering which srcSet failed rather than a flag lets a later metadata refresh, which
    // supplies fresh variant URLs, start using them again
    const [failedSrcSet, setFailedSrcSet] = useState<string | undefined>(undefined);
    const { src, alt, srcSet, sizes, style, className, ...rest } = imageProps;
    const variantsFailed = srcSet !== undefined && srcSet === failedSrcSet;

    return (
        <div className='blur-up' style={{ ...wrapperStyle, cursor: style?.cursor }}>
            {photo.placeholder && (
                <div
                    className={`blur-up__placeholder${loaded ? ' blur-up__placeholder--hidden' : ''}`}
                    style={{ backgroundImage: `url(${photo.placeholder})` }}
                    aria-hidden
                />
            )}
            <img
                {...rest}
                ref={(img) => {
                    // Already-cached images can finish loading (or failing) before React
                    // attaches onLoad
                    // complete stays true from the failed load, so skip it while falling back
                    if (img?.complete && !variantsFailed) setLoaded(true);
                }}
                src={src}
                srcSet={variantsFailed ? undefined : srcSet}
                sizes={variantsFailed ? undefined : sizes}
                alt={alt}
                className={[className, 'blur-up__image', loaded && 'blur-up__image--loaded']
                    .filter(Boolean)
                    .join(' ')}
                onLoad={() => setLoaded(true)}
                onError={() => {
                    // Retry once with the original; if that fails too, stop hiding the failure
                    if (srcSet && !variantsFailed) setFailedSrcSet(srcSet);
                    else setLoaded(true);
                }}
            />
        </div>
    );
}
