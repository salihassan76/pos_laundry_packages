/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { laundryService } from "@pos_laundry/app/services/laundry_service";
import { laundryLog, traceLaundryState } from "@pos_laundry/app/utils/laundry_visibility";

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

        if ("laundry_start_category_id" in values) {
            order.uiState.laundry_start_category_id =
                values.laundry_start_category_id || false;
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
        const values =
            originalPrepareOrderTypeState(orderType);

        const isPackageUsage =
            Boolean(orderType?.is_package_use);

        const isPackageSale =
            Boolean(orderType?.is_package_sale);

        values.is_package_sale =
            isPackageSale;

        values.is_package_usage =
            isPackageUsage;

        values.laundry_allow_pay =
            isPackageUsage
                ? false
                : Boolean(orderType?.allow_pay);

        values.allow_pay =
            values.laundry_allow_pay;

        values.laundry_allow_refund =
            isPackageUsage
                ? false
                : Boolean(orderType?.allow_refund);

        values.allow_refund =
            values.laundry_allow_refund;

        console.log(
            "[Laundry Packages] Prepared order type state",
            {
                orderTypeId:
                    orderType?.id || false,
                orderTypeName:
                    orderType?.name || "",
                isPackageSale,
                isPackageUsage,
                allowPay:
                    values.laundry_allow_pay,
                allowRefund:
                    values.laundry_allow_refund,
            }
        );

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
        laundryLog("PackageSelect", "current order decision", {
            currentOrderUuid: order?.uuid || false,
            hasExistingLaundryOrder,
        });
        const hasLines = (order?.lines || order?.orderlines || []).length > 0;

        if (!order || hasExistingLaundryOrder || hasLines) {
            order = await this.createFreshOrder(customer);
        }
        laundryLog("PackageSelect", "target order selected", {
            orderUuid: order?.uuid || false,
        });

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

            laundry_start_category_id: allowedCategories.length
            ? allowedCategories[0]
            : this._normalizeCategoryIds(orderType.pos_category_ids || [])[0] || false,
            laundry_allow_pay : false,
            laundry_allow_refund : false,
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
        traceLaundryState("PackageSelect:BeforeProductScreen", this.pos, {
            packageId: pkg.id,
            packageRuleId: getPackageRuleId(pkg),
            allowedProducts,
            allowedCategories,
        });
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
        values.laundry_start_category_id =order.uiState.laundry_start_category_id || false;
        values.laundry_allow_pay =
        values.is_package_usage
            ? false
            : result.allow_pay !== undefined
                ? result.allow_pay !== false
                : order.uiState.laundry_allow_pay !== false;

        values.laundry_allow_refund =
            values.is_package_usage
                ? false
                : result.allow_refund !== undefined
                    ? result.allow_refund !== false
                    : order.uiState.laundry_allow_refund !== false;
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
        values.laundry_start_category_id =
        data.laundry_start_category_id ||
        data.laundry_allowed_pos_category_ids?.[0] ||
        data.allowed_category_ids?.[0] ||
        false;
        values.laundry_allow_pay = values.is_package_usage ? false : data.allow_pay !== false;
        values.laundry_allow_refund = values.is_package_usage ? false : data.allow_refund !== false;
        

        return values;
    };

    const originalGetActionPolicy =service.getActionPolicy.bind(service);

    service.getActionPolicy = function (order = this.getOrder()) {
        const policy =
            originalGetActionPolicy(order);

        if (!order?.uiState?.is_package_usage) {
            return policy;
        }

        return {
            ...policy,

            // Package usage is already settled
            // against the customer package.
            canPayment: false,

            // Cancelling restores package quantity.
            // Package usage is never financially refunded.
            canRefund: false,
        };
    };

    return service;
};
