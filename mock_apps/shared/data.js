/* Fictional data shared by the mock apps. Every person, company and number here is made up. */
window.HG_DATA = (function () {
  const GLOVES = "Nitrile Exam Gloves, Box of 100, Size";
  const invoices = {
    "INV-2207": {
      vendor: "Acme Supplies", po: "PO-881", date: "2026-10-28", due: "2026-11-27",
      lines: [
        { id: "L1", sku: "NG-100-M", desc: GLOVES + " M", qty: 40, price: 8.5 },
        { id: "L2", sku: "NG-100-L", desc: GLOVES + " L", qty: 25, price: 8.5 },
        { id: "L3", sku: "CP-A4-5R", desc: "Copy Paper A4 80gsm, 5-Ream Case", qty: 10, price: 42.0 },
        { id: "L4", sku: "TN-760", desc: "Toner Cartridge TN-760, Black", qty: 6, price: 71.25 },
      ],
    },
    "INV-2193": {
      vendor: "Brightline Office Co.", po: "PO-874", date: "2026-10-14", due: "2026-11-13",
      lines: [
        { id: "L1", sku: "BL-CH-02", desc: "Ergonomic Task Chair, Grey", qty: 2, price: 189.0 },
        { id: "L2", sku: "BL-DK-14", desc: "Desk Organizer, 5 Compartments", qty: 5, price: 14.99 },
        { id: "L3", sku: "BL-WB-36", desc: "Whiteboard 36x24 in", qty: 1, price: 64.5 },
      ],
    },
    "INV-2214": {
      vendor: "Acme Supplies", po: "PO-890", date: "2026-11-02", due: "2026-12-02",
      lines: [
        { id: "L1", sku: "SN-3X3-Y", desc: "Sticky Notes 3x3, Yellow, 12-Pack", qty: 8, price: 9.75 },
        { id: "L2", sku: "BP-BLK-50", desc: "Ballpoint Pens, Black, Box of 50", qty: 4, price: 12.4 },
      ],
    },
  };
  // PO-881 matches INV-2207 except line L2 (gloves, size L): ordered 20, invoiced 25.
  const pos = {
    "PO-881": {
      vendor: "Acme Supplies", date: "2026-10-20", status: "Received", invoice: "INV-2207",
      lines: [
        { id: "L1", sku: "NG-100-M", desc: GLOVES + " M", qty: 40, price: 8.5 },
        { id: "L2", sku: "NG-100-L", desc: GLOVES + " L", qty: 20, price: 8.5 },
        { id: "L3", sku: "CP-A4-5R", desc: "Copy Paper A4 80gsm, 5-Ream Case", qty: 10, price: 42.0 },
        { id: "L4", sku: "TN-760", desc: "Toner Cartridge TN-760, Black", qty: 6, price: 71.25 },
      ],
    },
    "PO-874": {
      vendor: "Brightline Office Co.", date: "2026-10-06", status: "Received", invoice: "INV-2193",
      lines: invoices["INV-2193"].lines,
    },
    "PO-890": {
      vendor: "Acme Supplies", date: "2026-10-30", status: "Open", invoice: "INV-2214",
      lines: invoices["INV-2214"].lines,
    },
  };
  const TAX = 0.0825;
  function totals(lines) {
    const sub = lines.reduce((s, l) => s + l.qty * l.price, 0);
    const tax = Math.round(sub * TAX * 100) / 100;
    return { sub: sub, tax: tax, total: sub + tax };
  }
  function money(n) { return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function linesTable(lines, idPrefix) {
    const t = totals(lines);
    const rows = lines.map((l, i) =>
      `<tr id="${idPrefix}-${l.id}"><td>${i + 1}</td><td>${l.sku}</td><td>${l.desc}</td>` +
      `<td class="num">${l.qty}</td><td class="num">${money(l.price)}</td>` +
      `<td class="num">${money(l.qty * l.price)}</td></tr>`).join("");
    return `<table><thead><tr><th>#</th><th>SKU</th><th>Description</th><th class="num">Qty</th>` +
      `<th class="num">Unit</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody>` +
      `<tfoot><tr><td colspan="5" class="num">Subtotal</td><td class="num">${money(t.sub)}</td></tr>` +
      `<tr><td colspan="5" class="num">Tax (8.25%)</td><td class="num">${money(t.tax)}</td></tr>` +
      `<tr><th colspan="5" class="num">Total</th><th class="num">${money(t.total)}</th></tr></tfoot></table>`;
  }
  return {
    person: { name: "Dana Whitlock", email: "dana.whitlock@example.com", account: "ACCT-5521-8830" },
    invoices: invoices, pos: pos, totals: totals, money: money, linesTable: linesTable,
  };
})();
