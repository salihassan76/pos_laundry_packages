from odoo import _, api, fields, models



class PosConfig(models.Model):
    _inherit = "pos.config"

    package_pos_category_id = fields.Many2one(
        "pos.category",
        string="Package POS Category",
        readonly=False,
    )

    package_payment_id = fields.Many2one(
        "laundry.order.payment.status",
        string="Package Payment Status",
        readonly=False,
    )

    enable_laundry_packages = fields.Boolean(
        string="Enable Packages",
        default=True,
    )

    def _load_pos_data_read(self, records, config):
        data = super()._load_pos_data_read(records, config)

        package_fields = [
            "package_pos_category_id",
            "package_payment_id",
            "enable_laundry_packages",
        ]

        for record in data:
            pos_config = self.browse(record["id"])

            for field_name in package_fields:
                if field_name not in record:
                    value = pos_config[field_name]
                    if hasattr(value, "id"):
                        record[field_name] = value.id or False
                    else:
                        record[field_name] = value

        return data

    def get_laundry_configuration_status(self):
        status = (
            super()
            .get_laundry_configuration_status()
        )

        if self.enable_laundry_packages:
            status["items"].extend([
                {
                    "name": _(
                        "Package POS Category"
                    ),
                    "ok": bool(
                        self.package_pos_category_id
                    ),
                },
                {
                    "name": _(
                        "Package Payment Status"
                    ),
                    "ok": bool(
                        self.package_payment_id
                    ),
                },
            ])

        status["valid"] = all(
            item["ok"]
            for item in status["items"]
        )

        return status
