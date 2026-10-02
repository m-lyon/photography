# photography

Simple Photography App

## Image variants

The API uses [sharp](https://sharp.pixelplumbing.com/) to generate resized WebP versions
(400/800/1600/2400px) and a tiny blur-up placeholder for every photo in `IMAGES_DIR`, and
returns them as a `srcSet` from `/metadata`, so the gallery only downloads the size it needs.

- Variants are written to `CACHE_DIR` (default `api/.image-cache`) and reused across restarts.
  In production `CACHE_DIR` is `/srv/photography-data/cache`, the only path the sandboxed
  service can write; the deployed code directory is read-only to `svc-photography`. Without a
  writable cache the API still serves originals, just with no variants or placeholders.
- New, replaced and deleted photos are picked up automatically while the server is running.
- Generating the variants is a one-off cost of a few seconds per photo; photos are served at
  full size until their variants are ready.

## Filtering by tag

The gallery can be filtered by subject, by year, and to black & white photos. The selection is
kept in the URL (e.g. `?tag=wildlife&year=2018`), so filtered views can be shared.

- **Subjects** come from the keywords embedded in each photo (XMP `dc:subject` and IPTC
  `Keywords`), matched regardless of case.
- **Year** comes from the EXIF capture date, and **black & white** from Lightroom's grayscale
  conversion.

Keywords can be edited in place with [exiftool](https://exiftool.org), without re-exporting:

```bash
# Add or remove a keyword
exiftool -XMP-dc:Subject+=Wildlife -IPTC:Keywords+=Wildlife photo.jpg
exiftool -XMP-dc:Subject-=Wildlife -IPTC:Keywords-=Wildlife photo.jpg

# Or edit every photo's keywords in a spreadsheet and write them back
exiftool -csv -XMP-dc:Subject -IPTC:Keywords *.jpg > tags.csv
exiftool -csv=tags.csv -sep ", " -codedcharacterset=utf8 *.jpg
```

exiftool keeps a `*.jpg_original` backup of each file it changes; `exiftool -delete_original`
removes them. Edited photos are picked up automatically, and since their modification time and size
change, their variants are regenerated too.
