{
    "name": "Whiteboard",
    "version": "19.0.1.0.0",
    "category": "Tools",
    "summary": (
        "Secure multi-board whiteboard for drawing, "
        "diagrams, mind maps, and workflows"
    ),
    "description": """
Whiteboard for Odoo 19
======================

A secure and responsive multi-board whiteboard built as an
OWL client action and powered by a locally bundled Fabric.js build.

It provides freehand drawing, text, shapes, connectors, mind maps,
flowcharts, templates, autosave, undo and redo, PNG export, responsive
layouts, RTL support, and optimistic concurrency protection.
""",
    "author": "Gadeer Mahmoud",
    "license": "LGPL-3",
    "images": [
        "static/description/images/main_screenshot.png",
    ],
    "depends": [
        "web",
    ],

    "data": [
        "security/ir.model.access.csv",
        "security/whiteboard_rules.xml",
        "views/whiteboard_board_views.xml",
        "views/whiteboard_action.xml",
    ],

    "assets": {
        "web.assets_backend": [
            "odoo_whiteboard/static/src/lib/fabric.min.js",
            "odoo_whiteboard/static/src/whiteboard_action/whiteboard_action.scss",
            "odoo_whiteboard/static/src/whiteboard_action/whiteboard_action.xml",
            "odoo_whiteboard/static/src/whiteboard_action/whiteboard_objects.js",
            "odoo_whiteboard/static/src/whiteboard_action/whiteboard_templates.js",
            "odoo_whiteboard/static/src/whiteboard_action/whiteboard_action.js",
        ],
    },

    "application": True,
    "installable": True,
    "auto_install": False,
}