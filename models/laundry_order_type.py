from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


class LaundryOrderType(models.Model):
    _inherit = "laundry.order.type"

    is_package_sale = fields.Boolean(
        string="Is Package Sale",
        help=(
            "Enable this option when the order type "
            "is used to sell a customer package."
        ),
        default=False,
    )

    is_package_use = fields.Boolean(
        string="Is Package Usage",
        help=(
            "Enable this option when the order type "
            "is used to consume an existing customer package."
        ),
        default=False,
    )

    billing_method = fields.Selection(
        selection_add=[
            ("package", "Package"),
        ],
        ondelete={
            "package": "set default",
        },
    )

    @api.onchange("is_package_use")
    def _onchange_is_package_use(self):
        for record in self:
            if not record.is_package_use:
                continue

            record.billing_method = "package"
            record.allow_pay = False
            record.direct_sale = False
            record.allow_refund = False
            record.is_package_sale = False

    @api.onchange("is_package_sale")
    def _onchange_is_package_sale(self):
        for record in self:
            if not record.is_package_sale:
                continue

            # Package sale is a normal paid sale.
            record.billing_method = "customer"
            record.allow_pay = True
            record.direct_sale = True
            record.allow_refund = True
            record.is_package_use = False

    @api.constrains(
        "is_package_sale",
        "is_package_use",
    )
    def _check_package_type(self):
        for record in self:
            if (
                record.is_package_sale
                and record.is_package_use
            ):
                raise ValidationError(
                    _(
                        "An order type cannot be both "
                        "Package Sale and Package Usage."
                    )
                )

    @api.constrains(
        "is_package_use",
        "billing_method",
        "allow_pay",
        "allow_refund",
        "direct_sale",
    )
    def _check_package_usage_configuration(self):
        for record in self:
            if not record.is_package_use:
                continue

            if record.billing_method != "package":
                raise ValidationError(
                    _(
                        "A Package Usage order type must use "
                        "the Package billing method."
                    )
                )

            if record.allow_pay:
                raise ValidationError(
                    _(
                        "Payments must be disabled for "
                        "Package Usage order types."
                    )
                )

            if record.allow_refund:
                raise ValidationError(
                    _(
                        "Refunds must be disabled for "
                        "Package Usage order types."
                    )
                )

            if record.direct_sale:
                raise ValidationError(
                    _(
                        "Direct Sale must be disabled for "
                        "Package Usage order types."
                    )
                )

    @api.constrains(
        "is_package_sale",
        "allow_pay",
        "direct_sale",
    )
    def _check_package_sale_configuration(self):
        for record in self:
            if not record.is_package_sale:
                continue

            if not record.allow_pay:
                raise ValidationError(
                    _(
                        "Payments must be enabled for "
                        "Package Sale order types."
                    )
                )

            if not record.direct_sale:
                raise ValidationError(
                    _(
                        "Direct Sale must be enabled for "
                        "Package Sale order types."
                    )
                )