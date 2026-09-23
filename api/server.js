const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
require('dotenv-flow/config');
const { ImageCache } = require('./imageCache');

const app = express();
const { WHITELISTED_DOMAINS, IMAGES_DIR, CACHE_DIR, DOMAIN, PORT, NODE_ENV, PRIVKEY_PEM, FULLCHAIN_PEM } =
    process.env;
const WHITELIST = WHITELISTED_DOMAINS ? WHITELISTED_DOMAINS.split(',') : [];
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || WHITELIST.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error(`Domain '${origin}' not allowed by CORS`));
        }
    },
    credentials: true,
};
app.use(cors(corsOptions));

const imageCache = new ImageCache({
    imagesDir: IMAGES_DIR,
    cacheDir: CACHE_DIR || path.join(__dirname, '.image-cache'),
});
imageCache.refresh();
imageCache.watch();

const imageUrl = (file) => `${DOMAIN}/images/${encodeURIComponent(file)}`;
const variantUrl = (file) => `${DOMAIN}/images/variants/${encodeURIComponent(file)}`;

// Endpoint to serve image metadata
app.get('/metadata', (req, res) => {
    const imagesMetadata = imageCache.list().map(({ file, width, height, variants, placeholder }) => {
        const original = { src: imageUrl(file), width, height };
        return {
            ...original,
            placeholder: placeholder || undefined,
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

// Resized variants are content-addressed (named by source mtime), so they never change
app.use(
    '/images/variants',
    express.static(imageCache.cacheDir, { maxAge: '1y', immutable: true })
);
// Serve static images
app.use('/images', express.static(IMAGES_DIR, { maxAge: '7d' }));

let server;
if (NODE_ENV === 'development') {
    const http = require('http');
    server = http.createServer(app);
} else {
    const https = require('https');
    const fs = require('fs');
    const options = {
        key: fs.readFileSync(PRIVKEY_PEM),
        cert: fs.readFileSync(FULLCHAIN_PEM),
    };
    server = https.createServer(options, app);
}
server.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
