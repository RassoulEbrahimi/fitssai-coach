import path from "node:path";
import { mkdirSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { e2ePassword, openNutrition, signIn } from "../support/browser";
import { expect, test } from "../support/fixtures";
import {
  bottomNav,
  navigateWithBottomNav,
  openRecordingSheet,
  openReplaceSheet,
  openSheet,
  nextUpdateSlotResponse,
  slotRow,
  undoSlot,
  weekRow,
} from "../support/nutritionUi";
import { E2E_LOCAL_DIR } from "../support/processEnv";

/**
 * NUT-13B §9 — the Nutrition flows at phone widths, as a touch device.
 *
 * At 320, 375 and 390 px: no horizontal page scroll; TARGET, Today, Week and
 * the bottom navigation inside the viewport; the recording and replacement
 * sheets open, their confirmation actions are inside the viewport and are
 * really completed by a tap (Playwright only clicks what receives the
 * pointer); the last week row can be scrolled clear of the bottom navigation.
 * These functional checks are REQUIRED at every width.
 *
 * The label check is REQUIRED too since NUT-12D.2. It fixed the 320 px
 * "Ausgelassen" mode label, which was about 10 px wider than its button and
 * was an expected failure until then. No sheet label, Today row or week row
 * may have text wider than its box, with a long German compound meal name
 * recorded.
 * Screenshots go to e2e/results.local/screenshots.
 */

/** A recorded name with a compound longer than a 320 px slot row's text column. */
const LONG_MEAL_NAME = "Hähnchenbrustfiletstreifenpfanne mit Rosmarinkartoffeln";

/** Text runs that stick out of the element holding them (clipped, or drawn over a neighbour). */
const escapingText = (container: Locator) =>
  container.evaluate((root) => {
    const escaping: { text: string; overflow: number }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? "").trim();
      // The nearest box that lays the text out: an inline span always encloses its own text.
      let holder = node.parentElement;
      while (holder && getComputedStyle(holder).display === "inline") holder = holder.parentElement;
      if (!text || !holder) continue;
      const box = holder.getBoundingClientRect();
      // A 1 px box is screen-reader-only text (the sheet's "Close"), clipped on purpose.
      if (box.width <= 1) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const overflow = Math.max(0, ...Array.from(range.getClientRects(), (rect) => Math.max(rect.right - box.right, box.left - rect.left)));
      // Up to 2 px is sub-pixel layout and font rasterization, as for the sheet labels.
      if (overflow > 2) escaping.push({ text, overflow: Math.round(overflow) });
    }
    return escaping;
  });

const SCREENSHOTS = path.join(E2E_LOCAL_DIR, "screenshots");
mkdirSync(SCREENSHOTS, { recursive: true });

const WIDTHS = [320, 375, 390] as const;

const expectNoHorizontalScroll = async (page: Page, what: string) => {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow, `horizontal overflow (${what})`).toEqual({ document: 0, body: 0 });
};

/** Fully inside the viewport's width, and not wider than its own box (no clipped content). */
const expectInsideWidth = async (locator: Locator, width: number, what: string) => {
  const box = await locator.boundingBox();
  expect(box, `${what} is laid out`).not.toBeNull();
  expect(box!.x, `${what} left edge`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${what} right edge`).toBeLessThanOrEqual(width + 0.5);
  const clipped = await locator.evaluate((element) => element.scrollWidth - element.clientWidth);
  // scrollWidth rounds up while clientWidth rounds down: 1 px is sub-pixel layout, not clipping.
  expect(clipped, `${what} content wider than its box`).toBeLessThanOrEqual(1);
};

/** Wait for a sheet's entry animation to finish, so boxes and screenshots are final. */
const settled = async (sheet: Locator) => {
  await expect(sheet).toHaveAttribute("data-state", "open");
  await sheet.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
};

for (const width of WIDTHS) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test(`Nutrition at ${width} px: TARGET, Today, Week, recording, replacement, undo and navigation are usable`, async ({ page, seed }) => {
      const adult = seed.users.adult;
      const nutrition = adult.nutrition!;
      const today = seed.today;
      const shot = (name: string, fullPage = false) =>
        page.screenshot({ path: path.join(SCREENSHOTS, `nut13b-${width}-${name}.png`), fullPage });

      await signIn(page, adult.email, e2ePassword());
      await openNutrition(page);
      expect(await page.evaluate(() => window.innerWidth)).toBe(width);
      await page.evaluate(() => document.fonts.ready);
      await expectNoHorizontalScroll(page, "Nutrition");
      await shot("nutrition", true);

      // TARGET
      for (const key of ["kcal", "proteinG", "carbsG", "fatG"]) {
        await expectInsideWidth(page.getByTestId(`nutrition-v2-target-${key}`), width, `TARGET ${key}`);
      }
      // TODAY: every slot, its planned meal and both actions.
      for (const slotId of ["breakfast", "lunch", "dinner"] as const) {
        const row = slotRow(page, slotId);
        await expectInsideWidth(row, width, `${slotId} row`);
        await expect(row).toContainText(nutrition.meals[today][slotId]);
        await expectInsideWidth(row.getByRole("button", { name: /erfassen$/ }), width, `${slotId} Erfassen`);
        await expectInsideWidth(page.getByRole("button", { name: new RegExp(`^${slotId === "breakfast" ? "Frühstück" : slotId === "lunch" ? "Mittagessen" : "Abendessen"} ersetzen$`) }), width, `${slotId} Ersetzen`);
      }
      // WEEK: seven rows, none clipped.
      for (const date of nutrition.dates) await expectInsideWidth(weekRow(page, date), width, `week row ${date}`);
      // BOTTOM NAVIGATION: four tabs inside the viewport.
      const nav = bottomNav(page);
      await expect(nav).toBeVisible();
      for (const tab of ["Dashboard", "Trainingsplan", "Ernährungsplan", "Profil"]) {
        await expectInsideWidth(nav.getByRole("button", { name: tab }), width, `nav ${tab}`);
      }
      // The last week row scrolls clear of the bottom navigation.
      const lastRow = weekRow(page, nutrition.dates[nutrition.dates.length - 1]);
      await lastRow.evaluate((element) => element.scrollIntoView({ block: "end" }));
      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        const scroller = document.getElementById("app-scroll");
        if (scroller) scroller.scrollTo(0, scroller.scrollHeight);
      });
      const rowBottom = (await lastRow.boundingBox())!;
      const navTop = (await nav.boundingBox())!;
      expect(rowBottom.y + rowBottom.height, "last week row ends above the bottom navigation").toBeLessThanOrEqual(navTop.y + 1);
      await shot("week-bottom");

      // RECORDING sheet: opens, fits, saves with a tap.
      await slotRow(page, "breakfast").scrollIntoViewIfNeeded();
      const recordSheet = await openRecordingSheet(page, "breakfast");
      await settled(recordSheet);
      await shot("recording-sheet");
      await expectNoHorizontalScroll(page, "recording sheet");
      const save = recordSheet.getByRole("button", { name: "Speichern", exact: true });
      await expectInsideWidth(recordSheet, width, "recording sheet");
      await expectInsideWidth(save, width, "Speichern");
      // Each mode can be chosen with a tap (whether its label fits is the next test's).
      for (const mode of ["Anderes gegessen", "Ausgelassen", "Gegessen"]) {
        const button = recordSheet.getByRole("button", { name: mode, exact: true });
        await button.tap();
        await expect(button).toHaveAttribute("aria-pressed", "true");
      }
      await save.tap();
      await expect(recordSheet).toBeHidden();
      await expect(slotRow(page, "breakfast")).toHaveAttribute("data-recorded", "plannedMeal");

      // REPLACEMENT sheet: choose, confirm with a tap, then undo.
      const replacement = nutrition.meals[nutrition.dates[nutrition.dates.indexOf(today) + 1]].lunch;
      const replaceSheet = await openReplaceSheet(page, "lunch");
      await settled(replaceSheet);
      await expectNoHorizontalScroll(page, "replacement sheet");
      await expectInsideWidth(replaceSheet, width, "replacement sheet");
      const option = replaceSheet.getByRole("radio", { name: new RegExp(`^${replacement} ·`) });
      await option.scrollIntoViewIfNeeded();
      await option.tap();
      await expect(option).toBeChecked();
      const confirm = replaceSheet.getByRole("button", { name: "Ersetzen", exact: true });
      await confirm.scrollIntoViewIfNeeded();
      await expectInsideWidth(confirm, width, "Ersetzen");
      await shot("replacement-sheet");
      const committed = nextUpdateSlotResponse(page, "commit");
      await confirm.tap();
      expect((await committed).status()).toBe(200);
      await expect(replaceSheet).toBeHidden();
      await expect(slotRow(page, "lunch")).toContainText(replacement);
      await shot("replaced", true);
      await undoSlot(page, "lunch");
      await expect(slotRow(page, "lunch")).toContainText(nutrition.meals[today].lunch);
      await expectNoHorizontalScroll(page, "after undo");

      // Profile → Nutrition through the bottom navigation.
      await navigateWithBottomNav(page, "Profil");
      await expectNoHorizontalScroll(page, "Profil");
      await shot("profile");
      await navigateWithBottomNav(page, "Ernährungsplan");
      await expect(page.getByTestId("nutrition-v2-today")).toHaveAttribute("data-view", "today");
      await expect(slotRow(page, "breakfast")).toHaveAttribute("data-recorded", "plannedMeal");
    });

    test(`labels and rows at ${width} px are not clipped`, async ({ page, seed }) => {
      const adult = seed.users.adult;
      await signIn(page, adult.email, e2ePassword());
      await openNutrition(page);
      await page.evaluate(() => document.fonts.ready);
      const labels = (sheet: Locator) =>
        sheet.getByRole("button").evaluateAll((buttons) =>
          buttons
            .filter((button) => (button.textContent ?? "").trim() !== "")
            .map((button) => ({ label: (button.textContent ?? "").trim(), overflow: button.scrollWidth - button.clientWidth }))
        );

      // Every mode pressed in turn: a pressed and an unpressed button are measured for each label.
      const recordSheet = await openRecordingSheet(page, "breakfast");
      await settled(recordSheet);
      const recording: { label: string; overflow: number }[] = [];
      for (const mode of ["Gegessen", "Anderes gegessen", "Ausgelassen"]) {
        await recordSheet.getByRole("button", { name: mode, exact: true }).click();
        recording.push(...(await labels(recordSheet)));
      }
      // A recorded long compound name, shown in its slot row and in the sheet.
      await recordSheet.getByRole("button", { name: "Anderes gegessen", exact: true }).click();
      await recordSheet.getByLabel("Bezeichnung").fill(LONG_MEAL_NAME);
      await recordSheet.getByLabel("Kalorien (kcal)").fill("640");
      await recordSheet.getByRole("button", { name: "Speichern", exact: true }).click();
      await expect(recordSheet).toBeHidden();
      await expect(slotRow(page, "breakfast")).toContainText(LONG_MEAL_NAME);
      await expect(slotRow(page, "breakfast")).toHaveAttribute("data-recorded", "custom");
      expect(await escapingText(page.getByTestId("nutrition-v2-today")), "Today and week text wider than its box").toEqual([]);
      await slotRow(page, "breakfast").getByRole("button", { name: "Frühstück bearbeiten" }).click();
      const editSheet = openSheet(page);
      await settled(editSheet);
      expect(await escapingText(editSheet), "recording sheet text wider than its box").toEqual([]);
      await page.keyboard.press("Escape");
      await expect(editSheet).toBeHidden();

      const replaceSheet = await openReplaceSheet(page, "lunch");
      await settled(replaceSheet);
      const replacing = await labels(replaceSheet);
      const optionOverflow = await replaceSheet.locator("label").evaluateAll((items) =>
        items.map((item) => ({ label: (item.textContent ?? "").trim(), overflow: item.scrollWidth - item.clientWidth }))
      );

      // Up to 2 px is rounding and font rasterization: scrollWidth rounds up, clientWidth down, and
      // headed and headless Chrome raster the same label up to 2 px apart. More is a clipped label.
      const clipped = [...recording, ...replacing, ...optionOverflow].filter((item) => item.overflow > 2);
      expect(clipped, "labels wider than their button").toEqual([]);
      expect(await escapingText(replaceSheet), "replacement sheet text wider than its box").toEqual([]);
    });
  });
}
