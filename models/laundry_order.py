import logging
from odoo import fields, models, _
from odoo.exceptions import ValidationError


_logger = logging.getLogger(__name__)

class LaundryOrder(models.Model):
    _inherit = "laundry.order"

    is_package = fields.Boolean(
        string="Package Usage",
    )

    package_rule_id = fields.Many2one(
        "package.rule",
        string="Package",
    )

    # -------------------------------------------------------------------------
    # POS SAVE FLOW EXTENSIONS
    # -------------------------------------------------------------------------

    def _prepare_pos_laundry_order_context(self, data, pos_config):
        context = super()._prepare_pos_laundry_order_context(data, pos_config)

        package_rule = self._get_package_rule_from_data(data)
        partner_package = False

        if data.get("is_package_usage"):
            partner_package = self.env["partner.package"].browse(data.get("partner_package_id"))
            if not partner_package.exists():
                raise ValidationError(_("Please select a valid package."))

        context.update({
            "package_rule": package_rule,
            "partner_package": partner_package,
        })
        return context

    def _validate_pos_laundry_order_data(self, data, pos_config, context):
        super()._validate_pos_laundry_order_data(data, pos_config, context)

        if data.get("is_package_usage"):
            partner_package = context.get("partner_package")
            if not partner_package:
                raise ValidationError(_("Please select a valid package."))
            self._validate_package_products(partner_package, data.get("lines") or [])

        if data.get("is_package_sale") and not context.get("package_rule"):
            raise ValidationError(_("Package is required for package sale."))

        return True

    def _prepare_laundry_order_vals(self, data, pos_config, context):
        vals = super()._prepare_laundry_order_vals(data, pos_config, context)
        package_rule = context.get("package_rule")

        vals.update({
            "package_rule_id": package_rule.id if package_rule else False,
            "is_package": bool(data.get("is_package_usage")),
        })

        if data.get("is_package_usage"):
            if not pos_config.package_payment_id:
                raise ValidationError(_("Please configure Package Payment Status."))
            vals["payment_status_id"] = pos_config.package_payment_id.id

        return vals

    def _prepare_laundry_order_update_vals(self, data, pos_config, context):
        vals = super()._prepare_laundry_order_update_vals(data, pos_config, context)
        package_rule = context.get("package_rule")

        vals.update({
            "package_rule_id": package_rule.id if package_rule else False,
            "is_package": bool(data.get("is_package_usage")),
        })
        return vals

    def _after_create_laundry_order_from_pos(self, laundry_order, data, pos_config, context):
        super()._after_create_laundry_order_from_pos(laundry_order, data, pos_config, context)

        partner_package = self._create_partner_package(
            data=data,
            laundry_order=laundry_order,
            package_rule=context.get("package_rule"),
        )
        if partner_package:
            context["partner_package"] = partner_package

        self._create_package_usage_lines(data, laundry_order)
        return True

    def _after_update_laundry_order_from_pos(self, laundry_order, data, pos_config, context):
        super()._after_update_laundry_order_from_pos(laundry_order, data, pos_config, context)
        self._recreate_package_usage_lines_for_edit(data, laundry_order)
        return True

    def _extend_pos_laundry_order_response(self, response, laundry_order, data, pos_config, context):
        response = super()._extend_pos_laundry_order_response(response, laundry_order, data, pos_config, context)
        partner_package = context.get("partner_package")

        response.update({
            "partner_package_id": partner_package.id if partner_package else False,
        })
        return response

    # -------------------------------------------------------------------------
    # PACKAGE HELPERS
    # -------------------------------------------------------------------------

    def _get_package_rule_from_data(self, data):
        package_rule_id = data.get("package_rule_id")
        if package_rule_id:
            package_rule = self.env["package.rule"].browse(package_rule_id)
            if package_rule.exists():
                return package_rule

        line_product_ids = [
            line.get("product_id")
            for line in data.get("lines", [])
            if line.get("product_id")
        ]

        if line_product_ids:
            package_rule = self.env["package.rule"].search([
                ("product_id", "in", line_product_ids),
            ], limit=1)
            if package_rule:
                return package_rule

        return self.env["package.rule"]

    def _create_partner_package(self, data, laundry_order, package_rule=False):
        if not data.get("is_package_sale"):
            return False

        if not package_rule:
            raise ValidationError(_("Package is required for package sale."))

        partner_package = self.env["partner.package"].create({
            "partner_id": data.get("partner_id"),
            "package_rule_id": package_rule.id,
            "laundry_order_id": laundry_order.id,
        })

        self._create_partner_package_balances(partner_package)
        return partner_package

    def _create_partner_package_balances(self, partner_package):
        UsageBalance = self.env["partner.package.usage"]

        for detail in partner_package.package_rule_id.detail_ids:
            products = detail.product_ids
            if not products:
                continue

            for product in products:
                UsageBalance.create({
                    "partner_package_id": partner_package.id,
                    "package_rule_detail_id": detail.id,
                    "product_id": product.id,
                    "allowed_qty": detail.qty,
                })

    def _recreate_package_usage_lines_for_edit(self, data, laundry_order):
        laundry_order.ensure_one()
        UsageLine = self.env["partner.package.usage.line"]
        UsageLine.search([
            ("laundry_order_id", "=", laundry_order.id),
        ]).unlink()
        self._create_package_usage_lines(data, laundry_order)

    def _create_package_usage_lines(self, data, laundry_order):
        if not data.get("is_package_usage"):
            return

        partner_package_id = data.get("partner_package_id")
        if not partner_package_id:
            raise ValidationError(_("Please select an active customer package."))

        partner_package = self.env["partner.package"].browse(partner_package_id)
        if not partner_package.exists():
            raise ValidationError(_("Selected customer package was not found."))

        if partner_package.partner_id.id != data.get("partner_id"):
            raise ValidationError(_("Selected package does not belong to this customer."))

        if partner_package.state != "active":
            raise ValidationError(_("Selected package is not active."))

        UsageLine = self.env["partner.package.usage.line"]

        for line in data.get("lines", []):
            product_id = line.get("product_id")
            if not product_id:
                continue

            qty = line.get("qty") or 1.0
            detail = self._get_package_detail_for_product(partner_package, product_id)

            if not detail:
                product = self.env["product.product"].browse(product_id)
                raise ValidationError(
                    _("Product %s is not included in this package.") % product.display_name
                )

            used_qty = sum(
                UsageLine.search([
                    ("partner_package_id", "=", partner_package.id),
                    ("package_rule_detail_id", "=", detail.id),
                ]).mapped("qty")
            )

            remaining_qty = detail.qty - used_qty
            if qty > remaining_qty:
                raise ValidationError(
                    _("Not enough package balance for %s. Remaining: %s, Requested: %s.")
                    % (detail.pos_category_id.name, remaining_qty, qty)
                )

            UsageLine.create({
                "partner_package_id": partner_package.id,
                "package_rule_detail_id": detail.id,
                "laundry_order_id": laundry_order.id,
                "product_id": product_id,
                "qty": qty,
            })

    def _validate_package_products(self, partner_package, lines):
        allowed_products = partner_package.package_rule_id.detail_ids.mapped("product_ids").ids

        for line in lines:
            product_id = line.get("product_id")
            if product_id and product_id not in allowed_products:
                product = self.env["product.product"].browse(product_id)
                raise ValidationError(
                    _("Product %s is not included in this package.") % product.display_name
                )

    def _get_package_detail_for_product(self, partner_package, product_id):
        for detail in partner_package.package_rule_id.detail_ids:
            if product_id in detail.product_ids.ids:
                return detail
        return False

    # -------------------------------------------------------------------------
    # DATA EXTENSIONS
    # -------------------------------------------------------------------------

    def _extend_receipt_data(self, receipt):
        receipt = super()._extend_receipt_data(receipt)
        self.ensure_one()
        receipt.update({
            "is_package_sale": bool(self.order_type_id.is_package_sale),
            "is_package_use": bool(self.order_type_id.is_package_use),
            "is_package": bool(self.is_package),
            "package_rule_id": self.package_rule_id.id if self.package_rule_id else False,
            "package_rule_name": self.package_rule_id.name if self.package_rule_id else "",
        })
        return receipt

    def _get_partner_package_for_order(self, order):
        usage_line = self.env["partner.package.usage.line"].search([
            ("laundry_order_id", "=", order.id),
        ], limit=1)
        return usage_line.partner_package_id if usage_line else False

    def _extend_laundry_order_for_pos_data(self, data, order):
        data = super()._extend_laundry_order_for_pos_data(data, order)

        partner_package = self._get_partner_package_for_order(order)
        core_allowed_category_ids = list(data.get("allowed_category_ids") or [])

        payload = {
            "allowed_product_ids": [],
            "allowed_category_ids": [],
            "details": [],
        }

        if partner_package:
            payload = partner_package._get_pos_package_payload(
                exclude_laundry_order_id=order.id
            )

        allowed_product_ids = payload["allowed_product_ids"]
        package_allowed_category_ids = payload["allowed_category_ids"]
        package_details = payload["details"]
        is_package_usage = bool(order.is_package and partner_package)

        # Normal orders must keep the order type categories returned by the core module.
        # Package usage orders use the package payload categories.
        effective_allowed_category_ids = (
            package_allowed_category_ids
            if is_package_usage
            else core_allowed_category_ids
        )

        data.update({
            "is_package": bool(order.is_package),
            "is_package_usage": is_package_usage,
            "is_package_sale": bool(order.order_type_id.is_package_sale),
            "is_package_use": bool(order.order_type_id.is_package_use),
            "package_rule_id": order.package_rule_id.id if order.package_rule_id else False,
            "package_rule_name": order.package_rule_id.name if order.package_rule_id else "",
            "partner_package_id": partner_package.id if partner_package else False,

            # Canonical frontend state.
            "allowed_package_products": allowed_product_ids,
            "laundry_allowed_pos_category_ids": effective_allowed_category_ids,
            "package_details": package_details,

            # Compatibility aliases. Never overwrite normal-order categories with [].
            "allowed_product_ids": allowed_product_ids,
            "allowed_category_ids": effective_allowed_category_ids,
            "allowed_package_categories": package_allowed_category_ids,
            "details": package_details,
        })

        _logger.info(
            "POS open order payload (package extension): order_id=%s is_package_usage=%s "
            "core_categories=%s package_categories=%s effective_categories=%s "
            "allowed_products=%s",
            order.id,
            is_package_usage,
            core_allowed_category_ids,
            package_allowed_category_ids,
            effective_allowed_category_ids,
            allowed_product_ids,
        )

        return data
