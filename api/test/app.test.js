const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const sharp = require('sharp');

const { ImageCache } = require('../imageCache');
const { createApp } = require('../app');

function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-'));
    const imagesDir = path.join(root, 'images');
    fs.mkdirSync(imagesDir);
    const cache = new ImageCache({ imagesDir, cacheDir: path.join(root, 'cache') });
    const app = createApp({
        imageCache: cache,
        imagesDir,
        domain: 'https://example.test',
    });
    return { imagesDir, cache, app };
}

async function get(app, url) {
    const server = http.createServer(app).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
        return {
            status: response.status,
            body: await response.text(),
            cacheControl: response.headers.get('cache-control'),
        };
    } finally {
        server.close();
    }
}

test('metadata is unavailable until the first scan has listed the photos', async () => {
    const { app } = setup();
    const before = await get(app, '/metadata');
    assert.equal(before.status, 503);
});

test('metadata returns variants smallest first with the original appended', async () => {
    const { imagesDir, cache, app } = setup();
    await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .jpeg()
        .toFile(path.join(imagesDir, 'a.jpg'));
    await cache.refresh();

    const response = await get(app, '/metadata');
    assert.equal(response.status, 200);
    const [photo] = JSON.parse(response.body);
    assert.equal(photo.src, 'https://example.test/images/a.jpg');
    assert.deepEqual(
        photo.srcSet.map((image) => image.width),
        [400, 800, 1000]
    );
    assert.equal(photo.srcSet.at(-1).src, photo.src);
    assert.match(photo.placeholder, /^data:image\/webp;base64,/);
});

test('metadata omits srcSet and placeholder before variants exist', async () => {
    const { imagesDir, cache, app } = setup();
    await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .jpeg()
        .toFile(path.join(imagesDir, 'a.jpg'));
    cache.cacheWritable = false;
    await cache.refresh();

    const response = await get(app, '/metadata');
    const [photo] = JSON.parse(response.body);
    assert.equal(photo.srcSet, undefined);
    assert.equal(photo.placeholder, undefined);
});

test('variant URLs from metadata are served with immutable caching', async () => {
    const { imagesDir, cache, app } = setup();
    // A space and a '#' exercise the URL encoding between /metadata and express.static
    await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .jpeg()
        .toFile(path.join(imagesDir, 'a b#1.jpg'));
    await cache.refresh();

    const [photo] = JSON.parse((await get(app, '/metadata')).body);
    const variant = photo.srcSet[0];
    const response = await get(app, new URL(variant.src).pathname);
    assert.equal(response.status, 200);
    assert.match(response.cacheControl, /max-age=31536000/);
    assert.match(response.cacheControl, /immutable/);
});
