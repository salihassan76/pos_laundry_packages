from odoo import models, fields, api
from datetime import timedelta


class PartnerPackage(models.Model):
    _name = "partner.package"
    _description = "Customer Package"
    _order = "id desc"

    name = fields.Char(
        string="Package No.",
        readonly=True,
        copy=False,
        default=lambda self: self.env["ir.sequence"].next_by_code("partner.package") or "New",
    )

    partner_id = fields.Many2one(
        "res.partner",
        required=True,
    )

    package_rule_id = fields.Many2one(
        "package.rule",
        required=True,
    )

    laundry_order_id = fields.Many2one(
        "laundry.order",
        string="Purchase Order",
        required=True,
        readonly=True,
        ondelete="restrict",
    )

    pos_order_id = fields.Many2one(
        "pos.order",
        string="POS Order",
        readonly=True,
        copy=False,
    )

    start_date = fields.Date(
        default=fields.Date.context_today,
        required=True,
    )

    end_date = fields.Date(
        compute="_compute_end_date",
        store=True,
    )

    state = fields.Selection(
        [
            ("active", "Active"),
            ("expired", "Expired"),
        ],
        compute="_compute_state",
        store=True,
    )

    usage_ids = fields.One2many(
        "partner.package.usage",
        "partner_package_id",
        string="Package Balance",
    )

    usage_history_ids = fields.One2many(
        "partner.package.usage.line",
        "partner_package_id",
        string="Usage History",
    )

    @api.depends("start_date", "package_rule_id.duration")
    def _compute_end_date(self):
        for rec in self:
            if rec.start_date and rec.package_rule_id and rec.package_rule_id.duration:
                rec.end_date = rec.start_date + timedelta(days=rec.package_rule_id.duration)
            else:
                rec.end_date = False

    @api.depends("end_date")
    def _compute_state(self):
        today = fields.Date.today()
        for rec in self:
            if rec.end_date and rec.end_date < today:
                rec.state = "expired"
            else:
                rec.state = "active"

    def _get_pos_package_payload(self, exclude_laundry_order_id=False):
        """Single source of truth for POS package state.

        Returns categories, products and remaining quantities from partner.package.
        If an existing laundry order is being reopened, exclude its own usage lines
        so the user can edit the order without double-counting the same order lines.
        """
        self.ensure_one()

        allowed_product_ids = []
        allowed_category_ids = []
        details = []

        UsageLine = self.env["partner.package.usage.line"]

        for detail in self.package_rule_id.detail_ids:
            product_ids = detail.product_ids.ids
            category = detail.pos_category_id

            allowed_product_ids.extend(product_ids)
            if category:
                allowed_category_ids.append(category.id)

            usage_domain = [
                ("partner_package_id", "=", self.id),
                ("package_rule_detail_id", "=", detail.id),
            ]
            if exclude_laundry_order_id:
                usage_domain.append(("laundry_order_id", "!=", exclude_laundry_order_id))

            used_qty = sum(UsageLine.search(usage_domain).mapped("qty"))
            remaining_qty = max((detail.qty or 0) - used_qty, 0)

            details.append({
                "detail_id": detail.id,
                "category_id": category.id if category else False,
                "category_name": category.name if category else "",
                "product_ids": product_ids,
                "allowed_qty": detail.qty or 0,
                "used_qty": used_qty,
                "remaining_qty": remaining_qty,
            })

        return {
            "allowed_product_ids": list(set(allowed_product_ids)),
            "allowed_category_ids": list(set(allowed_category_ids)),
            "details": details,
        }

    @api.model
    def get_active_packages_for_pos(self, partner_id, pos_config_id=False):
        domain = [
            ("partner_id", "=", partner_id),
            ("state", "=", "active"),
        ]

        if pos_config_id:
            domain += [
                "|",
                ("package_rule_id.pos_config_ids", "=", False),
                ("package_rule_id.pos_config_ids", "in", [pos_config_id]),
            ]

        packages = self.search(domain)
        result = []

        for package in packages:
            payload = package._get_pos_package_payload()

            result.append({
                "id": package.id,
                "name": package.name,
                "package_rule_id": [
                    package.package_rule_id.id,
                    package.package_rule_id.name,
                ],
                "laundry_order_id": package.laundry_order_id.id,
                "package_rule_name": package.package_rule_id.name,
                "start_date": fields.Date.to_string(package.start_date) if package.start_date else False,
                "end_date": fields.Date.to_string(package.end_date) if package.end_date else False,
                "state": package.state,
                "allowed_product_ids": payload["allowed_product_ids"],
                "allowed_category_ids": payload["allowed_category_ids"],
                "details": payload["details"],
                # compatibility aliases for older JS
                "allowed_package_products": payload["allowed_product_ids"],
                "allowed_package_categories": payload["allowed_category_ids"],
                "package_details": payload["details"],
            })

        return result
