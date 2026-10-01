const exifr = require('exifr');

// Only the blocks the gallery filters on; tiff is needed to reach the EXIF block
const PARSE_OPTIONS = {
    tiff: true,
    exif: true,
    xmp: true,
    iptc: true,
    ifd1: false,
    gps: false,
    interop: false,
    icc: false,
    jfif: false,
    ihdr: false,
    // Revived dates are converted to the server's time zone, which can move a photo across a year
    reviveValues: false,
    mergeOutput: false,
};

const asList = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/** Keywords from XMP and IPTC merged; a tag that differs only in case is kept once, as first seen. */
function readTags(metadata) {
    const tags = new Map();
    const iptc = asList(metadata.iptc?.Keywords).map((value) => String(value).trim());
    // exifr turns numeric-looking XMP values into numbers ('007' becomes 7), so take the IPTC
    // spelling of those when there is one
    const xmp = asList(metadata.dc?.subject).map((value) =>
        typeof value === 'number' ? (iptc.find((keyword) => keyword && Number(keyword) === value) ?? value) : value
    );
    // XMP first: it is always UTF-8, while IPTC can be in a legacy encoding
    for (const value of [...xmp, ...iptc]) {
        const tag = String(value).trim();
        if (tag && !tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
    }
    return [...tags.values()];
}

function readYear(metadata) {
    // EXIF dates are "YYYY:MM:DD HH:MM:SS" in the camera's local time
    const taken = metadata.exif?.DateTimeOriginal ?? metadata.exif?.CreateDate;
    const year = typeof taken === 'string' ? Number(taken.slice(0, 4)) : NaN;
    return year > 0 ? year : undefined;
}

/**
 * The embedded metadata the gallery filters on. A photo whose metadata cannot be read is still
 * listed, just with nothing to filter it by.
 */
async function readPhotoInfo(filePath) {
    let metadata = {};
    try {
        // exifr cannot read GIFs, which have no EXIF to give anyway
        if (!/\.gif$/i.test(filePath)) metadata = (await exifr.parse(filePath, PARSE_OPTIONS)) || {};
    } catch (error) {
        // I/O errors (EMFILE, EBUSY, a file still being copied) can clear, so fail the read and let
        // the next scan retry rather than caching the photo with no metadata
        if (error.code) throw error;
        console.log(`Unable to read tags from ${filePath}:`, error.message);
        metadata = {};
    }
    return {
        tags: readTags(metadata),
        year: readYear(metadata),
        // Set by Lightroom's black & white conversion
        monochrome: metadata.crs?.ConvertToGrayscale === true,
    };
}

module.exports = { readPhotoInfo };
