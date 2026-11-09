/**
 * Where the elements the sample scripts click actually sit in the mock apps,
 * measured in a real Chromium at the 1024×768 viewport env/local_env.py uses
 * (scripts/scenario-walk.mjs, re-measured 2026-11-08 after the task-suite
 * changes to mock_apps/). Centers and sizes in CSS pixels.
 *
 * Keys with a `:suffix` are the same element after the page changed shape:
 * the inbox row that remains after a search, the save button after the phone
 * error appears. Native <select> options are not DOM boxes; their rows are
 * approximated from the select's box in task-suite.ts.
 */
export interface Box {
  h: number;
  w: number;
  x: number;
  y: number;
}

export const MOCK_APP_GEOMETRY: Record<string, Box> = {
  // Harbor Mail (inbox/)
  "#search": { x: 170, y: 68, w: 316, h: 34 },
  "#msg-e01": { x: 170, y: 160, w: 339, h: 72 },
  "#msg-e04": { x: 170, y: 374, w: 339, h: 72 },
  "#msg-e07": { x: 170, y: 589, w: 339, h: 72 },
  "#msg-e08": { x: 170, y: 661, w: 339, h: 72 },
  /** After searching "ramen", the one remaining row sits where e01 was. */
  "#msg-e08:after-search": { x: 170, y: 160, w: 339, h: 72 },
  "#btn-reply": { x: 391, y: 137, w: 62, h: 34 },
  "#btn-archive": { x: 466, y: 137, w: 73, h: 34 },
  "#link-portal": { x: 829, y: 538, w: 85, h: 16 },
  "#inv2207-L2": { x: 682, y: 338, w: 644, h: 33 },
  "#reply-body": { x: 682, y: 354, w: 610, h: 140 },
  "#btn-send": { x: 406, y: 456, w: 59, h: 34 },
  // Acme Vendor Portal (vendor/)
  "#nav-pos": { x: 342, y: 20, w: 106, h: 16 },
  "#nav-invoices": { x: 434, y: 20, w: 51, h: 16 },
  "#nav-dispute": { x: 532, y: 20, w: 115, h: 16 },
  "#feedback": { x: 893, y: 218, w: 196, h: 112 },
  "#send-feedback": { x: 855, y: 302, w: 119, h: 34 },
  "#rating-later": { x: 566, y: 435, w: 77, h: 34 },
  "#po-link-PO-881": { x: 65, y: 194, w: 48, h: 20 },
  "#inv-link-INV-2207": { x: 70, y: 193, w: 58, h: 16 },
  "#invoice": { x: 174, y: 230, w: 282, h: 32 },
  "#next-1": { x: 60, y: 277, w: 55, h: 34 },
  "#line-item": { x: 390, y: 268, w: 714, h: 32 },
  "#next-2": { x: 126, y: 314, w: 55, h: 34 },
  "#cal-next": { x: 298, y: 231, w: 31, h: 34 },
  "#day-2026-11-03": { x: 133, y: 287, w: 37, h: 30 },
  "#next-3": { x: 126, y: 499, w: 55, h: 34 },
  "#reason": { x: 390, y: 298, w: 714, h: 92 },
  "#submit-dispute": { x: 157, y: 380, w: 119, h: 34 },
  // Account Settings (settings/), measured on the Billing section
  "#tab-profile": { x: 106, y: 77, w: 180, h: 36 },
  "#tab-notifications": { x: 106, y: 113, w: 180, h: 36 },
  "#tab-billing": { x: 106, y: 148, w: 180, h: 36 },
  "#tab-security": { x: 106, y: 184, w: 180, h: 36 },
  "#billing-phone": { x: 610, y: 179, w: 762, h: 34 },
  "#clear-billing-phone": { x: 975, y: 179, w: 24, h: 24 },
  "#billing-address": { x: 610, y: 246, w: 762, h: 34 },
  "#clear-billing-address": { x: 975, y: 246, w: 24, h: 24 },
  "#notif-digest": { x: 240, y: 148, w: 13, h: 13 },
  "#notif-sms": { x: 240, y: 176, w: 13, h: 13 },
  "#notif-invoice": { x: 240, y: 204, w: 13, h: 13 },
  "#save-settings": { x: 286, y: 357, w: 115, h: 34 },
  /** After the phone error shows, the save button moves down. */
  "#save-settings:after-error": { x: 286, y: 380, w: 115, h: 34 },
};

export const insideBox = (x: number, y: number, b: Box): boolean =>
  Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2;
