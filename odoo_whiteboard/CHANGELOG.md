# Changelog

All notable changes to this project are documented in this file.

The version format follows the Odoo module convention:

```text
ODOO_MAJOR.MODULE_MAJOR.MODULE_MINOR.PATCH
```

## [17.0.1.0.0] - 2026-08-10

### Added

* Initial Odoo 17 release.
* Duplicate board-name protection for active boards belonging to the same user and company.

### Changed

* Adapted the verified Whiteboard implementation for Odoo 17.
* Restored the Odoo 17 `tree` view architecture and `tree,form` action view mode.
* Updated the OWL action-hook import path for Odoo 17 compatibility.
* Adapted the bundled Fabric.js asset loading for Odoo 17.
* Improved OWL handling of backend validation errors so permanent validation failures do not trigger repeated autosave retries.

### Fixed

* Prevented users from creating or renaming active boards to duplicate normalized names.
* Displayed backend validation messages in the Whiteboard interface instead of reporting them as generic autosave failures.
* Preserved unsaved changes when a board-name validation error occurs and allowed autosave to resume after the invalid name is corrected.

### Testing

* Verified clean installation on Odoo 17.
* Backend: 64 tests, 0 failures, 0 errors.
* Frontend: full manual regression checklist completed successfully on Odoo 17.

## [18.0.1.0.0] - 2026-08-09

### Added
- Initial Odoo 18 release.

### Changed
- Backported from the verified Odoo 19 implementation.
- Updated test-user group assignment for Odoo 18 compatibility using the `groups_id` field.

### Testing
- Verified clean installation on Odoo 18.
- Backend: 64 tests, 0 failures, 0 errors.
- Frontend: full manual regression checklist completed successfully on Odoo 18.

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
