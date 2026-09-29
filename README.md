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
