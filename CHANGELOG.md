# Changelog

All notable changes to this project are documented in this file.

The version format follows the Odoo module convention:

```text
ODOO_MAJOR.MODULE_MAJOR.MODULE_MINOR.PATCH
```

## [19.0.1.0.2] - 2026-08-30

- Added extensibility hooks for companion addons.
- Added separate read/write board access domains for safe integrations.
- Added overridable personal-board quota and board-name scope hooks.
- Preserved existing personal board ownership and security behavior.
- Moved access-control tests to post-install execution for compatibility with fully loaded Odoo environments.

## [19.0.1.0.1] - 2026-08-10

### Fixed

- Prevented duplicate active board names for the same user and company.
- Improved OWL handling of backend validation errors.
- Prevented repeated autosave retries for validation failures until the invalid value is corrected.

### Changed

- Updated the Odoo Apps presentation for multi-version availability.
- Updated the application cover to represent Odoo 17, 18, and 19.

## [19.0.1.0.0] - 2026-07-31

### Added

- Initial Odoo 19 release.
- Multi-board whiteboard application implemented as an OWL client action.
- Freehand drawing and eraser tools.
- Text, geometric shapes, lines, arrows, and connectors.
- Flowchart and mind-map tools.
- Ready-to-use whiteboard templates.
- Undo and redo history.
- Manual save and autosave.
- Board thumbnails.
- PNG export.
- Responsive and RTL layouts.
- Per-user board ownership.
- Multi-company isolation.
- Optimistic revision-based concurrency protection.
- Backend validation for board data, object types, payload sizes, and thumbnails.
- 64 backend regression tests.

### Changed

- Renamed the technical module to `odoo_whiteboard`.
- Updated the module manifest and asset namespace for Odoo 19.
- Migrated list views to the Odoo 19 `list` view architecture.
- Updated OWL action-hook imports for Odoo 19.
- Updated test-user group assignment to the Odoo 19 `group_ids` field.
- Updated publication metadata for Odoo 19.

### Fixed

- Loaded Fabric.js as a plain third-party browser asset to prevent Odoo from
  interpreting its Node.js `jsdom` fallbacks as frontend module dependencies.
- Preserved an opaque white canvas background when generating JPEG thumbnails.
- Prevented malformed frontend responses from corrupting board state.
- Preserved board selection when loading another board fails.
- Guarded PNG export against initialization and serialization failures.
- Restored a recoverable state after fatal frontend initialization failures.
- Preserved unsaved work during failed saves and navigation attempts.

### Security

- Enforced board ownership and company boundaries.
- Added strict board-ID validation.
- Added board-name normalization and maximum-length enforcement.
- Added canvas JSON size and object-count quotas.
- Restricted permitted Fabric.js object types.
- Rejected unsafe prototype-related keys.
- Rejected unsupported external image sources.
- Added server-side thumbnail validation and resizing.
- Added optimistic revision checks to prevent silent concurrent overwrites.

### Testing

- Backend: 64 tests, 0 failures, 0 errors.
- Frontend: full manual regression checklist completed on Odoo 19.
