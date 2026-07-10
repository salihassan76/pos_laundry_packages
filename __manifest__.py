{
    "name": "POS Laundry Packages",
    "version": "1.0.0",
    "depends": [
        "pos_laundry",
        "point_of_sale",
    ],
    "category": "Operations",
    "summary": "Package sale and package usage for POS Laundry",
    "description": """
POS Laundry Packages

Adds package functionality on top of POS Laundry:
- Package rules
- Customer packages
- Package selling
- Package usage
- Package balance tracking
- Package usage history
    """,
    "author": "Sayed Ali Hassan",
    "website": "",
    "license": "LGPL-3",
    "data": [
        "security/ir.model.access.csv",
        "views/pos_config_views.xml",
        "views/laundry_order_type_views.xml",
        "views/laundry_package_rule_views.xml",
        "views/laundry_package_rule_action.xml",
        "views/laundry_menus.xml",
    ],
    "assets": {
        "point_of_sale._assets_pos": [
            "pos_laundry_packages/static/src/js/package_engine.js",
            "pos_laundry_packages/static/src/js/package_store_patch.js",
            "pos_laundry_packages/static/src/js/package_category_patch.js",
            "pos_laundry_packages/static/src/js/package_order_patch.js",
            "pos_laundry_packages/static/src/js/package_service_patch.js",
            "pos_laundry_packages/static/src/js/package_utils.js",
            "pos_laundry_packages/static/src/js/package_validation.js",
            "pos_laundry_packages/static/src/js/pos_homescreen_package_patch.js",
            "pos_laundry_packages/static/src/xml/laundry_receipt_package.xml",
            "pos_laundry_packages/static/src/xml/package_category_badge.xml",
            "pos_laundry_packages/static/src/xml/pos_homescreen_packages.xml",
            "pos_laundry_packages/static/src/xml/pos_ordertype_package.xml",
            "pos_laundry_packages/static/src/xml/pos_ordersummery_extension.xml",
        ],
    },
    "installable": True,
    "application": False,
}