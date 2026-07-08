from odoo import fields, models


class PosConfig(models.Model):
    _inherit = "pos.config"

    package_pos_category_id = fields.Many2one(
        related="laundry_configuration_id.package_pos_category_id",
        readonly=False,
        string="Package POS Category",
    )

    package_payment_id = fields.Many2one(
        related="laundry_configuration_id.package_payment_id",
        readonly=False,
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
