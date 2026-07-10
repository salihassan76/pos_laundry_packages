/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/services/pos_store";
import { getLiveAllowedProductIds } from "./package_engine";

console.log("Laundry package product filter loaded");

function normalizeIds(values = []) {
    return [...new Set(
        (values || [])
            .map((value) => {
                if (typeof value === "number") {
                    return value;
                }

                if (typeof value === "string") {
                    return Number(value);
                }

                if (Array.isArray(value)) {
                    return Number(value[0]);
                }

                return Number(value?.id);
            })
            .filter((value) =>
                Number.isInteger(value) && value > 0
            )
    )];
}

patch(PosStore.prototype, {
    get productToDisplayByCateg() {
        /*
         * This is already filtered by the core laundry module.
         */
        const result = super.productToDisplayByCateg;

        const order =
            this.getOrder?.() ||
            this.get_order?.() ||
            null;

        if (!order?.uiState?.is_package_usage) {
            return result;
        }

        const liveAllowedIds = normalizeIds(
            getLiveAllowedProductIds(order) || []
        );

        const storedAllowedIds = normalizeIds(
            order.uiState?.allowed_package_products ||
            order.allowed_package_products ||
            []
        );

        const allowedProductIds = new Set(
            liveAllowedIds.length
                ? liveAllowedIds
                : storedAllowedIds
        );

        if (!allowedProductIds.size) {
            return [];
        }

        return result
            .map(([category, products]) => [
                category,
                products.filter((product) =>
                    allowedProductIds.has(
                        Number(product.id)
                    )
                ),
            ])
            .filter(([, products]) =>
                products.length > 0
            );
    },
});