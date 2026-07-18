/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/services/pos_store";
import { getLiveAllowedProductIds } from "./package_engine";

console.log("Laundry package product patch loaded");

function normalizeId(value) {
    if (!value) {
        return false;
    }

    if (Array.isArray(value)) {
        return normalizeId(value[0]);
    }

    if (typeof value === "object") {
        return normalizeId(value.id || value.raw?.id || false);
    }

    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : false;
}

function normalizeIds(values = []) {
    return [
        ...new Set(
            (Array.isArray(values) ? values : [])
                .map(normalizeId)
                .filter(Boolean)
        ),
    ];
}

function getProductId(product) {
    return normalizeId(
        product?.id ||
        product?.raw?.id ||
        product?.product_tmpl_id ||
        false
    );
}

function filterProductResult(result, allowedProductIds) {
    if (!Array.isArray(result)) {
        return result;
    }

    // Some core/custom implementations return:
    // [[categoryRecord, [productRecord, ...]], ...]
    const isGroupedResult = result.every(
        (entry) =>
            Array.isArray(entry) &&
            entry.length >= 2 &&
            Array.isArray(entry[1])
    );

    if (isGroupedResult) {
        return result
            .map(([category, products, ...rest]) => [
                category,
                products.filter((product) =>
                    allowedProductIds.has(getProductId(product))
                ),
                ...rest,
            ])
            .filter((entry) => entry[1].length > 0);
    }

    // Standard Odoo 19/core laundry implementations may return a flat
    // array of product records for the selected category.
    return result.filter((product) =>
        allowedProductIds.has(getProductId(product))
    );
}

patch(PosStore.prototype, {
    get productToDisplayByCateg() {
        const result = super.productToDisplayByCateg;

        const order =
            this.getOrder?.() ||
            this.get_order?.() ||
            null;

        if (!order?.uiState?.is_package_usage) {
            return result;
        }

        const liveAllowedIds = normalizeIds(
            getLiveAllowedProductIds(order)
        );

        const storedAllowedIds = normalizeIds(
            order.uiState?.allowed_package_products ||
            order.allowed_package_products ||
            []
        );

        const finalAllowedIds = liveAllowedIds.length
            ? liveAllowedIds
            : storedAllowedIds;

        const allowedProductIds = new Set(finalAllowedIds);

        console.log("[Laundry Packages] Product visibility", {
            orderUuid: order?.uuid || false,
            selectedCategoryId:
                this.selectedCategoryId ||
                this.selected_category_id ||
                this.productListCategoryId ||
                false,
            liveAllowedIds,
            storedAllowedIds,
            resultShape:
                Array.isArray(result) &&
                Array.isArray(result[0]) &&
                Array.isArray(result[0]?.[1])
                    ? "grouped"
                    : "flat",
            sourceProductCount: Array.isArray(result)
                ? result.length
                : false,
        });

        if (!allowedProductIds.size) {
            console.warn(
                "[Laundry Packages] No allowed package products found",
                {
                    packageDetails:
                        order.uiState?.package_details || [],
                    storedAllowedProducts:
                        order.uiState?.allowed_package_products || [],
                }
            );
            return [];
        }

        return filterProductResult(result, allowedProductIds);
    },
});
