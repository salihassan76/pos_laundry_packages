/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { laundryService } from "@pos_laundry/app/services/laundry_service";

const originalStart = laundryService.start;

function uniqueIds(ids = []) {
    return [...new Set((ids || []).filter(Boolean))];
}

function getPackageRuleId(pkg) {
    return pkg.package_rule_id?.[0] || pkg.package_rule_id || false;
}

function getPackageRuleName(pkg) {
    return pkg.package_rule_name || pkg.package_rule_id?.[1] || "";
}

function normalizePackageDetails(pkg) {
    return pkg.package_details || pkg.details || [];
}

function getAllowedPackageProducts(pkg) {
    const details = normalizePackageDetails(pkg);
    if (details.length) {
        return uniqueIds(details.flatMap((detail) => detail.product_ids || []));
    }
    return uniqueIds(pkg.allowed_product_ids || pkg.allowed_package_products || []);
}

function getAllowedPackageCategories(pkg) {
    const details = normalizePackageDetails(pkg);
    if (details.length) {
        return uniqueIds(details.map((detail) => detail.category_id).filter(Boolean));
    }
    return uniqueIds(pkg.allowed_category_ids || pkg.allowed_package_categories || []);
}

laundryService.start = function (env, deps) {
    const service = originalStart.call(this, env, deps);

    const originalGetVisibleOrderTypeFields = service.getVisibleOrderTypeFields.bind(service);
    service.getVisibleOrderTypeFields = function () {
        return uniqueIds([
            ...originalGetVisibleOrderTypeFields(),
            "is_package_sale",
            "is_package_use",
        ]);
    };

    const originalAfterSetLaundryOrderState = service._afterSetLaundryOrderState.bind(service);
    service._afterSetLaundryOrderState = function (order, values = {}) {
        originalAfterSetLaundryOrderState(order, values);

        if (!order || !order.uiState) {
            return;
        }

        if ("is_package_sale" in values) {
            order.uiState.is_package_sale = Boolean(values.is_package_sale);
        }

        if ("is_package_usage" in values) {
            order.uiState.is_package_usage = Boolean(values.is_package_usage);
        }

        if ("partner_package_id" in values) {
            order.uiState.partner_package_id = values.partner_package_id || false;
        }

        if ("package_rule_id" in values) {
            order.uiState.package_rule_id = values.package_rule_id || false;
        }

        if ("package_rule_name" in values) {
            order.uiState.package_rule_name = values.package_rule_name || "";
        }

        if ("allowed_package_products" in values || "allowed_product_ids" in values) {
            order.uiState.allowed_package_products =
                values.allowed_package_products || values.allowed_product_ids || [];
        }

        if (
            "laundry_allowed_pos_category_ids" in values ||
            "allowed_category_ids" in values ||
            "allowed_package_categories" in values
        ) {
            order.uiState.laundry_allowed_pos_category_ids =
                values.laundry_allowed_pos_category_ids ||
                values.allowed_category_ids ||
                values.allowed_package_categories ||
                [];
        }

        if ("package_details" in values || "details" in values) {
            order.uiState.package_details = values.package_details || values.details || [];
        }
    };

    const originalPrepareOrderTypeState = service._prepareOrderTypeState.bind(service);
    service._prepareOrderTypeState = function (orderType) {
        const values = originalPrepareOrderTypeState(orderType);
        values.is_package_sale = Boolean(orderType.is_package_sale);
        values.is_package_usage = Boolean(orderType.is_package_use);
        return values;
    };

    service.isPackageSale = function () {
        const order = this.getOrder();
        return Boolean(order?.uiState?.is_package_sale);
    };

    service.isPackageUsage = function () {
        const order = this.getOrder();
        return Boolean(order?.uiState?.is_package_usage);
    };

    service.getCurrentPackageId = function () {
        const order = this.getOrder();
        return order?.uiState?.partner_package_id || false;
    };

    service.getActivePackages = async function (partnerId) {
        if (!partnerId) {
            return [];
        }
        

        return await this.orm.call("partner.package", "get_active_packages_for_pos", [partnerId,this.pos.config.id,]);
    };

    service.getPackageUsageOrderType = async function () {
        const types = await this.orm.searchRead(
            "laundry.order.type",
            [["active", "=", true], ["is_package_use", "=", true]],
            this.getVisibleOrderTypeFields()
        );
        return types.length ? types[0] : false;
    };

    service.selectPackage = async function (pkg, customer = null) {
        const orderType = await this.getPackageUsageOrderType();
        if (!orderType) {
            this.dialog.add(AlertDialog, {
                title: _t("Package Usage Order Type Missing"),
                body: _t("Please configure one active order type with Package Usage enabled."),
            });
            return;
        }

        let order = this.getOrder();

        // Starting from an active package should never overwrite an existing
        // laundry order already opened in the POS. Reuse only an empty unsaved
        // frontend order; otherwise create a fresh POS cart.
        const hasExistingLaundryOrder = Boolean(order?.uiState?.laundry_order_id);
        console.log("hasExistingLaundryOrder:", hasExistingLaundryOrder);
        const hasLines = (order?.lines || order?.orderlines || []).length > 0;

        if (!order || hasExistingLaundryOrder || hasLines) {
            order = await this.createFreshOrder(customer);
        }
        console.log("Final order:", order);

        if (!order) {
            return;
        }

        if (customer) {
            order.setPartner?.(customer);
            order.set_partner?.(customer);
        }

        const allowedProducts = getAllowedPackageProducts(pkg);
        const allowedCategories = getAllowedPackageCategories(pkg);

        this._setLaundryOrderState(order, {
            laundry_order_type_id: orderType.id,
            laundry_order_type_name: orderType.name || _t("Package Usage"),
            laundry_order_type_prefix: orderType.prefix || "",
            laundry_allowed_pos_category_ids: allowedCategories.length
            ? allowedCategories
            : this._normalizeCategoryIds(orderType.pos_category_ids || []),
            is_package_sale: false,
            is_package_usage: true,
            partner_package_id: pkg.id,
            package_rule_id: getPackageRuleId(pkg),
            package_rule_name: getPackageRuleName(pkg),
            allowed_package_products: allowedProducts,
            package_details: normalizePackageDetails(pkg),
        });

        this.pos.selected_laundry_order_type = orderType;
        this.pos.selected_partner_package = pkg;
        this.pos.navigate("ProductScreen", { orderUuid: order.uuid });
    };

    const originalValidateLaundryOrderData = service._validateLaundryOrderData.bind(service);
    service._validateLaundryOrderData = function (order, partner, lines) {
        originalValidateLaundryOrderData(order, partner, lines);
        if (order.uiState?.is_package_usage && !order.uiState?.partner_package_id) {
            throw new Error(_t("Please select an active customer package."));
        }
    };

    const originalExtendLaundryOrderData = service._extendLaundryOrderData.bind(service);
    service._extendLaundryOrderData = function (data, order) {
        data = originalExtendLaundryOrderData(data, order);
        data.package_rule_id = order.uiState?.package_rule_id || false;
        data.partner_package_id = order.uiState?.partner_package_id || false;
        data.is_package_sale = Boolean(order.uiState?.is_package_sale);
        data.is_package_usage = Boolean(order.uiState?.is_package_usage);
        return data;
    };

    const originalPrepareSavedStateValues = service._prepareSavedStateValues.bind(service);
    service._prepareSavedStateValues = function (result, order) {
        const values = originalPrepareSavedStateValues(result, order);
        values.is_package_sale = order.uiState.is_package_sale;
        values.is_package_usage = order.uiState.is_package_usage;
        values.partner_package_id = result.partner_package_id || order.uiState.partner_package_id;
        values.package_rule_id = order.uiState.package_rule_id;
        values.package_rule_name = order.uiState.package_rule_name;
        values.allowed_package_products = order.uiState.allowed_package_products || [];
        values.laundry_allowed_pos_category_ids =
        order.uiState.laundry_allowed_pos_category_ids || [];
        values.package_details = order.uiState.package_details || [];
        return values;
    };

    const originalPrepareOpenOrderStateValues = service._prepareOpenOrderStateValues.bind(service);
    service._prepareOpenOrderStateValues = function (data) {
        const values = originalPrepareOpenOrderStateValues(data);
        values.is_package_sale = Boolean(data.is_package_sale);
        values.is_package_usage = Boolean(data.is_package || data.is_package_usage);
        values.partner_package_id = data.partner_package_id || false;
        values.package_rule_id = data.package_rule_id || false;
        values.package_rule_name = data.package_rule_name || "";
        values.allowed_package_products = data.allowed_package_products || [];
        values.laundry_allowed_pos_category_ids =
            data.laundry_allowed_pos_category_ids ||
            data.allowed_category_ids ||
            data.allowed_package_categories ||
            [];
        values.package_details = data.package_details || [];
        return values;
    };

    return service;
};
