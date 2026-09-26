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
const CACHE_FILE_PATTERN = /^(.+)\.(\d+|placeholder)\.webp(\..+\.tmp)?$/;
// I/O conditions that can clear on their own, so generation is retried on the next scan
const TRANSIENT_ERROR_CODES = ['ENOSPC', 'EMFILE', 'ENFILE', 'EAGAIN', 'EBUSY', 'ENOENT'];

// Backoff between attempts at the first scan, which fails if the images directory is missing
const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 60000;

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
            // mkdirSync succeeds on an existing directory even if it cannot be written to
            const probe = path.join(cacheDir, `.writable-${process.pid}`);
            fs.writeFileSync(probe, '');
            fs.rmSync(probe, { force: true });
        } catch (error) {
            this.cacheWritable = false;
            console.log('Cache directory is not writable, serving originals only:', error.message);
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
            .catch((error) => {
                console.log('Error refreshing image cache:', error);
                // The images directory may not be mounted yet, and nothing else would retry
                if (!this.scanned) this.retryInitialScan();
            })
            .finally(() => {
                this.refreshing = null;
                if (this.refreshQueued) {
                    this.refreshQueued = false;
                    this.refresh();
                }
            });
        return this.refreshing;
    }

    /** Re-runs the first scan with backoff; until it succeeds /metadata answers 503. */
    retryInitialScan() {
        this.retryMs = this.retryMs ? Math.min(this.retryMs * 2, MAX_RETRY_MS) : INITIAL_RETRY_MS;
        const timer = setTimeout(async () => {
            await this.refresh();
            // watch() also fails while the directory is missing, so arm it once the scan works
            if (this.scanned && this.watching && !this.watcher) this.watch(this.debounceMs);
        }, this.retryMs);
        // Do not hold the process (or a test run) open just to retry
        timer.unref?.();
    }

    /** Refreshes whenever the images directory changes (debounced). */
    watch(debounceMs = 2000) {
        this.watching = true;
        this.debounceMs = debounceMs;
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
        // Every photo is now listed, so /metadata can answer while variants are still generating
        this.scanned = true;

        if (!this.cacheWritable) return;

        // Second pass generates any missing variants, one image at a time
        for (const entry of entries.values()) {
            if (!this.cacheWritable) return;
            if (entry.placeholder || entry.failed) continue;
            try {
                await this.generate(entry);
            } catch (error) {
                console.log(`Error generating variants for ${entry.file}:`, error.message);
                // Permanent failures are latched so they are not retried on every scan, and so
                // clients stop waiting; transient I/O errors are left to retry on the next scan
                if (this.cacheWritable && !TRANSIENT_ERROR_CODES.includes(error.code)) {
                    entry.failed = true;
                }
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
            failed: false,
        };
    }

    async generate(entry) {
        const image = sharp(path.join(this.imagesDir, entry.file)).rotate();

        const widths = NO_VARIANTS_PATTERN.test(entry.file)
            ? []
            : VARIANT_WIDTHS.filter((width) => width < entry.width);
        // One width at a time: each clone re-decodes the original, so parallel encodes multiply
        // peak memory and stall the event loop while the same process is serving requests
        const variants = [];
        for (const width of widths) {
            const file = `${entry.key}.${width}.webp`;
            await this.writeIfMissing(file, () =>
                image.clone().resize({ width }).webp({ quality: VARIANT_QUALITY }).toBuffer()
            );
            variants.push({ file, width, height: Math.round((entry.height * width) / entry.width) });
        }

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
        // Unique per writer: two processes briefly overlap across a restart
        const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        try {
            await fsp.writeFile(temp, buffer);
            await fsp.rename(temp, target);
        } catch (error) {
            await fsp.rm(temp, { force: true }).catch(() => {});
            // These will not become writable later, so stop re-encoding on every scan.
            // ENOSPC is deliberately excluded: freeing space should let generation resume.
            if (['EACCES', 'EPERM', 'EROFS'].includes(error.code)) {
                this.cacheWritable = false;
                console.log('Cache directory is not writable, serving originals only:', error.message);
            }
            throw error;
        }
    }

    /** Deletes cached files belonging to images that were removed or replaced. */
    async prune() {
        const keys = new Set([...this.entries.values()].map((entry) => entry.key));
        for (const file of await fsp.readdir(this.cacheDir)) {
            const match = CACHE_FILE_PATTERN.exec(file);
            // match[3] is a leftover temp file, which is never meant to be served
            if (!match || (keys.has(match[1]) && !match[3])) continue;
            try {
                await fsp.rm(path.join(this.cacheDir, file), { force: true });
            } catch (error) {
                console.log(`Error removing stale cache file ${file}:`, error.message);
            }
        }
    }
}

module.exports = { ImageCache };
