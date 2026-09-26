const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const sharp = require('sharp');

const { ImageCache } = require('../imageCache');
const { createApp } = require('../app');

function setup({ whitelist } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-'));
    const imagesDir = path.join(root, 'images');
    fs.mkdirSync(imagesDir);
    const cacheDir = path.join(root, 'cache');
    const cache = new ImageCache({ imagesDir, cacheDir });
    const app = createApp({
        imageCache: cache,
        imagesDir,
        domain: 'https://example.test',
        whitelist,
    });
    return { imagesDir, cacheDir, cache, app };
}

async function request(app, url, options) {
    const server = http.createServer(app).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, options);
        return {
            status: response.status,
            body: await response.text(),
            cacheControl: response.headers.get('cache-control'),
            allowOrigin: response.headers.get('access-control-allow-origin'),
        };
    } finally {
        server.close();
    }
}

const get = (app, url) => request(app, url);

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

test('metadata omits srcSet and placeholder before variants exist', { skip: process.getuid?.() === 0 }, async () => {
    const { imagesDir, cacheDir, cache, app } = setup();
    await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .jpeg()
        .toFile(path.join(imagesDir, 'a.jpg'));
    // A read-only cache directory, which is how generation gets disabled in production
    fs.chmodSync(cacheDir, 0o555);
    try {
        await cache.refresh();
    } finally {
        fs.chmodSync(cacheDir, 0o755);
    }

    const response = await get(app, '/metadata');
    const [photo] = JSON.parse(response.body);
    assert.equal(photo.srcSet, undefined);
    assert.equal(photo.placeholder, undefined);
    // Otherwise clients would poll forever waiting for variants that will never arrive
    assert.equal(photo.variantsReady, true);
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

test('variantsReady is false while generation is pending and true once it completes', async () => {
    const { imagesDir, cache, app } = setup();
    await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .jpeg()
        .toFile(path.join(imagesDir, 'a.jpg'));

    const generate = cache.generate;
    cache.generate = async () => {};
    await cache.refresh();
    const [pending] = JSON.parse((await get(app, '/metadata')).body);
    assert.equal(pending.variantsReady, false);
    assert.equal(pending.srcSet, undefined);

    cache.generate = generate;
    await cache.refresh();
    const [ready] = JSON.parse((await get(app, '/metadata')).body);
    assert.equal(ready.variantsReady, true);
    assert.ok(ready.srcSet.length > 0);
});

test('a permanently failed generation is latched, reported ready and not retried', async () => {
    const { imagesDir, cache, app } = setup();
    await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .jpeg()
        .toFile(path.join(imagesDir, 'a.jpg'));

    let calls = 0;
    cache.generate = async () => {
        calls += 1;
        // No code, so not one of the transient conditions that are left to retry
        throw new Error('unsupported image');
    };
    await cache.refresh();
    assert.equal(calls, 1);
    assert.equal(cache.list()[0].failed, true);

    const [photo] = JSON.parse((await get(app, '/metadata')).body);
    assert.equal(photo.srcSet, undefined);
    assert.equal(photo.placeholder, undefined);
    // Otherwise clients would poll every 15s for variants that will never arrive
    assert.equal(photo.variantsReady, true);

    await cache.refresh();
    assert.equal(calls, 1);
});

test('a failed generation retires its orphaned variant files', async () => {
    const { imagesDir, cacheDir, cache } = setup();
    await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .jpeg()
        .toFile(path.join(imagesDir, 'a.jpg'));

    const writeIfMissing = cache.writeIfMissing.bind(cache);
    let writes = 0;
    cache.writeIfMissing = async (file, render) => {
        if (++writes > 1) throw new Error('encode failed');
        return writeIfMissing(file, render);
    };
    await cache.refresh();

    assert.equal(cache.list()[0].failed, true);
    // The one variant that was written was advertised before, so clients keep the grace period
    assert.notDeepEqual(fs.readdirSync(cacheDir), []);
    for (const file of cache.retired.keys()) cache.retired.set(file, 0);
    await cache.prune();
    assert.deepEqual(fs.readdirSync(cacheDir), []);
});

test('CORS headers are only sent for whitelisted origins', async () => {
    const { app } = setup({ whitelist: ['https://allowed.test'] });

    const allowed = await request(app, '/metadata', {
        headers: { Origin: 'https://allowed.test' },
    });
    assert.equal(allowed.allowOrigin, 'https://allowed.test');

    // No CORS headers rather than an error, which would surface as a 503/500 to every client
    const denied = await request(app, '/metadata', {
        headers: { Origin: 'https://evil.test' },
    });
    assert.equal(denied.status, 503);
    assert.equal(denied.allowOrigin, null);

    const preflight = await request(app, '/metadata', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(preflight.allowOrigin, null);
});
