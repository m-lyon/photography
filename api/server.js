const http = require('http');
const path = require('path');
require('dotenv-flow/config');
const { ImageCache } = require('./imageCache');
const { createApp } = require('./app');

const { WHITELISTED_DOMAINS, IMAGES_DIR, CACHE_DIR, DOMAIN, PORT } = process.env;

const imageCache = new ImageCache({
    imagesDir: IMAGES_DIR,
    cacheDir: CACHE_DIR || path.join(__dirname, '.image-cache'),
});
imageCache.refresh();
imageCache.watch();

const app = createApp({
    imageCache,
    imagesDir: IMAGES_DIR,
    domain: DOMAIN,
    whitelist: WHITELISTED_DOMAINS ? WHITELISTED_DOMAINS.split(',') : [],
});

const server = http.createServer(app);
server.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
