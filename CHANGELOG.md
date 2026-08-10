# Changelog

All notable changes to this project are documented in this file.

The version format follows the Odoo module convention:

```text
ODOO_MAJOR.MODULE_MAJOR.MODULE_MINOR.PATCH
```
## [18.0.1.0.1] - 2026-08-10

### Fixed

- Prevented duplicate active board names for the same user and company.
- Improved OWL handling of backend validation errors.
- Prevented repeated autosave retries for validation failures until the invalid value is corrected.

### Changed

- Updated the Odoo Apps presentation for multi-version availability.
- Updated the application cover to represent Odoo 17, 18, and 19.

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
