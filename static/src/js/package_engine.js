/** @odoo-module **/

export function toArray(value) {
    return Array.isArray(value) ? value : [];
}

export function toId(value) {
    if (!value) {
        return false;
    }
    if (typeof value === "object") {
        return value.id || value[0] || false;
    }
    return value;
}

export function uniqueIds(ids = []) {
    return [...new Set(toArray(ids).map((id) => toId(id)).filter(Boolean))];
}

export function getOrderLines(order) {
    return order?.lines || order?.orderlines || order?.getOrderlines?.() || [];
}

export function getLineProductId(line) {
    return toId(line?.product_id || line?.product || line?.get_product?.());
}

export function getLineQty(line) {
    if (typeof line?.get_quantity === "function") {
        return line.get_quantity();
    }
    return line?.qty || line?.quantity || 0;
}

export function normalizePackageDetail(detail = {}) {
    return {
        detail_id: detail.detail_id || detail.id || false,
        category_id: toId(detail.category_id),
        category_name: detail.category_name || "",
        product_ids: uniqueIds(detail.product_ids || []),
        allowed_qty: Number(detail.allowed_qty || 0),
        used_qty: Number(detail.used_qty || 0),
        remaining_qty: Number(detail.remaining_qty ?? detail.allowed_qty ?? 0),
    };
}

export function getBasePackageDetails(order) {
    return toArray(order?.uiState?.package_details || []).map(normalizePackageDetail);
}

export function getCurrentOrderQtyForDetail(order, detail) {
    let currentOrderQty = 0;
    const productIds = detail.product_ids || [];

    for (const line of getOrderLines(order)) {
        const productId = getLineProductId(line);
        if (productId && productIds.includes(productId)) {
            currentOrderQty += getLineQty(line);
        }
    }

    return currentOrderQty;
}

export function getLivePackageDetails(order) {
    const details = getBasePackageDetails(order);

    return details.map((detail) => {
        const currentOrderQty = getCurrentOrderQtyForDetail(order, detail);
        const liveRemaining = detail.remaining_qty - currentOrderQty;

        return {
            ...detail,
            current_order_qty: currentOrderQty,
            live_remaining_qty: liveRemaining > 0 ? liveRemaining : 0,
            is_exhausted: liveRemaining <= 0,
        };
    });
}

export function getLiveAllowedProductIds(order) {
    return uniqueIds(
        getLivePackageDetails(order)
            .filter((detail) => detail.live_remaining_qty > 0)
            .flatMap((detail) => detail.product_ids || [])
    );
}

export function getAllPackageProductIds(order) {
    return uniqueIds(getBasePackageDetails(order).flatMap((detail) => detail.product_ids || []));
}

export function getLiveAllowedCategoryIds(order) {
    return uniqueIds(
        getLivePackageDetails(order)
            .filter((detail) => detail.live_remaining_qty > 0)
            .map((detail) => detail.category_id)
    );
}

export function getAllPackageCategoryIds(order) {
    return uniqueIds(getBasePackageDetails(order).map((detail) => detail.category_id));
}

export function getLiveRemainingByCategory(order) {
    const result = {};
    for (const detail of getLivePackageDetails(order)) {
        if (detail.category_id) {
            result[detail.category_id] = detail.live_remaining_qty;
        }
    }
    return result;
}

export function getPackageDetailForProduct(order, productId) {
    const id = toId(productId);
    return getLivePackageDetails(order).find((detail) => (detail.product_ids || []).includes(id));
}

export function getPackageDetailForCategory(order, categoryId) {
    const id = toId(categoryId);
    return getLivePackageDetails(order).find((detail) => detail.category_id === id);
}

export function canUsePackageProduct(order, productId, qty = 1) {
    const detail = getPackageDetailForProduct(order, productId);
    if (!detail) {
        return false;
    }
    return detail.live_remaining_qty >= qty;
}

export function getPackageCategoryBadge(order, categoryId) {
    const detail = getPackageDetailForCategory(order, categoryId);
    if (!detail) {
        return "";
    }
    return String(detail.live_remaining_qty);
}

export function isPackageCategoryExhausted(order, categoryId) {
    const detail = getPackageDetailForCategory(order, categoryId);
    return Boolean(detail && detail.live_remaining_qty <= 0);
}
