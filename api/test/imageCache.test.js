const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const sharp = require('sharp');

const { ImageCache } = require('../imageCache');

function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagecache-'));
    const imagesDir = path.join(root, 'images');
    const cacheDir = path.join(root, 'cache');
    fs.mkdirSync(imagesDir);
    return { imagesDir, cacheDir, cache: new ImageCache({ imagesDir, cacheDir }) };
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
