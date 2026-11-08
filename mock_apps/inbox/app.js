/* Inbox: 12 fictional emails. Routes: #/ , #/archived , #/m/<id> , #/m/<id>/reply
 * Completion codes: HG.confirm("reply", [id]) on send, HG.confirm("archive", [id]) on archive. */
(function () {
  const D = window.HG_DATA;
  const P = D.person;
  const inv = D.invoices["INV-2207"];

  const EMAILS = [
    { id: "e01", from: "Acme Supplies", addr: "billing@acme-supplies.example", date: "Nov 3",
      subject: "Invoice INV-2207 for PO-881", preview: "Please find invoice INV-2207 for your recent order…",
      body: `<p>Hello ${P.name},</p>
        <p>Please find below invoice <b>INV-2207</b> for purchase order <b>PO-881</b>.</p>
        <p class="muted">Customer account: ${P.account} · Invoice date: ${inv.date} · Due: ${inv.due}</p>
        ${D.linesTable(inv.lines, "inv2207")}
        <p style="margin-top:12px">Questions about a line item? Use the <i>Dispute a line item</i> page in our Vendor Portal.</p>
        <p>Kind regards,<br>Acme Supplies Accounts Receivable</p>` },
    { id: "e02", from: "Northside Family Clinic", addr: "reminders@northside-clinic.example", date: "Nov 3",
      subject: "Appointment reminder: Nov 12, 9:30 AM", preview: "This is a reminder of your upcoming appointment…",
      body: `<p>Dear ${P.name},</p>
        <p>This is a reminder of your appointment with Dr. Ruiz on <b>November 12 at 9:30 AM</b>.</p>
        <p>Chart summary on file: <b>allergy: penicillin</b>. Please tell us about any changes.</p>
        <p>Reply to this email to reschedule.</p><p>Northside Family Clinic</p>` },
    { id: "e03", from: "Priya Natarajan", addr: "priya.n@example.com", date: "Nov 2",
      subject: "Standup notes – Monday", preview: "Quick recap: vendor reconciliation is due Friday…",
      body: `<p>Hi all,</p><p>Quick recap: vendor reconciliation is due Friday. Dana, can you check the Acme invoice against PO-881?</p><p>— Priya</p>` },
    { id: "e04", from: "Acme Supplies", addr: "shipping@acme-supplies.example", date: "Nov 1",
      subject: "Your order has shipped (PO-881)", preview: "4 items shipped via Ground. Tracking…",
      body: `<p>Your order PO-881 shipped on Oct 31 via Ground.</p><p>Tracking: 1Z-FAKE-0000-1234 (fictional).</p>` },
    { id: "e05", from: "Brightline Office Co.", addr: "ar@brightline-office.example", date: "Oct 31",
      subject: "Invoice INV-2193", preview: "Invoice INV-2193 for PO-874 is attached…",
      body: `<p>Hello,</p><p>Invoice <b>INV-2193</b> for PO-874:</p>${D.linesTable(D.invoices["INV-2193"].lines, "inv2193")}` },
    { id: "e06", from: "First Harbor Bank", addr: "alerts@firstharbor.example", date: "Oct 31",
      subject: "Your October statement is ready", preview: "Your statement for account ACCT-5521-8830…",
      body: `<p>Dear ${P.name},</p><p>Your October statement for account <b>${P.account}</b> is now available in online banking.</p><p>First Harbor Bank (fictional)</p>` },
    { id: "e07", from: "HR Team", addr: "hr@example.com", date: "Oct 30",
      subject: "Open enrollment closes Nov 15", preview: "Reminder: benefits open enrollment…",
      body: `<p>Reminder: benefits open enrollment closes November 15. No action needed if you keep your current plan.</p>` },
    { id: "e08", from: "Marcus Lee", addr: "marcus.lee@example.com", date: "Oct 30",
      subject: "Lunch Thursday?", preview: "Want to try the new ramen place…",
      body: `<p>Want to try the new ramen place on Thursday? 12:30?</p><p>— Marcus</p>` },
    { id: "e09", from: "IT Service Desk", addr: "it@example.com", date: "Oct 29",
      subject: "Planned maintenance Saturday", preview: "Email may be unavailable 2–4 AM…",
      body: `<p>Email may be unavailable Saturday between 2 and 4 AM for planned maintenance.</p>` },
    { id: "e10", from: "Purchasing", addr: "purchasing@example.com", date: "Oct 21",
      subject: "Re: PO-881 approved", preview: "PO-881 approved: gloves M x40, gloves L x20…",
      body: `<p>PO-881 approved: gloves M ×40, gloves L ×20, paper ×10 cases, toner ×6.</p>` },
    { id: "e11", from: "Ops Weekly", addr: "newsletter@opsweekly.example", date: "Oct 20",
      subject: "5 ways to speed up invoice matching", preview: "This week: three-way matching tips…",
      body: `<p>This week: three-way matching tips, plus a look at dispute workflows.</p>` },
    { id: "e12", from: "Calendar", addr: "calendar@example.com", date: "Oct 19",
      subject: "Invitation: Q4 vendor review", preview: "Thu Nov 6, 2:00 PM – 3:00 PM…",
      body: `<p>You are invited to <b>Q4 vendor review</b>, Thu Nov 6, 2:00–3:00 PM, Room 4B.</p>` },
  ];

  const state = { read: new Set(["e05", "e07", "e08", "e09", "e10", "e11", "e12"]), archived: new Set() };
  const $ = (s) => document.querySelector(s);

  function renderList(showArchived, selected) {
    const items = EMAILS.filter((m) => state.archived.has(m.id) === showArchived);
    $("#counts").textContent = showArchived
      ? `${items.length} archived`
      : `${items.length} messages · ${items.filter((m) => !state.read.has(m.id)).length} unread`;
    $("#list").innerHTML = items.map((m) =>
      `<li id="msg-${m.id}" class="${state.read.has(m.id) ? "" : "unread"} ${m.id === selected ? "selected" : ""}" data-id="${m.id}">
        <div class="row1"><span class="from">${m.from}</span><span class="date">${m.date}</span></div>
        <div class="subj">${m.subject}</div><div class="prev">${m.preview}</div></li>`).join("");
    document.getElementById("nav-inbox").classList.toggle("active", !showArchived);
    document.getElementById("nav-archived").classList.toggle("active", showArchived);
  }

  function renderReader(m, replying, notice) {
    if (!m) { $("#reader").innerHTML = '<p class="muted">Select a message to read it.</p>'; return; }
    const archived = state.archived.has(m.id);
    $("#reader").innerHTML = `
      <h2 id="subject">${m.subject}</h2>
      <div class="meta">From <b>${m.from}</b> &lt;${m.addr}&gt; · To ${P.name} · ${m.date}</div>
      <div class="actions">
        <button id="btn-reply" class="primary">Reply</button>
        <button id="btn-archive" ${archived ? "disabled" : ""}>${archived ? "Archived" : "Archive"}</button>
      </div>
      ${notice ? `<p class="success" id="notice">${notice}</p>` : ""}
      ${replying ? `<div class="card"><label for="reply-to">To</label>
          <input id="reply-to" type="text" value="${m.addr}" style="width:100%">
          <label for="reply-body">Message</label><textarea id="reply-body"></textarea>
          <div class="actions"><button id="btn-send" class="primary">Send</button><button id="btn-cancel">Cancel</button></div>
          <div class="error" id="reply-error"></div></div>` : ""}
      <div class="body">${m.body}</div>`;
  }

  function route() {
    const h = location.hash || "#/";
    let m;
    if (h === "#/archived") { renderList(true); renderReader(null); return; }
    if ((m = h.match(/^#\/m\/(e\d\d)(\/reply)?$/))) {
      const mail = EMAILS.find((x) => x.id === m[1]);
      if (!mail) { location.hash = "#/"; return; }
      state.read.add(mail.id);
      renderList(state.archived.has(mail.id), mail.id);
      renderReader(mail, !!m[2]);
      return;
    }
    renderList(false);
    renderReader(null);
  }

  document.addEventListener("click", (e) => {
    const li = e.target.closest("#list li");
    if (li) { location.hash = "#/m/" + li.dataset.id; return; }
    const cur = (location.hash.match(/#\/m\/(e\d\d)/) || [])[1];
    const mail = EMAILS.find((x) => x.id === cur);
    if (!mail) return;
    if (e.target.id === "btn-reply") location.hash = `#/m/${mail.id}/reply`;
    if (e.target.id === "btn-cancel") location.hash = `#/m/${mail.id}`;
    if (e.target.id === "btn-archive") {
      state.archived.add(mail.id);
      renderList(false);
      renderReader(mail, false, "Conversation archived.");
      HG.confirm("archive", [mail.id]);
    }
    if (e.target.id === "btn-send") {
      const body = document.getElementById("reply-body").value.trim();
      if (!body) { document.getElementById("reply-error").textContent = "Message can't be empty."; return; }
      history.replaceState(null, "", `#/m/${mail.id}`);
      renderReader(mail, false, "Reply sent.");
      HG.confirm("reply", [mail.id]);
    }
  });

  window.addEventListener("hashchange", route);
  route();
})();
