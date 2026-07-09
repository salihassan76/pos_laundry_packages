/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/services/pos_store";

import {
    getLivePackageDetails,
    getLiveAllowedProductIds,
    getLiveAllowedCategoryIds,
    getLiveRemainingByCategory,
    getPackageDetailForProduct,
    getPackageDetailForCategory,
    canUsePackageProduct,
    getPackageCategoryBadge,
    isPackageCategoryExhausted,
} from "./package_engine";

console.log("Laundry package store patch loaded");

patch(PosStore.prototype, {
    getPackageOrder() {
        return this.getOrder?.() || this.get_order?.();
    },

    get isPackageUsageOrder() {
        const order = this.getPackageOrder();
        return Boolean(order?.uiState?.is_package_usage);
    },

    get packageLiveDetails() {
        const order = this.getPackageOrder();

        if (!order?.uiState?.is_package_usage) {
            return [];
        }

        return getLivePackageDetails(order);
    },

    get packageAllowedProductIds() {
        const order = this.getPackageOrder();

        if (!order?.uiState?.is_package_usage) {
            return [];
        }

        return getLiveAllowedProductIds(order);
    },

    get packageAllowedCategoryIds() {
        const order = this.getPackageOrder();

        if (!order?.uiState?.is_package_usage) {
            return [];
        }

        return getLiveAllowedCategoryIds(order);
    },

    get packageRemainingByCategory() {
        const order = this.getPackageOrder();

        if (!order?.uiState?.is_package_usage) {
            return {};
        }

        return getLiveRemainingByCategory(order);
    },

    getPackageDetailForProduct(productId) {
        const order = this.getPackageOrder();

        if (!order?.uiState?.is_package_usage) {
            return false;
        }

        return getPackageDetailForProduct(order, productId);
    },

    getPackageDetailForCategory(categoryId) {
        const order = this.getPackageOrder();

        if (!order?.uiState?.is_package_usage) {
            return false;
        }

        return getPackageDetailForCategory(order, categoryId);
    },

    canUsePackageProduct(productId, qty = 1) {
        const order = this.getPackageOrder();

        if (!order?.uiState?.is_package_usage) {
            return true;
        }

        return canUsePackageProduct(order, productId, qty);
    },

    getPackageCategoryBadge(categoryId) {
        const order = this.getPackageOrder();

        if (!order?.uiState?.is_package_usage) {
            return "";
        }

        const directBadge = getPackageCategoryBadge(order, categoryId);
        if (directBadge !== "") {
            return directBadge;
        }

        const childIds = this.getPackageChildCategoryIds(categoryId);
        if (!childIds.length) {
            return "";
        }

        let total = 0;
        let found = false;

        for (const childId of childIds) {
            const badge = getPackageCategoryBadge(order, childId);
            if (badge !== "") {
                total += Number(badge || 0);
                found = true;
            }
        }

        return found ? `${total}` : "";
    },

    isPackageCategoryExhausted(categoryId) {
        const order = this.getPackageOrder();

        if (!order?.uiState?.is_package_usage) {
            return false;
        }

        const directBadge = getPackageCategoryBadge(order, categoryId);
        if (directBadge !== "") {
            return isPackageCategoryExhausted(order, categoryId);
        }

        const childIds = this.getPackageChildCategoryIds(categoryId);
        if (!childIds.length) {
            return false;
        }

        const childBadges = childIds
            .map((childId) => getPackageCategoryBadge(order, childId))
            .filter((badge) => badge !== "");

        if (!childBadges.length) {
            return false;
        }

        return childBadges.every((badge) => Number(badge || 0) <= 0);
    },
    getPackageChildCategoryIds(categoryId) {
        const categories =
            this.models?.["pos.category"] ||
            this.data?.models?.["pos.category"];

        if (!categories) {
            return [];
        }

        const records =
            categories.getAll?.() ||
            Array.from(categories.values?.() || []);

        const childIds = [];

        const collectChildren = (parentId) => {
            for (const category of records) {
                const parent =
                    category.parent_id?.id ||
                    category.parent_id?.[0] ||
                    category.parent_id ||
                    false;

                if (parent === parentId) {
                    childIds.push(category.id);
                    collectChildren(category.id);
                }
            }
        };

        collectChildren(categoryId);
        return childIds;
    },

});