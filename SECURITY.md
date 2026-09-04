# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected security vulnerability. Contact the maintainer through the private contact channel listed on the GitHub profile for `MengPaul07` and include reproduction steps, affected versions, and impact when possible.

## Credentials

ChatVerse is designed for bring-your-own-provider credentials. Never commit API keys, SSH keys, production environment files, or host-specific deployment configuration. Use local environment files excluded by `.gitignore`, browser-local provider settings, or a secret manager appropriate for your deployment.

If a credential is accidentally committed, revoke and rotate it before rewriting Git history. Removing it in a later commit is not sufficient.
