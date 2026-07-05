# Changelog

All notable changes to `saltcorn-samba` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] – 2026-07-05

### Added
- **New view template `SambaFileManager`** — a Saltcorn-style file browser
  (like *Settings → Files*). Table with icon, filename, media type, size,
  modified date and per-row actions (View / Download / Open in file manager).
  Includes breadcrumb navigation, up-button, home-button, refresh, hidden-file
  toggle, click-to-sort columns and optional pagination.
- Inline PDF/image viewer directly inside the file-manager view.
- Publishing metadata: `repository`, `homepage`, `bugs`, `engines`,
  `publishConfig`, `files`, `prepublishOnly` — ready for `npm publish` and
  GitHub-based installs.
- MIT `LICENSE` file, `CHANGELOG.md`, `.gitignore`, `.npmignore`.
- Simple sanitizer unit tests under `test/`.

### Changed
- Plugin version is now read from `package.json`; the client bootstrap URLs
  (`/plugins/public/saltcorn-samba@<version>/…`) update automatically.
- View templates are wrapped in `index.js` to inject `__pluginVersion` into
  their configuration – no more hard-coded version strings across files.

### Fixed
- Path sanitizer now rejects `//srv/share`-style UNC paths *before*
  collapsing consecutive slashes.
- HTML-escape user-visible path in the `/sambalink` response.

## [0.1.0] – 2026-07-05

### Added
- Initial release.
- `SambaTree` view template (lazy directory tree).
- `samba_pdf` fieldview (inline PDF/image viewer for String fields).
- Routes `/sambadir`, `/sambafile`, `/sambalink`.
- Direct SMB2 access via `@marsaud/smb2`.
- Strict path-traversal protection.
