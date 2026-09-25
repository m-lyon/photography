const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

// Widths (px) of the resized WebP variants generated for each image. Widths at or above
// the original's width are skipped; the original is always offered as the largest source.
const VARIANT_WIDTHS = [400, 800, 1600, 2400];
const VARIANT_QUALITY = 80;
// Tiny image inlined into the metadata response and shown blurred while the real one loads
const PLACEHOLDER_WIDTH = 16;
const PLACEHOLDER_QUALITY = 40;

const IMAGE_PATTERN = /\.(jpe?g|png|gif)$/i;
// GIFs can be animated, which a resized still WebP would lose, so they are served full size only
const NO_VARIANTS_PATTERN = /\.gif$/i;
// Names generate() gives its output; anything else in the cache directory is left alone
const CACHE_FILE_PATTERN = /^(.+)\.(\d+|placeholder)\.webp(\.tmp)?$/;

/**
 * Keeps an in-memory index of the images in `imagesDir` and generates resized WebP variants
 * plus a blur-up placeholder for each one into `cacheDir`.
 *
 * Variant file names include the source's modification time and size, so they can be served
 * with immutable caching: replacing a photo produces new URLs, and stale variants are pruned.
 */
class ImageCache {
    constructor({ imagesDir, cacheDir }) {
        this.imagesDir = imagesDir;
        this.cacheDir = cacheDir;
        this.entries = new Map();
        this.refreshing = null;
        this.refreshQueued = false;
        // Set once a scan has completed; /metadata reports unavailable until then
        this.scanned = false;
        // Without a writable cache directory the originals are still served, just without variants
        this.cacheWritable = true;
        try {
            fs.mkdirSync(cacheDir, { recursive: true });
        } catch (error) {
            this.cacheWritable = false;
            console.log('Unable to create cache directory, serving originals only:', error.message);
        }
    }

    /** Images in directory order; variants/placeholder are only present once generated. */
    list() {
        return [...this.entries.values()];
    }

    /**
     * Rescans the images directory. Concurrent calls are coalesced into one follow-up scan;
     * the returned promise covers only the scan that is already in flight, not the queued one.
     */
    refresh() {
        if (this.refreshing) {
            this.refreshQueued = true;
            return this.refreshing;
        }
        this.refreshing = this.scan()
            .then(() => {
                this.scanned = true;
            })
            .catch((error) => console.log('Error refreshing image cache:', error))
            .finally(() => {
                this.refreshing = null;
                if (this.refreshQueued) {
                    this.refreshQueued = false;
                    this.refresh();
                }
            });
        return this.refreshing;
    }

    /** Refreshes whenever the images directory changes (debounced). */
    watch(debounceMs = 2000) {
        let timer;
        try {
            this.watcher = fs.watch(this.imagesDir, () => {
                clearTimeout(timer);
                timer = setTimeout(() => this.refresh(), debounceMs);
            });
            // Without a listener a watcher error (directory removed, inotify limit) would be fatal
            this.watcher.on('error', (error) => {
                console.log('Images directory watch failed, new images need a restart:', error.message);
                this.watcher.close();
                this.watcher = null;
            });
        } catch (error) {
            console.log('Unable to watch images directory, new images need a restart:', error);
        }
    }

    async scan() {
        const all = await fsp.readdir(this.imagesDir);
        const files = all.filter((file) => IMAGE_PATTERN.test(file));

        // First pass reads only image headers, so every photo is listed quickly on startup
        const entries = new Map();
        for (const file of files) {
            try {
                const { mtimeMs, size } = await fsp.stat(path.join(this.imagesDir, file));
                const key = `${file}.${Math.round(mtimeMs).toString(36)}.${size.toString(36)}`;
                const existing = this.entries.get(file);
                entries.set(
                    file,
                    existing && existing.key === key ? existing : await this.readEntry(file, key)
                );
            } catch (error) {
                console.log(`Error reading metadata for ${file}:`, error.message);
            }
        }
        this.entries = entries;

        if (!this.cacheWritable) return;

        // Second pass generates any missing variants, one image at a time
        for (const entry of entries.values()) {
            if (entry.placeholder) continue;
            try {
                await this.generate(entry);
            } catch (error) {
                console.log(`Error generating variants for ${entry.file}:`, error.message);
            }
        }

        await this.prune();
    }

    async readEntry(file, key) {
        const metadata = await sharp(path.join(this.imagesDir, file)).metadata();
        if (!metadata.width || !metadata.height) throw new Error('missing image dimensions');
        // EXIF orientations 5-8 are rotated 90°, so displayed dimensions are swapped
        const rotated = (metadata.orientation || 1) >= 5;
        return {
            file,
            key,
            width: rotated ? metadata.height : metadata.width,
            height: rotated ? metadata.width : metadata.height,
            variants: [],
            placeholder: null,
        };
    }

    async generate(entry) {
        const image = sharp(path.join(this.imagesDir, entry.file)).rotate();

        const widths = NO_VARIANTS_PATTERN.test(entry.file)
            ? []
            : VARIANT_WIDTHS.filter((width) => width < entry.width);
        const variants = await Promise.all(
            widths.map(async (width) => {
                const file = `${entry.key}.${width}.webp`;
                await this.writeIfMissing(file, () =>
                    image.clone().resize({ width }).webp({ quality: VARIANT_QUALITY }).toBuffer()
                );
                return { file, width, height: Math.round((entry.height * width) / entry.width) };
            })
        );

        const placeholderFile = `${entry.key}.placeholder.webp`;
        await this.writeIfMissing(placeholderFile, () =>
            image
                .clone()
                .resize({ width: PLACEHOLDER_WIDTH })
                .webp({ quality: PLACEHOLDER_QUALITY })
                .toBuffer()
        );
        const placeholder = await fsp.readFile(path.join(this.cacheDir, placeholderFile));

        entry.variants = variants;
        entry.placeholder = `data:image/webp;base64,${placeholder.toString('base64')}`;
    }

    /** Renders and writes the cached file unless it is already there. */
    async writeIfMissing(file, render) {
        const target = path.join(this.cacheDir, file);
        try {
            await fsp.access(target);
            return;
        } catch {
            // not cached yet
        }
        const buffer = await render();
        // Write then rename so a partially written file is never served
        const temp = `${target}.tmp`;
        await fsp.writeFile(temp, buffer);
        await fsp.rename(temp, target);
    }

    /** Deletes cached files belonging to images that were removed or replaced. */
    async prune() {
        const keys = new Set([...this.entries.values()].map((entry) => entry.key));
        for (const file of await fsp.readdir(this.cacheDir)) {
            const match = CACHE_FILE_PATTERN.exec(file);
            if (!match || keys.has(match[1])) continue;
            try {
                await fsp.rm(path.join(this.cacheDir, file), { force: true });
            } catch (error) {
                console.log(`Error removing stale cache file ${file}:`, error.message);
            }
        }
    }
}

module.exports = { ImageCache };
