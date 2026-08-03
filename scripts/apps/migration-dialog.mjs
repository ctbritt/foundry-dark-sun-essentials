/**
 * Confirmation and reporting for the currency migration.
 *
 * DialogV2, available in both v13 and v14. The dialog always shows a scan
 * before it offers to write anything: a GM should be able to see that the
 * migration touches 14 actors and 230 items before they agree to it.
 */

import { MODULE_ID, SETTINGS } from "../core/constants.mjs";
import { applyMigration, scanWorld, summarise } from "../migration.mjs";
import { log } from "../compat.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * Scan the world, show the GM what will change, and migrate if they agree.
 *
 * @param {object} [options]
 * @param {boolean} [options.removalPending]  True when this was triggered by
 *   enabling the removal setting, which changes the copy and the stakes:
 *   declining reverts the setting rather than merely cancelling.
 * @returns {Promise<boolean>}  Whether the migration ran.
 */
export async function openMigrationDialog({ removalPending = false } = {}) {
  const plan = scanWorld();
  const summary = summarise(plan);

  if ( summary.empty ) {
    ui.notifications?.info(game.i18n.localize(`${MODULE_ID}.notify.nothingToConvert`));
    return false;
  }

  const confirmed = await DialogV2.confirm({
    window: { title: `${MODULE_ID}.migration.title`, icon: "fa-solid fa-coins" },
    position: { width: 520 },
    content: buildContent(summary, removalPending),
    yes: {
      icon: "fa-solid fa-right-left",
      label: `${MODULE_ID}.migration.confirm`,
      default: false
    },
    no: {
      icon: "fa-solid fa-xmark",
      label: `${MODULE_ID}.migration.cancel`,
      default: true
    },
    rejectClose: false,
    modal: true
  });

  if ( !confirmed ) {
    log("info", "Migration declined.");
    return false;
  }

  const result = await applyMigration(plan);
  await reportResult(result);
  return true;
}

/* -------------------------------------------- */

/**
 * Called when the GM enables legacy removal. Offers the migration first, and
 * reverts the setting if they decline — leaving it on would silently orphan
 * every balance still held in standard coin.
 * @returns {Promise<void>}
 */
export async function confirmLegacyRemoval() {
  const migrated = await openMigrationDialog({ removalPending: true });
  if ( migrated ) return;

  const keep = await DialogV2.confirm({
    window: { title: `${MODULE_ID}.migration.title`, icon: "fa-solid fa-triangle-exclamation" },
    content: `<p>${game.i18n.localize(`${MODULE_ID}.migration.keepAnyway`)}</p>`,
    yes: { label: `${MODULE_ID}.migration.removeAnyway`, default: false },
    no: { label: `${MODULE_ID}.migration.revert`, default: true },
    rejectClose: false,
    modal: true
  });

  if ( !keep ) {
    await game.settings.set(MODULE_ID, SETTINGS.removeLegacyCurrency, false);
    ui.notifications?.info(game.i18n.localize(`${MODULE_ID}.notify.removalReverted`));
  }
}

/* -------------------------------------------- */

/**
 * @param {ReturnType<import("../migration.mjs").summarise>} summary
 * @param {boolean} removalPending
 * @returns {string}
 */
function buildContent(summary, removalPending) {
  const t = (key, data) => game.i18n.format(`${MODULE_ID}.migration.${key}`, data ?? {});
  const parts = [`<p>${t(removalPending ? "introRemoval" : "intro")}</p>`];

  parts.push(`<ul class="dark-sun-migration-summary">
    <li>${t("countActors", { count: summary.actors })}</li>
    <li>${t("countItems", { count: summary.items })}</li>
    <li>${t("countTokens", { count: summary.tokens })}</li>
  </ul>`);

  parts.push(`<p class="notes">${t("rates")}</p>`);

  if ( summary.compendiums ) {
    parts.push(`<p class="notes">${t("compendiums", { count: summary.compendiums })}</p>`);
  }
  if ( summary.skippedCoins.length ) {
    parts.push(`<p class="notes warning">${t("skippedCoins", {
      coins: summary.skippedCoins.join(", ")
    })}</p>`);
  }
  if ( summary.remainder > 0 ) {
    parts.push(`<p class="notes warning">${t("remainder", {
      value: summary.remainder.toFixed(2)
    })}</p>`);
  }
  if ( removalPending ) {
    parts.push(`<p class="notification warning">${t("warning")}</p>`);
  }

  return parts.join("");
}

/* -------------------------------------------- */

/**
 * @param {{actors: number, items: number, tokens: number, errors: string[]}} result
 */
async function reportResult(result) {
  if ( !result.errors.length ) {
    ui.notifications?.info(game.i18n.format(`${MODULE_ID}.notify.migrationDone`, result));
    return;
  }

  ui.notifications?.error(game.i18n.format(`${MODULE_ID}.notify.migrationPartial`, {
    count: result.errors.length
  }), { permanent: true });

  await DialogV2.prompt({
    window: { title: `${MODULE_ID}.migration.errorsTitle`, icon: "fa-solid fa-triangle-exclamation" },
    content: `<p>${game.i18n.localize(`${MODULE_ID}.migration.errorsIntro`)}</p>
      <ul>${result.errors.map(e => `<li>${foundry.utils.escapeHTML?.(e) ?? e}</li>`).join("")}</ul>`,
    ok: { label: `${MODULE_ID}.migration.close` },
    rejectClose: false
  });
}
