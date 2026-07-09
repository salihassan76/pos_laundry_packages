/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { PosHomeScreen } from "@pos_laundry/js/pos_homescreen";

patch(PosHomeScreen.prototype, {
    async loadHomeExtensions() {
        if (super.loadHomeExtensions) {
            await super.loadHomeExtensions(...arguments);
        }
        this.state.activePackages = await this.laundry.getActivePackages(this.state.customer?.id);
    },

    async selectPackage(pkg) {
        console.log("selectPackage called with pkg:", pkg);
        await this.laundry.selectPackage(pkg, this.state.customer);
    },
});
