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

// Fallback rescan interval: the watcher can miss events or close on error, and pruning a
// retired file needs a later scan than the one that retired it
const PERIODIC_REFRESH_MS = 5 * 60 * 1000;
// Backoff between attempts at the first scan, which fails if the images directory is missing
const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 60000;
// A temp file younger than this may still be being written by a concurrently running instance
const TEMP_FILE_MAX_AGE_MS = 60000;
// Must match REFRESH_MS in client/src/useGetPhotos.tsx
const CLIENT_REFRESH_MS = 5 * 60 * 1000;
// Loaded pages keep a srcSet of the old variants until they refresh their metadata, so stale files
// are only deleted once they have been retired for several of those refresh intervals, leaving room
// for a client whose refresh failed and backed off or whose tab was suspended
const PRUNE_GRACE_MS = 3 * CLIENT_REFRESH_MS;

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
        // Stale cache file -> when it was first seen as stale, so pruning can wait out clients
        this.retired = new Map();
        this.probeCacheWritable();
    }

    /** Sets cacheWritable; without a writable cache the originals are still served bare. */
    probeCacheWritable() {
        this.cacheWritable = true;
        try {
            fs.mkdirSync(this.cacheDir, { recursive: true });
            // mkdirSync succeeds on an existing directory even if it cannot be written to
            const probe = path.join(this.cacheDir, `.writable-${process.pid}`);
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
        if (this.retryTimer) return;
        this.retryMs = this.retryMs ? Math.min(this.retryMs * 2, MAX_RETRY_MS) : INITIAL_RETRY_MS;
        this.retryTimer = setTimeout(async () => {
            this.retryTimer = null;
            await this.refresh();
            if (this.scanned) this.retryMs = 0;
            // watch() also fails while the directory is missing, so arm it once the scan works
            if (this.scanned && this.watching && !this.watcher) this.watch(this.debounceMs);
        }, this.retryMs);
        // Do not hold the process (or a test run) open just to retry
        this.retryTimer.unref?.();
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
            const watcher = this.watcher;
            watcher.on('error', (error) => {
                console.log('Images directory watch failed, relying on periodic rescans:', error.message);
                watcher.close();
                if (this.watcher === watcher) this.watcher = null;
            });
        } catch (error) {
            console.log('Unable to watch images directory, new images need a restart:', error);
        }
    }

    /** Rescans periodically so missed events, transient failures and pruning still make progress. */
    startPeriodicRefresh(intervalMs = PERIODIC_REFRESH_MS) {
        if (this.refreshTimer) return;
        this.refreshTimer = setInterval(() => this.refresh(), intervalMs);
        // Do not hold the process (or a test run) open just to rescan
        this.refreshTimer.unref?.();
    }

    stopPeriodicRefresh() {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
    }

    async scan() {
        // A permission problem may have been fixed since the last scan gave up
        if (!this.cacheWritable) this.probeCacheWritable();
        const previousSize = this.entries.size;
        const all = await fsp.readdir(this.imagesDir);
        const files = all.filter((file) => IMAGE_PATTERN.test(file));
        // An empty directory where there were photos means it is probably unmounted, not emptied,
        // so keep the index and the cache rather than wiping every variant
        if (files.length === 0 && previousSize > 0) return;

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
            if (entry.failed) continue;
            if (entry.placeholder && (await this.cachedFilesExist(entry))) continue;
            try {
                await this.generate(entry);
            } catch (error) {
                console.log(`Error generating variants for ${entry.file}:`, error.message);
                // Permanent failures are latched so they are not retried on every scan, and so
                // clients stop waiting; transient I/O errors are left to retry on the next scan
                if (this.cacheWritable && !TRANSIENT_ERROR_CODES.includes(error.code)) {
                    entry.failed = true;
                    // Nothing will ever advertise the files an abandoned attempt did write, and
                    // prune() leaves them alone while the key is live, so remove them here
                    await this.removeCacheFiles(entry.key);
                }
            }
        }

        await this.prune();
    }

    /** True if every file a reused entry advertises is still on disk. */
    async cachedFilesExist(entry) {
        const files = [`${entry.key}.placeholder.webp`, ...entry.variants.map((v) => v.file)];
        for (const file of files) {
            try {
                await fsp.access(path.join(this.cacheDir, file));
            } catch {
                entry.variants = [];
                entry.placeholder = null;
                return false;
            }
        }
        return true;
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

    /** Deletes every cached file belonging to one key, ignoring anything already gone. */
    async removeCacheFiles(key) {
        try {
            for (const file of await fsp.readdir(this.cacheDir)) {
                const match = CACHE_FILE_PATTERN.exec(file);
                // Temp files are left to the age-based sweep in prune(): another instance may
                // still be writing one
                if (match && match[1] === key && !match[3]) {
                    await fsp.rm(path.join(this.cacheDir, file), { force: true });
                }
            }
        } catch (error) {
            console.log(`Error removing cache files for ${key}:`, error.message);
        }
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

    /** True if the file's mtime is older than `ms`; false if it cannot be read. */
    async olderThan(file, ms) {
        try {
            const { mtimeMs } = await fsp.stat(path.join(this.cacheDir, file));
            return Date.now() - mtimeMs > ms;
        } catch {
            return false;
        }
    }

    /** Deletes cached files belonging to images that were removed or replaced. */
    async prune() {
        const keys = new Set([...this.entries.values()].map((entry) => entry.key));
        const seen = new Set();
        for (const file of await fsp.readdir(this.cacheDir)) {
            seen.add(file);
            const match = CACHE_FILE_PATTERN.exec(file);
            // match[3] is a leftover temp file, which is never meant to be served
            if (!match || (keys.has(match[1]) && !match[3])) {
                // A key can become live again (a photo restored with its original mtime and size),
                // and a stale timestamp would skip the grace period next time it is retired
                this.retired.delete(file);
                continue;
            }
            // Another instance may still be writing a recent temp file
            if (match[3] && !(await this.olderThan(file, TEMP_FILE_MAX_AGE_MS))) continue;
            // Clients already holding this URL in a srcSet get time to pick up the new keys
            if (!match[3]) {
                const retiredAt = this.retired.get(file);
                if (retiredAt === undefined) {
                    this.retired.set(file, Date.now());
                    continue;
                }
                if (Date.now() - retiredAt < PRUNE_GRACE_MS) continue;
            }
            this.retired.delete(file);
            try {
                await fsp.rm(path.join(this.cacheDir, file), { force: true });
            } catch (error) {
                console.log(`Error removing stale cache file ${file}:`, error.message);
            }
        }
        // Files that vanished another way would otherwise leak entries for the life of the process
        for (const file of this.retired.keys()) {
            if (!seen.has(file)) this.retired.delete(file);
        }
    }
}

module.exports = { ImageCache };
