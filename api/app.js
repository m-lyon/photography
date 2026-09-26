const express = require('express');
const cors = require('cors');

/** Builds the API around an ImageCache; the caller owns creating and listening. */
function createApp({ imageCache, imagesDir, domain, whitelist = [] }) {
    const app = express();
    const corsOptions = {
        origin: function (origin, callback) {
            if (!origin || whitelist.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                callback(new Error(`Domain '${origin}' not allowed by CORS`));
            }
        },
        credentials: true,
    };
    app.use(cors(corsOptions));

    const imageUrl = (file) => `${domain}/images/${encodeURIComponent(file)}`;
    const variantUrl = (file) => `${domain}/images/variants/${encodeURIComponent(file)}`;

    // Endpoint to serve image metadata
    app.get('/metadata', (req, res) => {
        if (!imageCache.scanned) return res.status(503).send('Image index not ready');
        const imagesMetadata = imageCache
            .list()
            .map(({ file, width, height, variants, placeholder, failed }) => {
                const original = { src: imageUrl(file), width, height };
                return {
                    ...original,
                    placeholder: placeholder || undefined,
                    // False only while generation is still pending, so clients know when to stop polling
                    variantsReady: !imageCache.cacheWritable || Boolean(placeholder) || Boolean(failed),
                    // Smallest first, ending with the original so the lightbox can zoom to full detail
                    srcSet: variants.length
                        ? [
                              ...variants.map((variant) => ({
                                  src: variantUrl(variant.file),
                                  width: variant.width,
                                  height: variant.height,
                              })),
                              original,
                          ]
                        : undefined,
                };
            });
        res.json(imagesMetadata);
    });

    // Variant names include the source's mtime and size, so a given name never changes
    app.use(
        '/images/variants',
        express.static(imageCache.cacheDir, { maxAge: '1y', immutable: true })
    );
    // Originals keep the same URL when a photo is replaced, so they are revalidated every time
    app.use('/images', express.static(imagesDir, { maxAge: 0 }));

    return app;
}

module.exports = { createApp };
