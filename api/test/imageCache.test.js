const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const sharp = require('sharp');

const { ImageCache } = require('../imageCache');

function setup({ createImagesDir = true } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagecache-'));
    const imagesDir = path.join(root, 'images');
    const cacheDir = path.join(root, 'cache');
    if (createImagesDir) fs.mkdirSync(imagesDir);
    return { imagesDir, cacheDir, cache: new ImageCache({ imagesDir, cacheDir }) };
}

async function waitFor(predicate, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        assert.ok(Date.now() < deadline, 'timed out waiting for condition');
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

// prune keeps stale files for a grace period, so expire it and prune again
async function pruneAfterGrace(cache) {
    await cache.prune();
    for (const file of cache.retired.keys()) cache.retired.set(file, 0);
    await cache.prune();
}

function writeImage(imagesDir, file, { width = 1000, height = 500, colour = 0 } = {}) {
    return sharp({
        create: { width, height, channels: 3, background: { r: colour, g: 0, b: 0 } },
    })
        .jpeg()
        .toFile(path.join(imagesDir, file));
}

test('generates variants and a placeholder for each image', async () => {
    const { imagesDir, cacheDir, cache } = setup();
    await writeImage(imagesDir, 'a.jpg');
    await cache.refresh();

    const [entry] = cache.list();
    assert.equal(entry.file, 'a.jpg');
    assert.deepEqual(
        entry.variants.map((variant) => variant.width),
        [400, 800]
    );
    assert.match(entry.placeholder, /^data:image\/webp;base64,/);
    assert.deepEqual(
        fs.readdirSync(cacheDir).sort(),
        [
            `${entry.key}.400.webp`,
            `${entry.key}.800.webp`,
            `${entry.key}.placeholder.webp`,
        ].sort()
    );
});

test('replacing an image produces new keys and prunes the old files', async () => {
    const { imagesDir, cacheDir, cache } = setup();
    await writeImage(imagesDir, 'a.jpg');
    await writeImage(imagesDir, 'b.jpg');
    await cache.refresh();
    const before = cache.list().find((entry) => entry.file === 'a.jpg');
    const otherKey = cache.list().find((entry) => entry.file === 'b.jpg').key;

    await writeImage(imagesDir, 'a.jpg', { colour: 255 });
    fs.utimesSync(path.join(imagesDir, 'a.jpg'), new Date(), new Date(Date.now() + 60000));
    await cache.refresh();

    const after = cache.list().find((entry) => entry.file === 'a.jpg');
    assert.notEqual(after.key, before.key);
    await pruneAfterGrace(cache);
    const files = fs.readdirSync(cacheDir);
    assert.ok(!files.some((file) => file.startsWith(`${before.key}.`)));
    assert.ok(files.some((file) => file.startsWith(`${after.key}.`)));
    assert.ok(files.some((file) => file.startsWith(`${otherKey}.`)));
});

test('deleting an image removes only its cached files', async () => {
    const { imagesDir, cacheDir, cache } = setup();
    await writeImage(imagesDir, 'a.jpg');
    await writeImage(imagesDir, 'b.jpg');
    await cache.refresh();
    const keptKey = cache.list().find((entry) => entry.file === 'b.jpg').key;

    fs.unlinkSync(path.join(imagesDir, 'a.jpg'));
    await cache.refresh();

    assert.deepEqual(
        cache.list().map((entry) => entry.file),
        ['b.jpg']
    );
    await pruneAfterGrace(cache);
    const files = fs.readdirSync(cacheDir);
    assert.ok(files.length > 0);
    assert.ok(files.every((file) => file.startsWith(`${keptKey}.`)));
});

test('prune leaves files it did not create alone', async () => {
    const { imagesDir, cacheDir, cache } = setup();
    await writeImage(imagesDir, 'a.jpg');
    await cache.refresh();
    fs.writeFileSync(path.join(cacheDir, 'notes.txt'), 'keep me');
    fs.mkdirSync(path.join(cacheDir, 'subdir'));

    await cache.prune();

    assert.ok(fs.existsSync(path.join(cacheDir, 'notes.txt')));
    assert.ok(fs.existsSync(path.join(cacheDir, 'subdir')));
});

test('swaps dimensions for rotated EXIF orientations', async () => {
    const { imagesDir, cache } = setup();
    await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toFile(path.join(imagesDir, 'a.jpg'));
    await cache.refresh();

    const [entry] = cache.list();
    assert.equal(entry.width, 500);
    assert.equal(entry.height, 1000);
    assert.deepEqual(
        entry.variants.map((variant) => variant.width),
        [400]
    );
    assert.equal(entry.variants[0].height, 800);
});

test('serves GIFs full size but still gives them a placeholder', async () => {
    const { imagesDir, cache } = setup();
    await sharp({
        create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
        .gif()
        .toFile(path.join(imagesDir, 'a.gif'));
    await cache.refresh();

    const [entry] = cache.list();
    assert.deepEqual(entry.variants, []);
    assert.match(entry.placeholder, /^data:image\/webp;base64,/);
});

test('stops generating when the cache directory becomes read-only', { skip: process.getuid?.() === 0 }, async () => {
    const { imagesDir, cacheDir, cache } = setup();
    await writeImage(imagesDir, 'a.jpg');
    fs.chmodSync(cacheDir, 0o555);
    try {
        await cache.refresh();
    } finally {
        fs.chmodSync(cacheDir, 0o755);
    }

    assert.equal(cache.cacheWritable, false);
    const [entry] = cache.list();
    assert.equal(entry.file, 'a.jpg');
    assert.deepEqual(entry.variants, []);
    assert.equal(entry.placeholder, null);
});

test('prune removes stale temp files only once they are too old to be in progress', async () => {
    const { imagesDir, cacheDir, cache } = setup();
    await writeImage(imagesDir, 'a.jpg');
    await cache.refresh();
    const { key } = cache.list()[0];
    const fresh = path.join(cacheDir, `${key}.400.webp.1234.abc.tmp`);
    const stale = path.join(cacheDir, `${key}.800.webp.5678.def.tmp`);
    fs.writeFileSync(fresh, '');
    fs.writeFileSync(stale, '');
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(stale, old, old);

    await cache.prune();

    assert.ok(fs.existsSync(fresh));
    assert.ok(!fs.existsSync(stale));
});

test('keeps the index when the images directory reads as empty', async () => {
    const { imagesDir, cacheDir, cache } = setup();
    await writeImage(imagesDir, 'a.jpg');
    await cache.refresh();
    const before = cache.list();

    fs.unlinkSync(path.join(imagesDir, 'a.jpg'));
    await cache.refresh();

    assert.deepEqual(cache.list(), before);
    assert.ok(fs.readdirSync(cacheDir).length > 0);
});

test('prune keeps stale variants until clients have had time to refresh', async () => {
    const { imagesDir, cacheDir, cache } = setup();
    await writeImage(imagesDir, 'a.jpg');
    await cache.refresh();
    const { key } = cache.list()[0];
    await writeImage(imagesDir, 'b.jpg');

    fs.unlinkSync(path.join(imagesDir, 'a.jpg'));
    await cache.refresh();

    const files = fs.readdirSync(cacheDir);
    assert.ok(files.some((file) => file.startsWith(`${key}.`)));

    await pruneAfterGrace(cache);
    assert.ok(!fs.readdirSync(cacheDir).some((file) => file.startsWith(`${key}.`)));
});

test('retries the first scan and arms the watcher once the images directory appears', async () => {
    const { imagesDir, cache } = setup({ createImagesDir: false });

    await cache.refresh();
    assert.equal(cache.scanned, false);
    assert.ok(cache.retryTimer);
    // watch() cannot attach to a directory that does not exist yet
    cache.watch(10);
    assert.ok(!cache.watcher);

    fs.mkdirSync(imagesDir);
    await writeImage(imagesDir, 'a.jpg');

    await waitFor(() => cache.scanned && cache.watcher);
    try {
        assert.deepEqual(
            cache.list().map((entry) => entry.file),
            ['a.jpg']
        );
        assert.match(cache.list()[0].placeholder, /^data:image\/webp;base64,/);
    } finally {
        cache.watcher.close();
    }
});
