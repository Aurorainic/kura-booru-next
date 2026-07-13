# Building the Kura Booru Caddy binary

Caddy is shipped as a custom build because the cache directive requires
the third-party `cache-handler` module and the cloudflare DNS-01
challenge needs `caddy-dns/cloudflare`. The default apt caddy binary
won't have either.

## Build command

```bash
xcaddy build v2.10.0 \
  --output /usr/local/bin/caddy-kura \
  --with github.com/caddyserver/cache-handler \
  --with github.com/caddy-dns/cloudflare
```

Then install over the system caddy:

```bash
sudo systemctl stop caddy
sudo cp /usr/local/bin/caddy-kura /usr/bin/caddy
sudo systemctl start caddy
```

Both modules are pinned at the v2.10.0 caddy tag. Use a newer xcaddy
release if the cache-handler version drifts; cache-handler v0.16+ is
the first series that supports caddy 2.10.

## What cache applies

- All responses not already marked `Cache-Control: private, no-store`.
- The app's `server/middleware/02-cache-control.ts` is the source of
  truth for cacheability. Anon visitors → `public, s-maxage=300`.
  Admin cookie sessions → `private, no-store` (bypasses cache).
- Static assets (`/i/*` etc.) are handled separately via the
  `@hashedAssets` header matcher — those don't enter the caddy
  cache but are tagged with a long client-side max-age.

## What bypasses the cache

- Any response with `Cache-Control: private` or `no-store`.
- Login and admin paths (the app middleware tags them no-store).
- Image responses from `/i/*` (bypassed, served directly).

## Rollback

The `apt`-installed caddy binary is preserved at
`/usr/bin/caddy.orig.v2.9.1` (see infra/caddy.bak.<timestamp> on the
host that ran the upgrade). To revert:

```bash
sudo systemctl stop caddy
sudo cp /usr/bin/caddy.orig.v2.9.1 /usr/bin/caddy
sudo systemctl start caddy
```
