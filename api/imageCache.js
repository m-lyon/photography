const fs = require('fs');
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

/**
 * Keeps an in-memory index of the images in `imagesDir` and generates resized WebP variants
 * plus a blur-up placeholder for each one into `cacheDir`.
 *
 * Variant file names include the source's modification time, so they can be served with
 * immutable caching: replacing a photo produces new URLs, and stale variants are pruned.
 */
class ImageCache {
    constructor({ imagesDir, cacheDir }) {
        this.imagesDir = imagesDir;
        this.cacheDir = cacheDir;
        this.entries = new Map();
        this.refreshing = null;
        this.refreshQueued = false;
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    /** Images in directory order; variants/placeholder are only present once generated. */
    list() {
        return [...this.entries.values()];
    }

    /** Rescans the images directory. Concurrent calls are coalesced into one follow-up scan. */
    refresh() {
        if (this.refreshing) {
            this.refreshQueued = true;
            return this.refreshing;
        }
        this.refreshing = this.scan()
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
            fs.watch(this.imagesDir, () => {
                clearTimeout(timer);
                timer = setTimeout(() => this.refresh(), debounceMs);
            });
        } catch (error) {
            console.log('Unable to watch images directory, new images need a restart:', error);
        }
    }

    async scan() {
        const files = fs.readdirSync(this.imagesDir).filter((file) => IMAGE_PATTERN.test(file));

        // First pass reads only image headers, so every photo is listed quickly on startup
        const entries = new Map();
        for (const file of files) {
            try {
                const { mtimeMs } = fs.statSync(path.join(this.imagesDir, file));
                const key = `${file}.${Math.round(mtimeMs).toString(36)}`;
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

        // Second pass generates any missing variants, one image at a time
        for (const entry of entries.values()) {
            if (entry.placeholder) continue;
            try {
                await this.generate(entry);
            } catch (error) {
                console.log(`Error generating variants for ${entry.file}:`, error.message);
            }
        }

        this.prune();
    }

    async readEntry(file, key) {
        const metadata = await sharp(path.join(this.imagesDir, file)).metadata();
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

        const variants = await Promise.all(
            VARIANT_WIDTHS.filter((width) => width < entry.width).map(async (width) => {
                const file = `${entry.key}.${width}.webp`;
                await this.writeIfMissing(file, () =>
                    image.clone().resize({ width }).webp({ quality: VARIANT_QUALITY }).toBuffer()
                );
                return { file, width, height: Math.round((entry.height * width) / entry.width) };
            })
        );

        const placeholderFile = `${entry.key}.placeholder.webp`;
        const placeholder = await this.writeIfMissing(placeholderFile, () =>
            image
                .clone()
                .resize({ width: PLACEHOLDER_WIDTH })
                .webp({ quality: PLACEHOLDER_QUALITY })
                .toBuffer()
        );

        entry.variants = variants;
        entry.placeholder = `data:image/webp;base64,${placeholder.toString('base64')}`;
    }

    /** Returns the cached file's contents, rendering and writing it first if needed. */
    async writeIfMissing(file, render) {
        const target = path.join(this.cacheDir, file);
        if (fs.existsSync(target)) return fs.readFileSync(target);
        const buffer = await render();
        // Write then rename so a partially written file is never served
        const temp = `${target}.tmp`;
        fs.writeFileSync(temp, buffer);
        fs.renameSync(temp, target);
        return buffer;
    }

    /** Deletes cached files belonging to images that were removed or replaced. */
    prune() {
        const keys = new Set([...this.entries.values()].map((entry) => entry.key));
        for (const file of fs.readdirSync(this.cacheDir)) {
            const key = file.replace(/\.(\d+|placeholder)\.webp(\.tmp)?$/, '');
            if (!keys.has(key)) fs.rmSync(path.join(this.cacheDir, file), { force: true });
        }
    }
}

module.exports = { ImageCache };
