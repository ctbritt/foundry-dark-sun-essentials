/**
 * The module's settings window.
 *
 * ApplicationV2 + HandlebarsApplicationMixin, which is the current framework in
 * both Foundry v13 and v14. The window exists rather than relying on the plain
 * settings list because two of these toggles change stored data, and that
 * deserves more explanation than a one-line hint.
 */

import { MODULE_ID, SETTINGS } from "../core/constants.mjs";
import { log } from "../compat.mjs";
import { openMigrationDialog } from "./migration-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export default class DarkSunSettingsMenu extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "dark-sun-essentials-settings",
    tag: "form",
    classes: ["dark-sun-essentials", "standard-form"],
    window: {
      title: `${MODULE_ID}.menu.name`,
      icon: "fa-solid fa-sun-dust",
      resizable: true
    },
    position: { width: 620, height: "auto" },
    form: {
      handler: DarkSunSettingsMenu.#onSubmit,
      closeOnSubmit: true
    },
    actions: {
      migrate: DarkSunSettingsMenu.#onMigrate
    }
  };

  /** @override */
  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/settings-menu.hbs`,
      scrollable: [""]
    },
    footer: {
      template: "templates/generic/form-footer.hbs"
    }
  };

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const value = key => game.settings.get(MODULE_ID, key);

    context.fields = {
      ceramicCurrency: value(SETTINGS.ceramicCurrency),
      removeLegacyCurrency: value(SETTINGS.removeLegacyCurrency),
      psionicSchool: value(SETTINGS.psionicSchool),
      materialProperties: value(SETTINGS.materialProperties),
      siltVehicles: value(SETTINGS.siltVehicles)
    };
    context.keys = SETTINGS;
    context.moduleId = MODULE_ID;
    context.systemVersion = game.system.version;
    context.buttons = [
      { type: "submit", icon: "fa-solid fa-floppy-disk", label: `${MODULE_ID}.menu.save` }
    ];
    return context;
  }

  /* -------------------------------------------- */
  /*  Interaction                                 */
  /* -------------------------------------------- */

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);

    // The removal warning is only meaningful when both boxes are ticked, so
    // reflect that as the GM clicks rather than making them save to find out.
    const ceramic = this.element.querySelector(`[name="${SETTINGS.ceramicCurrency}"]`);
    const remove = this.element.querySelector(`[name="${SETTINGS.removeLegacyCurrency}"]`);
    const warning = this.element.querySelector("[data-warning='removal']");
    if ( !ceramic || !remove || !warning ) return;

    const sync = () => {
      const dangerous = ceramic.checked && remove.checked;
      warning.classList.toggle("active", dangerous);
      remove.disabled = !ceramic.checked;
      if ( !ceramic.checked ) remove.checked = false;
    };
    ceramic.addEventListener("change", sync);
    remove.addEventListener("change", sync);
    sync();
  }

  /* -------------------------------------------- */

  /**
   * Persist the form. Settings are written only when they actually change, so
   * Foundry's reload prompt appears only when a reload is genuinely needed.
   * @this {DarkSunSettingsMenu}
   */
  static async #onSubmit(event, form, formData) {
    const submitted = foundry.utils.expandObject(formData.object);
    let changed = false;

    for ( const key of Object.values(SETTINGS) ) {
      const next = Boolean(submitted[key]);
      if ( game.settings.get(MODULE_ID, key) === next ) continue;
      await game.settings.set(MODULE_ID, key, next);
      changed = true;
    }

    if ( changed ) log("info", "Settings updated.");
  }

  /* -------------------------------------------- */

  /**
   * Run the currency migration without removing the old coins — for GMs who
   * want their party's purses converted but are not ready to commit.
   * @this {DarkSunSettingsMenu}
   */
  static async #onMigrate(event, target) {
    await openMigrationDialog({ removalPending: false });
  }
}
