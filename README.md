# photography
Simple Photography App

## Image variants
The API uses [sharp](https://sharp.pixelplumbing.com/) to generate resized WebP versions
(400/800/1600/2400px) and a tiny blur-up placeholder for every photo in `IMAGES_DIR`, and
returns them as a `srcSet` from `/metadata`, so the gallery only downloads the size it needs.

- Variants are written to `CACHE_DIR` (default `api/.image-cache`) and reused across restarts.
- New, replaced and deleted photos are picked up automatically while the server is running.
- Generating the variants is a one-off cost of a few seconds per photo; photos are served at
  full size until their variants are ready.

## Deployment
Pushing to `main` runs `.github/workflows/deploy.yml`, which builds the client and API on
Ubuntu 22.04 and deploys them to the server as the `deploy-photography` account:

- API code to `/srv/photography`, run by the sandboxed `photography.service` as `svc-photography`.
- Client to `/var/www/photos`, served by nginx at https://photos.mattlyon.co.uk.

The Node version is pinned in `.nvmrc`. CI builds with it, and the server runs it through a shared
nvm install (`/usr/local/nvm/nvm-exec` reads the deployed `.nvmrc`). Install a new version on the
server before bumping it here; the workflow checks and stops if it is missing.

Runtime configuration lives on the server in `/etc/photography.env`, not in the repository or CI.
The server has no public SSH port. The runner joins the tailnet as an ephemeral `tag:ci` node
through Tailscale workload identity federation, then deploys over SSH to the server's tailnet name.

The workflow needs these `production` environment secrets: `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE`
(the Tailscale federated identity), `REMOTE_HOST` (the server's MagicDNS name), `REMOTE_PORT`,
`SSH_PRIVATE_KEY` and `SSH_KNOWN_HOSTS`.
