/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { CategorySelector } from "@point_of_sale/app/components/category_selector/category_selector";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";

console.log("Laundry package category features loaded");

function getCurrentOrder(pos) {
    return (
        pos.getOrder?.() ||
        pos.get_order?.() ||
        null
    );
}

patch(CategorySelector.prototype, {
    /*
     * Package addon only supplies badge information.
     * It does not filter the category list.
     */
    getPackageCategoryBadge(categoryId) {
        return (
            this.pos.getPackageCategoryBadge?.(categoryId) ||
            ""
        );
    },

    isPackageCategoryDisabled(categoryId) {
        return Boolean(
            this.pos.isPackageCategoryExhausted?.(
                categoryId
            )
        );
    },
});

patch(ProductScreen.prototype, {
    setup() {
        super.setup(...arguments);

        setTimeout(() => {
            const order = getCurrentOrder(this.pos);

            if (!order?.uiState?.is_package_usage) {
                return;
            }

            const startCategoryId = Number(
                order.uiState
                    ?.laundry_start_category_id
            );

            if (!startCategoryId) {
                return;
            }

            if (
                order.uiState
                    ?.laundry_start_category_opened
            ) {
                return;
            }

            order.uiState
                .laundry_start_category_opened = true;

            this.pos.selectedCategoryId =
                startCategoryId;

            this.pos.selected_category_id =
                startCategoryId;

            this.pos.productListCategoryId =
                startCategoryId;

            this.render?.();
        }, 0);
    },
});