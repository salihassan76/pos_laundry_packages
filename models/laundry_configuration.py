from odoo import models, fields, api, _
from odoo.exceptions import UserError


class LaundryConfiguration(models.Model):
    _inherit = "laundry.configuration"
    
    package_pos_category_id = fields.Many2one(
        "pos.category",
        string="Package POS Category",
    )

    
    package_payment_id = fields.Many2one(
        "laundry.order.payment.status",
        string="Package Payment Status",
    )

    def _load_pos_data_read(self, records, config):
        data = super()._load_pos_data_read(records, config)

        package_fields = [
            "package_pos_category_id",
            "package_payment_id",
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
        status = super().get_laundry_configuration_status()

        status["items"].extend([
            {
                "name": _("Package POS Category"),
                "ok": bool(self.package_pos_category_id),
            },
            {
                "name": _("Package Payment Status"),
                "ok": bool(self.package_payment_id),
            },
        ])

        status["valid"] = all(item["ok"] for item in status["items"])
        return status

    