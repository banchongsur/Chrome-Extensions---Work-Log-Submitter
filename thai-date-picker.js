(function () {
  const MONTHS = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];
  const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  let active = null;

  function pad(n) { return String(n).padStart(2, "0"); }
  function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function fromIso(v) {
    const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2]-1, +m[3], 12);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function thaiDisplay(d) {
    return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()+543}` : "";
  }
  function parseDisplay(v) {
    const m = String(v || "").trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (!m) return null;
    let y = +m[3]; if (y >= 2400) y -= 543;
    const d = new Date(y, +m[2]-1, +m[1], 12);
    if (d.getFullYear() !== y || d.getMonth() !== +m[2]-1 || d.getDate() !== +m[1]) return null;
    return d;
  }

  function closeOthers(except) {
    document.querySelectorAll(".thai-calendar-popup").forEach(p => {
      if (p !== except) p.classList.add("hidden");
    });
  }

  function render(picker, year, month, selected) {
    const popup = picker.popup;
    const first = new Date(year, month, 1);
    const days = new Date(year, month + 1, 0).getDate();
    let html = `<div class="thai-cal-head">
      <button type="button" data-nav="-1">‹</button>
      <strong>${MONTHS[month]} ${year + 543}</strong>
      <button type="button" data-nav="1">›</button>
    </div><div class="thai-cal-week">${WEEKDAYS.map(x => `<span>${x}</span>`).join("")}</div><div class="thai-cal-grid">`;
    for (let i=0; i<first.getDay(); i++) html += `<span class="thai-cal-empty"></span>`;
    for (let day=1; day<=days; day++) {
      const d = new Date(year, month, day, 12);
      const selectedCls = selected && iso(selected) === iso(d) ? " selected" : "";
      const todayCls = iso(new Date()) === iso(d) ? " today" : "";
      html += `<button type="button" class="thai-cal-day${selectedCls}${todayCls}" data-day="${day}">${day}</button>`;
    }
    html += `</div>`;
    popup.innerHTML = html;
    popup.querySelectorAll("[data-nav]").forEach(btn => btn.onclick = () => {
      let m = month + Number(btn.dataset.nav), y = year;
      if (m < 0) { m = 11; y--; }
      if (m > 11) { m = 0; y++; }
      render(picker, y, m, fromIso(picker.hidden.value));
    });
    popup.querySelectorAll("[data-day]").forEach(btn => btn.onclick = () => {
      const d = new Date(year, month, Number(btn.dataset.day), 12);
      picker.hidden.value = iso(d);
      picker.display.value = thaiDisplay(d);
      popup.classList.add("hidden");
      picker.display.dispatchEvent(new Event("change", { bubbles: true }));
      picker.display.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function create(el) {
    if (!el || el.__thaiDatePicker) return;
    const key = el.dataset.thaiDate;
    const hidden = el.querySelector(`#${key}`);
    const display = el.querySelector(`#${key}Display`);
    const popup = el.querySelector(".thai-calendar-popup");
    const button = el.querySelector(".thai-calendar-btn");
    if (!hidden || !display || !popup) return;
    const picker = { el, hidden, display, popup, view: new Date() };
    el.__thaiDatePicker = picker;

    function open() {
      closeOthers(popup);
      let selected = fromIso(hidden.value) || parseDisplay(display.value) || new Date();
      picker.view = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
      render(picker, picker.view.getFullYear(), picker.view.getMonth(), selected);
      popup.classList.remove("hidden");
      active = picker;
    }
    button?.addEventListener("click", e => { e.preventDefault(); open(); });
    display.addEventListener("focus", open);
    display.addEventListener("input", () => {
      const d = parseDisplay(display.value);
      if (d) hidden.value = iso(d);
    });
    display.addEventListener("blur", () => {
      const d = parseDisplay(display.value) || fromIso(hidden.value);
      if (d) { hidden.value = iso(d); display.value = thaiDisplay(d); }
    });
  }

  window.createThaiDatePicker = create;
  window.initThaiDatePickers = function () {
    document.querySelectorAll(".thai-date-field").forEach(create);
  };
  window.setThaiDateValue = function (key, date) {
    const el = document.querySelector(`[data-thai-date="${key}"]`);
    if (!el) return;
    const hidden = el.querySelector(`#${key}`);
    const display = el.querySelector(`#${key}Display`);
    if (!hidden || !display || !date) return;
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    hidden.value = iso(d);
    display.value = thaiDisplay(d);
  };

  document.addEventListener("click", e => {
    if (active && !active.el.contains(e.target)) {
      active.popup.classList.add("hidden");
      active = null;
    }
  });
})();
