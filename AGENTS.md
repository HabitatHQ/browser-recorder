# Agent instructions

## Versioning

The repo nominally jokes about following [ZeroVer](https://0ver.org/) (major version stays `0` forever). That's tongue-in-cheek — we *do* intend to reach a real stable `1.0.0` in the near future once the feature set and APIs settle. Treat the `0.y.z` scheme as the current pre-stability phase, not a permanent vow.

- Use `./scripts/bump-version.sh minor` for significant new features.
- Use `./scripts/bump-version.sh patch` for bug fixes and small improvements.
- A `1.0.0` bump is on the table when we decide we've stabilized — it's no longer off-limits.
