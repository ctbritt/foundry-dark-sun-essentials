/**
 * Confirmation and reporting for the currency migration.
 *
 * DialogV2, available in both v13 and v14. The dialog always shows a scan
 * before it offers to write anything: a GM should be able to see that the
 * migration touches 14 actors and 230 items before they agree to it.
 */

import { MODULE_ID, SETTINGS } from "../core/constants.mjs";
import { applyMigration, scanWorld, summarise } from "../migration.mjs";
import { applyPackMigration, packCheckboxName, scanPacks } from "../pack-migration.mjs";
import { log } from "../compat.mjs";

const { DialogV2 } = foundry.applications.api;

/** v13 namespaced it; the bare global is deprecated but still present. */
const FormData = foundry.applications.ux?.FormDataExtended ?? globalThis.FormDataExtended;

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
  // The macro is gated by pack ownership, but this is also the module's
  // public API — a player calling it from the console otherwise gets a
  // dialog enumerating pack contents and then a wall of permission errors.
  if ( !game.user?.isGM ) {
    ui.notifications?.error(game.i18n.localize(`${MODULE_ID}.notify.gmOnly`));
    return false;
  }

  const plan = scanWorld();
  const summary = summarise(plan);
  const { candidates, locked } = await scanPacks();

  if ( summary.empty && !candidates.length ) {
    ui.notifications?.info(game.i18n.localize(`${MODULE_ID}.notify.nothingToConvert`));
    return false;
  }

  const selection = await DialogV2.wait({
    window: { title: `${MODULE_ID}.migration.title`, icon: "fa-solid fa-coins" },
    position: { width: 520 },
    content: buildContent(summary, candidates, locked, removalPending),
    buttons: [
      {
        action: "convert",
        icon: "fa-solid fa-right-left",
        label: `${MODULE_ID}.migration.confirm`,
        callback: (event, button) => readSelection(button.form, candidates)
      },
      {
        action: "cancel",
        icon: "fa-solid fa-xmark",
        label: `${MODULE_ID}.migration.cancel`,
        default: true
      }
    ],
    rejectClose: false,
    modal: true
  });

  // `cancel`, the close button, and Escape all land here.
  if ( !Array.isArray(selection) ) {
    log("info", "Migration declined.");
    return false;
  }

  const result = await applyMigration(plan);
  const packResult = selection.length
    ? await applyPackMigration(selection)
    : { packs: 0, documents: 0, errors: [] };

  result.errors.push(...packResult.errors);
  await reportResult(result, packResult);
  return true;
}

/* -------------------------------------------- */

/**
 * Read the ticked packs back out of the form.
 * @param {HTMLFormElement} form
 * @param {import("../pack-migration.mjs").PackCandidate[]} candidates
 * @returns {string[]}  Collection ids, in candidate order.
 */
function readSelection(form, candidates) {
  const data = new FormData(form).object;
  return candidates
    .filter((_candidate, index) => data[packCheckboxName(index)] === true)
    .map(candidate => candidate.collection);
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
 * @param {import("../pack-migration.mjs").PackCandidate[]} candidates
 * @param {number} locked
 * @param {boolean} removalPending
 * @returns {string}
 */
function buildContent(summary, candidates, locked, removalPending) {
  const t = (key, data) => game.i18n.format(`${MODULE_ID}.migration.${key}`, data ?? {});
  const parts = [`<p>${t(removalPending ? "introRemoval" : "intro")}</p>`];

  parts.push(`<ul class="dark-sun-migration-summary">
    <li>${t("countActors", { count: summary.actors })}</li>
    <li>${t("countItems", { count: summary.items })}</li>
    <li>${t("countTokens", { count: summary.tokens })}</li>
  </ul>`);

  parts.push(`<p class="notes">${t("rates")}</p>`);

  if ( candidates.length ) {
    const rows = candidates.map((candidate, index) => `<label class="dark-sun-pack-row">
      <input type="checkbox" name="${packCheckboxName(index)}">
      <span>${t("packRow", {
        label: foundry.utils.escapeHTML?.(candidate.label) ?? candidate.label,
        count: candidate.count
      })}</span>
    </label>`).join("");
    parts.push(`<p class="notes">${t("packsIntro")}</p>
      <div class="dark-sun-pack-list">${rows}</div>`);
  }

  if ( locked ) parts.push(`<p class="notes">${t("packsLocked", { count: locked })}</p>`);

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

  // Shown whenever packs are on offer, not only on the removal path: pack
  // writes cannot be undone from inside Foundry either.
  if ( removalPending || candidates.length ) {
    parts.push(`<p class="notification warning">${t("warning")}</p>`);
  }

  return parts.join("");
}

/* -------------------------------------------- */

/**
 * Report what happened, always — an irreversible operation must never leave
 * the GM knowing only that something failed, with no idea what did convert.
 * The success notifications are shown unconditionally, then the error dialog
 * on top of them if there is one.
 *
 * @param {{actors: number, items: number, tokens: number, errors: string[]}} result
 * @param {{packs: number, documents: number}} packResult
 */
async function reportResult(result, packResult) {
  ui.notifications?.info(game.i18n.format(`${MODULE_ID}.notify.migrationDone`, result));
  if ( packResult.packs ) {
    ui.notifications?.info(game.i18n.format(`${MODULE_ID}.notify.packsDone`, packResult));
  }

  if ( !result.errors.length ) return;

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
