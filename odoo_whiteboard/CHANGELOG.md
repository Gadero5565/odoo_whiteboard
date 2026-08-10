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
