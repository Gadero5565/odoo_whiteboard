# Whiteboard for Odoo

A secure, responsive, multi-board whiteboard application for Odoo.

The module is implemented as an OWL client action and uses a locally bundled
Fabric.js library for canvas rendering and object manipulation.

## Supported versions

| Odoo version | Branch | Status |
|---|---|---|
| Odoo 18 | `18.0` | In development |

This repository currently contains the Odoo 19 edition.

The legacy Odoo 16 edition is maintained separately in its original repository
under the technical module name `odoo_v16_whiteboard`.

## Features

- Multiple private boards per user
- Freehand drawing
- Eraser tool
- Text boxes
- Rectangles, circles, triangles, and lines
- Arrows and connectors
- Flowchart elements
- Mind-map templates
- Ready-to-use board templates
- Object selection and manipulation
- Undo and redo
- Manual save and autosave
- Optimistic concurrency protection
- Board thumbnails
- PNG export
- Responsive layouts
- RTL layout support
- User and company data isolation

## Security and data integrity

Whiteboard includes backend validation and access protections for:

- Per-user board ownership
- Multi-company isolation
- Strict board identifier validation
- Board-name normalization and length limits
- Maximum board quotas
- Maximum canvas object counts
- Maximum JSON payload sizes
- Restricted Fabric.js object types
- Rejection of unsafe object keys
- Rejection of unsupported external image sources
- Thumbnail validation and resizing
- Optimistic revision checks to prevent silent overwrite conflicts

## Technical overview

- Odoo version: 19.0
- Technical module name: `odoo_whiteboard`
- Visible application name: `Whiteboard`
- Frontend framework: OWL
- Canvas library: Fabric.js 5.3.0
- License: LGPL-3
- Fabric.js license: MIT

The Fabric.js distribution is bundled locally. No external CDN is required.

## Installation

1. Copy the `odoo_whiteboard` addon folder into an Odoo addons directory.
2. Add the parent directory to the Odoo `addons_path`.
3. Restart Odoo.
4. Update the Apps list.
5. Search for **Whiteboard**.
6. Install the module.

Example installation from the command line:

```bash
./odoo-bin \
  -d YOUR_DATABASE \
  -i odoo_whiteboard \
  --stop-after-init
```

On Windows PowerShell:

```powershell
python .\odoo-bin `
  -c ".\odoo19.conf" `
  -d YOUR_DATABASE `
  -i odoo_whiteboard `
  --stop-after-init
```

## Testing

The Odoo 19 backend regression suite currently contains 64 tests.

Verified result:

```text
64 tests
0 failures
0 errors
```

Run the module tests with:

```bash
./odoo-bin \
  -d YOUR_TEST_DATABASE \
  -u odoo_whiteboard \
  --test-tags="/odoo_whiteboard" \
  --stop-after-init \
  --log-level=test
```

Windows PowerShell:

```powershell
python .\odoo-bin `
  -c ".\odoo19.conf" `
  -d YOUR_TEST_DATABASE `
  -u odoo_whiteboard `
  --test-tags="/odoo_whiteboard" `
  --stop-after-init `
  --log-level=test
```

The frontend was also manually regression-tested on Odoo 19, including:

- Board creation, loading, renaming, switching, and deletion
- Drawing and object tools
- Templates and connectors
- Undo and redo
- Manual save and autosave
- Revision-conflict handling
- Failed-load recovery
- Unsaved-change navigation protection
- Thumbnail generation
- PNG export
- Responsive layouts
- RTL layout
- Browser-console error checks

## Repository structure

```text
odoo_whiteboard/
├── odoo_whiteboard/
│   ├── models/
│   ├── security/
│   ├── static/
│   │   ├── description/
│   │   └── src/
│   ├── tests/
│   ├── views/
│   ├── __init__.py
│   └── __manifest__.py
├── LICENSE
├── THIRD_PARTY_NOTICES.md
├── CHANGELOG.md
└── README.md
```

## Third-party software

This module includes Fabric.js 5.3.0 under the MIT license.

See:

- `THIRD_PARTY_NOTICES.md`
- `odoo_whiteboard/THIRD_PARTY_NOTICES.md`
- `odoo_whiteboard/static/src/lib/FABRIC_LICENSE.txt`

## License

Whiteboard is released under the GNU Lesser General Public License,
version 3.0.

See `LICENSE` and `odoo_whiteboard/LICENSE`.

## Author

Gadeer Mahmoud
