# Security

Photo Planet is meant to be put on the internet behind HTTPS with
`APP_PASSWORD` and `SESSION_SECRET` set (see the README).

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private
[security advisory form](../../security/advisories/new) for this repository,
with steps to reproduce and the version (`curl https://your-host/api/health`
shows it). You'll get a reply as soon as possible.

## Supported versions

Fixes go into the latest release; update with
`docker compose pull && docker compose up -d`.
