from odoo import models, fields, api


class LaundryOrderType(models.Model):
    _inherit = "laundry.order.type"
    

    pos_category_ids = fields.Many2many(
        "pos.category",
        string="Allowed POS Categories",
        help="Leave empty to show all POS categories."
    )
    
    is_package_sale = fields.Boolean(
        string="Is Package Sale",
        help="Check if this order type is for Selling Packages.",
        default=False
    )

    is_package_use = fields.Boolean(
        string="Is Package Usage",
        help="Check if this order type should be used for Package Usage",
        default=False
    )

    
    billing_method = fields.Selection(
        selection_add=[
            ("package", "Package"),
        ],
        ondelete={
            "package": "set default",
        },
    )



