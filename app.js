// 한국천문연구원 자료를 바탕으로 한 한국 음력 변환 라이브러리(@fullstackfamily/manseryeok 1.0.8, MIT)입니다.
// 휴대폰에서 인터넷 없이도 동작하도록 vendor 폴더에 함께 넣어 두었습니다.
let getMonthlyIndex;
let lunarLibraryError = "";
try {
  ({ getMonthlyIndex } = await import("./vendor/manseryeok.mjs"));
} catch (error) {
  lunarLibraryError = error instanceof Error ? error.message : String(error);
}

const STORAGE_KEY = "family-birthday-data-v1";
const SETTINGS_KEY = "family-birthday-settings-v1";
const GROUPS = ["우리가족", "외가", "친가"];
const EXAMPLE_FAMILIES = [
  { id: "sample-mom", name: "김엄마", relationship: "엄마", group: "우리가족", calendarType: "lunar", lunarMonth: 3, lunarDay: 12, isLeapMonth: false, memo: "" },
  { id: "sample-dad", name: "김아빠", relationship: "아빠", group: "우리가족", calendarType: "solar", solarMonth: 8, solarDay: 20, memo: "" },
  { id: "sample-aunt", name: "이모", relationship: "이모", group: "외가", calendarType: "lunar", lunarMonth: 10, lunarDay: 5, isLeapMonth: false, memo: "" }
];
const DEFAULT_SETTINGS = { alerts: { "3": true, "1": true, "0": true } };
const ALERT_OFFSETS = [3, 1, 0];
const CALENDAR_EXPORT_YEARS = 10;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let families = [];
let settings = structuredClone(DEFAULT_SETTINGS);
let activeGroup = "전체";
let editingId = null;
let calendarDate = new Date();
let toastTimer;
let installPrompt = null;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function showNotice(message, isError = false, addButton = false) {
  const area = $("#notice-area");
  area.replaceChildren();
  const banner = document.createElement("div");
  banner.className = `notice-banner${isError ? " error" : ""}`;
  banner.textContent = message;
  if (addButton) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "알림 설정 열기";
    button.addEventListener("click", () => navigate("settings"));
    banner.append(" ", button);
  }
  area.append(banner);
}

function clearNotice() {
  $("#notice-area").replaceChildren();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function todayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
}

function dateOnly(year, month, day) {
  return new Date(year, month - 1, day, 12);
}

function formatDate(date, includeWeekday = false) {
  const options = includeWeekday
    ? { year: "numeric", month: "long", day: "numeric", weekday: "short" }
    : { year: "numeric", month: "long", day: "numeric" };
  return new Intl.DateTimeFormat("ko-KR", options).format(date);
}

function formatShortDate(date) {
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function dayDifference(later, earlier = todayDate()) {
  return Math.round((dateOnly(later.getFullYear(), later.getMonth() + 1, later.getDate())
    - dateOnly(earlier.getFullYear(), earlier.getMonth() + 1, earlier.getDate())) / 86400000);
}

function addDays(date, days) {
  return dateOnly(date.getFullYear(), date.getMonth() + 1, date.getDate() + days);
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `family-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function persistFamilies() {
  // 저장 실패 때 화면의 가족 목록도 이전 상태로 되돌릴 수 있도록 성공 여부를 돌려줍니다.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(families));
    return true;
  } catch (error) {
    showNotice(`가족 정보를 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요. (${error.message})`, true);
    return false;
  }
}

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    showNotice(`알림 설정을 저장하지 못했습니다. (${error.message})`, true);
  }
}

function isValidFamily(item) {
  if (!item || typeof item !== "object") return false;
  if (typeof item.id !== "string" || typeof item.name !== "string" || !item.name.trim()) return false;
  if (typeof item.relationship !== "string" || !item.relationship.trim() || !GROUPS.includes(item.group)) return false;
  if (!["solar", "lunar"].includes(item.calendarType) || typeof item.memo !== "string") return false;
  if (item.calendarType === "solar") {
    if (!Number.isInteger(item.solarMonth) || item.solarMonth < 1 || item.solarMonth > 12
      || !Number.isInteger(item.solarDay) || item.solarDay < 1 || item.solarDay > 31) return false;
    const date = new Date(2000, item.solarMonth - 1, item.solarDay);
    return date.getMonth() + 1 === item.solarMonth && date.getDate() === item.solarDay;
  }
  return Number.isInteger(item.lunarMonth) && item.lunarMonth >= 1 && item.lunarMonth <= 12
    && Number.isInteger(item.lunarDay) && item.lunarDay >= 1 && item.lunarDay <= 30
    && typeof item.isLeapMonth === "boolean";
}

function loadData() {
  // 저장 내용이 깨져 있어도 임의로 덮어쓰지 않고, 백업 복원을 안내합니다.
  try {
    const savedFamilies = localStorage.getItem(STORAGE_KEY);
    families = savedFamilies === null ? EXAMPLE_FAMILIES.map((family) => ({ ...family })) : JSON.parse(savedFamilies);
    if (!Array.isArray(families) || !families.every(isValidFamily)) {
      throw new Error("가족 정보 형식이 올바르지 않습니다. 백업 파일을 확인하거나 데이터를 복원해 주세요.");
    }
    if (savedFamilies === null) persistFamilies();
  } catch (error) {
    families = [];
    showNotice(`저장된 가족 정보를 읽지 못했습니다. 가족 정보가 초기화되지는 않았습니다. 백업 파일을 불러와 주세요. (${error.message})`, true);
  }

  try {
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings !== null) {
      const parsed = JSON.parse(savedSettings);
      if (parsed && parsed.alerts) {
        settings = {
          alerts: {
            "3": parsed.alerts["3"] !== false,
            "1": parsed.alerts["1"] !== false,
            "0": parsed.alerts["0"] !== false
          }
        };
      }
    }
  } catch (error) {
    showNotice(`알림 설정을 읽지 못했습니다. 브라우저 저장 공간을 확인해 주세요. (${error.message})`, true);
  }
}

// 라이브러리의 lunarToSolar는 음력 연도와 같은 양력 연도 안에서만 찾기 때문에
// 다음 해 1~2월로 넘어가는 음력 11~12월 날짜를 찾지 못합니다. 그래서 양력 다음 해까지 직접 찾습니다.
function findSolarDate(lunarYear, lunarMonth, lunarDay, isLeapMonth) {
  for (const solarYear of [lunarYear, lunarYear + 1]) {
    for (let solarMonth = 1; solarMonth <= 12; solarMonth += 1) {
      const entry = getMonthlyIndex(solarYear, solarMonth)?.entries.find(({ lunar }) => lunar.year === lunarYear
        && lunar.month === lunarMonth && lunar.day === lunarDay && lunar.isLeap === isLeapMonth);
      if (entry) return dateOnly(entry.solar.year, entry.solar.month, entry.solar.day);
    }
  }
  return null;
}

function convertLunarDate(year, month, day, isLeapMonth) {
  if (!getMonthlyIndex) throw new Error("음력 변환 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 페이지를 새로고침해 주세요.");
  if (year < 1900 || year > 2050) throw new Error("음력 변환은 1900년부터 2050년까지만 지원합니다.");

  // 윤달이 없는 해에는 같은 달의 평달을 사용하고, 음력 30일이 없으면 29일로 계산합니다.
  const leapOptions = isLeapMonth ? [true, false] : [false];
  const dayOptions = day === 30 ? [30, 29] : [day];
  for (const leap of leapOptions) {
    for (const lunarDay of dayOptions) {
      const date = findSolarDate(year, month, lunarDay, leap);
      if (date) return date;
    }
  }
  throw new Error(`음력 ${year}년 ${month}월 ${day}일을 변환하지 못했습니다.`);
}

function solarBirthdayInYear(family, year) {
  let day = family.solarDay;
  if (family.solarMonth === 2 && day === 29 && !isLeapYear(year)) day = 28;
  return dateOnly(year, family.solarMonth, day);
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function birthdayInCalendarYear(family, year) {
  if (family.calendarType === "solar") {
    const date = solarBirthdayInYear(family, year);
    return date.getFullYear() === year ? [date] : [];
  }
  if (!getMonthlyIndex) return [];
  const dates = [];
  // 음력 연도와 양력 연도가 달라지는 1~2월을 위해 인접한 음력 연도도 확인합니다.
  for (const lunarYear of [year - 1, year, year + 1]) {
    try {
      const date = convertLunarDate(lunarYear, family.lunarMonth, family.lunarDay, family.isLeapMonth);
      if (date.getFullYear() === year && !dates.some((existing) => existing.getTime() === date.getTime())) dates.push(date);
    } catch (error) {
      if (error.message.includes("라이브러리") || error.message.includes("1900년부터")) throw error;
    }
  }
  return dates;
}

function nextBirthday(family, from = todayDate()) {
  if (family.calendarType === "solar") {
    const thisYear = solarBirthdayInYear(family, from.getFullYear());
    return thisYear >= from ? thisYear : solarBirthdayInYear(family, from.getFullYear() + 1);
  }
  if (!getMonthlyIndex) return null;
  const candidates = [];
  for (let lunarYear = from.getFullYear() - 1; lunarYear <= from.getFullYear() + 2; lunarYear += 1) {
    try {
      const date = convertLunarDate(lunarYear, family.lunarMonth, family.lunarDay, family.isLeapMonth);
      if (date >= from) candidates.push(date);
    } catch (error) {
      if (error.message.includes("라이브러리") || error.message.includes("1900년부터")) throw error;
    }
  }
  return candidates.sort((a, b) => a - b)[0] ?? null;
}

function birthdayDescription(family) {
  if (family.calendarType === "solar") return `양력 ${family.solarMonth}월 ${family.solarDay}일`;
  return `음력 ${family.isLeapMonth ? "윤" : ""}${family.lunarMonth}월 ${family.lunarDay}일`;
}

function relationName(family) {
  return `${family.name} (${family.relationship})`;
}

function getUpcomingFamilies() {
  return families.map((family) => ({ family, date: nextBirthday(family) }))
    .filter((item) => item.date)
    .sort((a, b) => a.date - b.date || a.family.name.localeCompare(b.family.name, "ko"));
}

function renderHome() {
  const today = todayDate();
  $("#today-label").textContent = formatDate(today, true);
  const upcoming = getUpcomingFamilies();
  const thisMonth = families.filter((family) => birthdayInCalendarYear(family, today.getFullYear())
    .some((date) => date.getMonth() === today.getMonth())).length;
  const withinThreeDays = upcoming.filter((item) => dayDifference(item.date, today) <= 3).length;
  const next = upcoming[0];
  const nextText = next ? `${next.family.relationship} D-${dayDifference(next.date, today)}` : "등록된 생일 없음";
  $("#summary-grid").innerHTML = `
    <article class="summary-card"><span class="summary-label">🎂 이번 달 생일</span><strong>${thisMonth}명</strong></article>
    <article class="summary-card highlight"><span class="summary-label">🔔 3일 이내 생일</span><strong>${withinThreeDays}명</strong></article>
    <article class="summary-card"><span class="summary-label">📅 다음 생일</span><strong>${escapeHtml(nextText)}</strong></article>`;

  const list = $("#upcoming-list");
  if (!upcoming.length) {
    list.innerHTML = `<div class="empty-state">${families.length ? "확인할 수 있는 생일이 없어요. 음력 변환 범위를 확인해 주세요." : "아직 등록된 가족이 없습니다. 가족을 추가해 보세요 🎂"}</div>`;
    return;
  }
  list.innerHTML = upcoming.slice(0, 12).map(({ family, date }) => {
    const days = dayDifference(date, today);
    return `<article class="birthday-card">
      <div><h3>${escapeHtml(family.name)}</h3><p>${escapeHtml(family.group)}</p>
      <p>${escapeHtml(birthdayDescription(family))}</p><p class="birthday-date">올해 생일: ${formatDate(date)}</p></div>
      <span class="day-badge${days === 0 ? " today" : ""}">${days === 0 ? "🎉 오늘" : `D-${days}`}</span>
    </article>`;
  }).join("");
}

function filteredFamilies() {
  const query = $("#family-search").value.trim().toLocaleLowerCase("ko");
  return families.filter((family) => (activeGroup === "전체" || family.group === activeGroup)
    && (!query || `${family.name} ${family.relationship}`.toLocaleLowerCase("ko").includes(query)))
    .map((family) => ({ family, date: nextBirthday(family) }))
    .sort((a, b) => (a.date ?? new Date(8640000000000000)) - (b.date ?? new Date(8640000000000000)));
}

function renderFamilyList() {
  const list = $("#family-list");
  const items = filteredFamilies();
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">조건에 맞는 가족이 없습니다.</div>`;
    return;
  }
  list.innerHTML = `<div class="family-row header-row"><span>이름</span><span>관계</span><span>그룹</span><span>생일</span><span>다음 생일</span><span>관리</span></div>
    ${items.map(({ family, date }) => `<article class="family-row">
      <div class="family-person" data-label="이름">${escapeHtml(family.name)}${family.memo ? `<small>${escapeHtml(family.memo)}</small>` : ""}</div>
      <div data-label="관계">${escapeHtml(family.relationship)}</div>
      <div data-label="그룹"><span class="tag">${escapeHtml(family.group)}</span></div>
      <div data-label="생일">${escapeHtml(birthdayDescription(family))}</div>
      <div data-label="다음 생일">${date ? `${formatShortDate(date)} · D-${dayDifference(date)}` : "변환할 수 없음"}</div>
      <div class="row-actions"><button class="small-button" type="button" data-edit="${escapeHtml(family.id)}">수정</button><button class="small-button delete" type="button" data-delete="${escapeHtml(family.id)}">삭제</button></div>
    </article>`).join("")}`;
}

function renderMonths() {
  const year = todayDate().getFullYear();
  $("#months-year-label").textContent = `${year}년 양력 날짜 기준`;
  const months = Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    const birthdays = families.flatMap((family) => birthdayInCalendarYear(family, year)
      .filter((date) => date.getMonth() + 1 === number)
      .map((date) => ({ family, date })))
      .sort((a, b) => a.date - b.date);
    const content = birthdays.length
      ? `<ul>${birthdays.map(({ family, date }) => `<li>${escapeHtml(family.name)} ${number}월 ${date.getDate()}일 <span class="muted">(${escapeHtml(family.group)})</span></li>`).join("")}</ul>`
      : `<p class="month-empty">없음</p>`;
    return `<article class="month-card"><h3>${number}월</h3>${content}</article>`;
  });
  $("#month-list").innerHTML = months.join("");
}

function calendarBirthdays(year, month) {
  return families.flatMap((family) => birthdayInCalendarYear(family, year)
    .filter((date) => date.getMonth() === month)
    .map((date) => ({ family, date })));
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  $("#calendar-month-label").textContent = `${year}년 ${month + 1}월`;
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const birthdays = calendarBirthdays(year, month);
  const eventsByDay = new Map();
  for (const event of birthdays) {
    const day = event.date.getDate();
    eventsByDay.set(day, [...(eventsByDay.get(day) ?? []), event.family]);
  }
  const cells = [];
  for (let index = 0; index < firstDay; index += 1) cells.push(`<button class="calendar-day" type="button" disabled aria-hidden="true"></button>`);
  const today = todayDate();
  for (let day = 1; day <= lastDate; day += 1) {
    const events = eventsByDay.get(day) ?? [];
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
    cells.push(`<button class="calendar-day${isToday ? " today" : ""}${events.length ? " has-birthday" : ""}" type="button" data-calendar-day="${day}" aria-label="${month + 1}월 ${day}일${events.length ? `, 생일 ${events.map((event) => event.name).join(", ")}` : ""}">
      <span class="day-number">${day}</span>${events.slice(0, 2).map((family) => `<span class="calendar-event">🎂 ${escapeHtml(family.name)}</span>`).join("")}${events.length > 2 ? `<span class="calendar-event">외 ${events.length - 2}명</span>` : ""}
    </button>`);
  }
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let index = 0; index < trailing; index += 1) cells.push(`<button class="calendar-day" type="button" disabled aria-hidden="true"></button>`);
  $("#calendar-grid").innerHTML = cells.join("");
}

function renderAll() {
  renderHome();
  renderFamilyList();
  renderMonths();
  renderCalendar();
  // 가족 정보나 날짜가 바뀌었을 수 있으니 알림 일정도 함께 새로 보냅니다(서비스 워커가 오늘 알림도 확인합니다).
  syncAlertSchedule();
}

function navigate(viewName) {
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${viewName}`));
  if (viewName === "settings") renderNotificationStatus();
}

function openFamilyDialog(family = null) {
  editingId = family?.id ?? null;
  const form = $("#family-form");
  form.reset();
  $("#form-error").textContent = "";
  $("#dialog-title").textContent = family ? "가족 정보 수정" : "가족 추가";
  if (family) {
    $("#family-name").value = family.name;
    const preset = $$("#family-relationship option").some((option) => option.value === family.relationship && option.value !== "custom");
    $("#family-relationship").value = preset ? family.relationship : "custom";
    $("#family-relationship-custom").value = preset ? "" : family.relationship;
    $("#family-group").value = family.group;
    $(`input[name="calendarType"][value="${family.calendarType}"]`).checked = true;
    if (family.calendarType === "solar") {
      const mm = String(family.solarMonth).padStart(2, "0");
      const dd = String(family.solarDay).padStart(2, "0");
      $("#solar-birthday").value = `2000-${mm}-${dd}`;
    } else {
      $("#lunar-month").value = String(family.lunarMonth);
      $("#lunar-day").value = String(family.lunarDay);
      $("#leap-month").checked = family.isLeapMonth;
    }
    $("#family-memo").value = family.memo;
  }
  updateCalendarFields();
  updateRelationshipField();
  $("#family-dialog").showModal();
  $("#family-name").focus();
}

function updateCalendarFields() {
  const type = $('input[name="calendarType"]:checked').value;
  $("#solar-fields").hidden = type !== "solar";
  $("#lunar-fields").hidden = type !== "lunar";
  $("#solar-birthday").required = type === "solar";
  $("#lunar-month").required = type === "lunar";
  $("#lunar-day").required = type === "lunar";
}

// 휴대폰에서는 datalist 추천 목록이 잘 동작하지 않아 선택 목록 + '직접 입력' 칸을 사용합니다.
function updateRelationshipField() {
  const custom = $("#family-relationship").value === "custom";
  const input = $("#family-relationship-custom");
  input.hidden = !custom;
  input.required = custom;
  return input;
}

const RELATIONSHIP_GROUPS = { 외가: ["외할머니", "외할아버지", "이모", "이모부", "외삼촌", "외숙모"],
  친가: ["할머니", "할아버지", "고모", "고모부", "삼촌", "숙모", "큰아버지", "큰어머니", "작은아버지", "작은어머니"] };

function handleRelationshipChange() {
  const input = updateRelationshipField();
  if (!input.hidden) {
    input.focus();
    return;
  }
  // 외가·친가 관계를 고르면 가족 그룹도 맞춰 둡니다(직접 바꿀 수 있습니다).
  const relationship = $("#family-relationship").value;
  const group = Object.keys(RELATIONSHIP_GROUPS).find((name) => RELATIONSHIP_GROUPS[name].includes(relationship));
  $("#family-group").value = group ?? "우리가족";
}

function collectFamily(formData) {
  const calendarType = formData.get("calendarType");
  const choice = String(formData.get("relationshipChoice") ?? "");
  const base = {
    id: editingId ?? makeId(),
    name: String(formData.get("name")).trim(),
    relationship: (choice === "custom" ? String(formData.get("relationshipCustom") ?? "") : choice).trim(),
    group: String(formData.get("group")),
    calendarType,
    memo: String(formData.get("memo") ?? "").trim()
  };
  if (calendarType === "solar") {
    const [, month, day] = String(formData.get("solarBirthday")).split("-").map(Number);
    return { ...base, solarMonth: month, solarDay: day };
  }
  return {
    ...base,
    lunarMonth: Number(formData.get("lunarMonth")),
    lunarDay: Number(formData.get("lunarDay")),
    isLeapMonth: formData.get("isLeapMonth") === "on"
  };
}

function validateFamily(family) {
  if (!family.name || !family.relationship) return "이름과 관계를 입력해 주세요.";
  if (!GROUPS.includes(family.group)) return "가족 그룹을 선택해 주세요.";
  if (!isValidFamily(family)) return "생일 날짜를 확인해 주세요.";
  if (family.calendarType === "solar") {
    const date = dateOnly(2000, family.solarMonth, family.solarDay);
    if (date.getMonth() + 1 !== family.solarMonth || date.getDate() !== family.solarDay) return "올바른 양력 날짜를 선택해 주세요.";
  }
  return "";
}

function handleFamilySubmit(event) {
  event.preventDefault();
  const family = collectFamily(new FormData(event.currentTarget));
  const error = validateFamily(family);
  if (error) {
    $("#form-error").textContent = error;
    return;
  }
  if (family.calendarType === "lunar") {
    try {
      convertLunarDate(todayDate().getFullYear(), family.lunarMonth, family.lunarDay, family.isLeapMonth);
    } catch (conversionError) {
      if (conversionError.message.includes("라이브러리")) {
        $("#form-error").textContent = conversionError.message;
        return;
      }
      // 윤달은 해당 연도에 없을 수 있으므로 연도별 실제 생일 계산은 저장 후에도 계속 지원합니다.
    }
  }
  const previous = families;
  families = editingId ? families.map((item) => item.id === editingId ? family : item) : [...families, family];
  if (!persistFamilies()) {
    families = previous;
    return;
  }
  $("#family-dialog").close();
  renderAll();
  showToast(editingId ? "가족 정보를 수정했습니다." : "가족을 추가했습니다.");
}

function editOrDelete(event) {
  const editButton = event.target.closest("[data-edit]");
  const deleteButton = event.target.closest("[data-delete]");
  if (editButton) {
    const family = families.find((item) => item.id === editButton.dataset.edit);
    if (family) openFamilyDialog(family);
  }
  if (deleteButton) {
    const family = families.find((item) => item.id === deleteButton.dataset.delete);
    if (!family || !confirm(`${family.name} 가족 정보를 정말 삭제하시겠습니까?`)) return;
    const previous = families;
    families = families.filter((item) => item.id !== family.id);
    if (!persistFamilies()) families = previous;
    else {
      renderAll();
      showToast("가족 정보를 삭제했습니다.");
    }
  }
}

function renderCalendarDetails(day) {
  const details = $("#calendar-details");
  const events = calendarBirthdays(calendarDate.getFullYear(), calendarDate.getMonth())
    .filter((event) => event.date.getDate() === day);
  if (!events.length) {
    details.innerHTML = `<p>${calendarDate.getMonth() + 1}월 ${day}일에는 등록된 생일이 없습니다.</p>`;
    return;
  }
  details.innerHTML = `<p><strong>${calendarDate.getMonth() + 1}월 ${day}일 생일</strong></p>${events.map(({ family }) =>
    `<p class="detail-item">🎂 ${escapeHtml(family.name)} · ${escapeHtml(family.relationship)} · ${escapeHtml(family.group)} · ${escapeHtml(birthdayDescription(family))}${family.memo ? ` · ${escapeHtml(family.memo)}` : ""}</p>`
  ).join("")}`;
}

function renderNotificationStatus() {
  const status = $("#notification-status");
  const button = $("#notification-permission");
  if (!("Notification" in window)) {
    status.textContent = "이 브라우저는 알림 기능을 지원하지 않습니다.";
    button.disabled = true;
    return;
  }
  button.disabled = Notification.permission !== "default";
  button.textContent = Notification.permission === "granted"
    ? "알림이 허용되었습니다"
    : Notification.permission === "denied"
      ? "브라우저 설정에서 알림 허용"
      : "생일 알림을 받으시겠습니까?";
  status.textContent = Notification.permission === "granted"
    ? "알림이 켜져 있습니다. 앱을 열 때마다, 그리고 지원되는 휴대폰에서는 하루 한두 번 백그라운드에서 알림을 확인합니다."
    : Notification.permission === "denied"
      ? "알림이 차단되어 있습니다. 브라우저 사이트 설정에서 권한을 변경해 주세요."
      : "버튼을 누르면 브라우저 알림 권한을 요청합니다.";
  $("#test-notification").disabled = Notification.permission !== "granted";
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    showToast("이 브라우저는 알림을 지원하지 않습니다.");
    renderNotificationStatus();
    return;
  }
  if (Notification.permission === "granted") {
    renderNotificationStatus();
    return;
  }
  const permission = await Notification.requestPermission();
  renderNotificationStatus();
  showToast(permission === "granted" ? "생일 알림을 켰습니다." : "브라우저 알림 권한이 허용되지 않았습니다.");
  if (permission === "granted") {
    await registerBackgroundCheck();
    syncAlertSchedule();
  }
}

function alertMessage(family, offset) {
  if (offset === 3) return { title: "🔔 생일 3일 전", body: `3일 후 ${family.name}의 생일이에요 🎂\n미리 선물을 준비해보세요.` };
  if (offset === 1) return { title: "🔔 생일 1일 전", body: `내일은 ${family.name}의 생일이에요 🎁` };
  return { title: "🎉 오늘 생일", body: `오늘은 ${family.name}의 생일입니다! 🎉` };
}

// 앱을 오래 열지 않아도 알림을 보낼 수 있도록 가족마다 다음 생일 두 번치 알림 일정을 미리 계산합니다.
function buildAlertSchedule() {
  const today = todayDate();
  const alerts = [];
  for (const family of families) {
    let birthday = nextBirthday(family, today);
    for (let count = 0; count < 2 && birthday; count += 1) {
      for (const offset of ALERT_OFFSETS) {
        if (!settings.alerts[String(offset)]) continue;
        const alertDate = addDays(birthday, -offset);
        if (alertDate < today) continue;
        alerts.push({ key: `${family.id}:${dateKey(birthday)}:${offset}`, date: dateKey(alertDate), ...alertMessage(family, offset) });
      }
      birthday = nextBirthday(family, addDays(birthday, 1));
    }
  }
  return alerts;
}

async function activeServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.active ?? null;
}

// 알림 일정은 서비스 워커에 넘기고, 실제 알림 표시와 중복 방지는 서비스 워커가 맡습니다.
async function syncAlertSchedule() {
  try {
    const worker = await activeServiceWorker();
    worker?.postMessage({ type: "schedule", alerts: buildAlertSchedule() });
  } catch (error) {
    console.error("알림 일정 전달 실패:", error);
  }
}

async function sendTestNotification() {
  const worker = await activeServiceWorker();
  if (!worker) {
    showToast("이 브라우저에서는 알림을 보낼 수 없습니다. https 주소로 접속했는지 확인해 주세요.");
    return;
  }
  worker.postMessage({ type: "test" });
}

// 안드로이드 크롬에서 홈 화면에 설치한 경우, 앱을 닫아도 하루 한두 번 알림을 확인하도록 요청합니다.
async function registerBackgroundCheck() {
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (!registration || !("periodicSync" in registration)) return;
    const status = await navigator.permissions.query({ name: "periodic-background-sync" });
    if (status.state !== "granted") return;
    await registration.periodicSync.register("birthday-check", { minInterval: 12 * 60 * 60 * 1000 });
  } catch (error) {
    console.warn("백그라운드 알림 확인을 등록하지 못했습니다:", error);
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
  try {
    await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    await registerBackgroundCheck();
    syncAlertSchedule();
  } catch (error) {
    console.error("서비스 워커 등록 실패:", error);
  }
}

function icsText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// iCalendar는 한 줄을 75바이트 이하로 접어야 하므로 한글이 잘리지 않게 글자 단위로 나눕니다.
function foldIcsLine(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += character;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

// 하루 종일 일정은 0시에 시작하므로 오전 9시에 울리도록 알람 시점을 맞춥니다.
const ICS_ALARM_TRIGGERS = { 3: "-P2DT15H", 1: "-PT15H", 0: "PT9H" };

function buildCalendarFile() {
  const today = todayDate();
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const compact = (date) => dateKey(date).replace(/-/g, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//family-birthday//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:우리가족 생일"];
  let count = 0;
  for (const family of families) {
    for (let year = today.getFullYear(); year < today.getFullYear() + CALENDAR_EXPORT_YEARS; year += 1) {
      let dates;
      try {
        dates = birthdayInCalendarYear(family, year);
      } catch {
        continue;
      }
      for (const date of dates.filter((item) => item >= today)) {
        const description = [birthdayDescription(family), family.memo].filter(Boolean).join(" · ");
        lines.push("BEGIN:VEVENT", `UID:${family.id}-${compact(date)}@family-birthday`, `DTSTAMP:${stamp}`,
          `DTSTART;VALUE=DATE:${compact(date)}`, `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`,
          `SUMMARY:${icsText(`🎂 ${relationName(family)} 생일`)}`, `DESCRIPTION:${icsText(description)}`, "TRANSP:TRANSPARENT");
        for (const offset of ALERT_OFFSETS) {
          if (!settings.alerts[String(offset)]) continue;
          lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${ICS_ALARM_TRIGGERS[offset]}`,
            `DESCRIPTION:${icsText(alertMessage(family, offset).body)}`, "END:VALARM");
        }
        lines.push("END:VEVENT");
        count += 1;
      }
    }
  }
  lines.push("END:VCALENDAR");
  return { content: `${lines.map(foldIcsLine).join("\r\n")}\r\n`, count };
}

function isAppleMobile() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function exportCalendar() {
  const { content, count } = buildCalendarFile();
  if (!count) {
    showToast("내보낼 생일이 없습니다. 가족을 먼저 추가해 주세요.");
    return;
  }
  // 아이폰 사파리는 data 주소로 열어야 '캘린더에 추가' 화면이 바로 나타납니다.
  if (isAppleMobile()) {
    location.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(content)}`;
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "가족생일.ics";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`앞으로 ${CALENDAR_EXPORT_YEARS}년간 생일 ${count}건을 캘린더 파일로 저장했습니다. 파일을 열어 캘린더에 추가해 주세요.`);
}

function renderInstallStatus() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  $("#install-button").hidden = standalone || !installPrompt;
  $("#install-status").textContent = standalone
    ? "홈 화면 앱으로 실행 중입니다 ✅"
    : isAppleMobile()
      ? "Safari 아래쪽 공유 버튼(⬆️) → '홈 화면에 추가'를 누르면 앱처럼 설치됩니다."
      : installPrompt
        ? "아래 버튼을 누르면 홈 화면에 앱으로 설치됩니다."
        : "크롬 메뉴(⋮) → '홈 화면에 추가' 또는 '앱 설치'를 누르면 앱처럼 설치됩니다.";
}

async function installApp() {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  renderInstallStatus();
}

function exportData() {
  const content = JSON.stringify({ app: "family-birthday", version: 1, exportedAt: new Date().toISOString(), families }, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `가족생일백업-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("가족 데이터 백업 파일을 저장했습니다.");
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    const imported = Array.isArray(data) ? data : data?.families;
    if (!Array.isArray(imported) || !imported.every(isValidFamily)
      || new Set(imported.map((family) => family.id)).size !== imported.length) {
      throw new Error("파일 형식이 올바르지 않습니다. 이 앱에서 만든 가족 백업 JSON 파일을 선택해 주세요.");
    }
    if (!confirm(`${imported.length}명의 가족 정보를 불러옵니다. 현재 가족 목록을 백업 데이터로 바꾸시겠습니까?`)) return;
    const previous = families;
    families = imported;
    if (!persistFamilies()) {
      families = previous;
      return;
    }
    renderAll();
    showToast(`${families.length}명의 가족 정보를 복원했습니다.`);
  } catch (error) {
    showNotice(`백업 데이터를 불러오지 못했습니다. ${error.message}`, true);
  } finally {
    $("#import-data-file").value = "";
  }
}

function populateLunarInputs() {
  $("#lunar-month").innerHTML = Array.from({ length: 12 }, (_, index) =>
    `<option value="${index + 1}">${index + 1}월</option>`).join("");
  $("#lunar-day").innerHTML = Array.from({ length: 30 }, (_, index) =>
    `<option value="${index + 1}">${index + 1}일</option>`).join("");
}

function setupEvents() {
  $$(".nav-button").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
  $("#add-family-button").addEventListener("click", () => openFamilyDialog());
  $$("[data-add-family]").forEach((button) => button.addEventListener("click", () => openFamilyDialog()));
  $("#family-form").addEventListener("submit", handleFamilySubmit);
  $("#close-dialog").addEventListener("click", () => $("#family-dialog").close());
  $("#cancel-dialog").addEventListener("click", () => $("#family-dialog").close());
  $$('input[name="calendarType"]').forEach((radio) => radio.addEventListener("change", updateCalendarFields));
  $("#family-relationship").addEventListener("change", handleRelationshipChange);
  $("#family-search").addEventListener("input", renderFamilyList);
  $$(".filter-button").forEach((button) => button.addEventListener("click", () => {
    activeGroup = button.dataset.group;
    $$(".filter-button").forEach((item) => item.classList.toggle("active", item === button));
    renderFamilyList();
  }));
  $("#family-list").addEventListener("click", editOrDelete);
  $("#previous-month").addEventListener("click", () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    renderCalendar();
  });
  $("#next-month").addEventListener("click", () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    renderCalendar();
  });
  $("#calendar-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-calendar-day]");
    if (button) renderCalendarDetails(Number(button.dataset.calendarDay));
  });
  $("#notification-permission").addEventListener("click", requestNotificationPermission);
  $("#test-notification").addEventListener("click", sendTestNotification);
  $$("[data-alert-offset]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    settings.alerts[checkbox.dataset.alertOffset] = checkbox.checked;
    persistSettings();
    syncAlertSchedule();
  }));
  $("#export-calendar").addEventListener("click", exportCalendar);
  $("#install-button").addEventListener("click", installApp);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    renderInstallStatus();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    renderInstallStatus();
    showToast("홈 화면에 앱을 설치했습니다.");
  });
  // 휴대폰에서 앱을 다시 열면 날짜가 바뀌었을 수 있으므로 화면과 알림을 새로 계산합니다.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") renderAll();
  });
  $("#export-data").addEventListener("click", exportData);
  $("#import-data-button").addEventListener("click", () => $("#import-data-file").click());
  $("#import-data-file").addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) importData(file);
  });
}

async function startApp() {
  populateLunarInputs();
  loadData();
  setupEvents();
  $$("[data-alert-offset]").forEach((checkbox) => {
    checkbox.checked = settings.alerts[checkbox.dataset.alertOffset] !== false;
  });
  registerServiceWorker();
  renderAll();
  renderNotificationStatus();
  renderInstallStatus();

  if (lunarLibraryError) {
    showNotice("음력 변환 도구를 불러오지 못했습니다. 페이지를 새로고침해 주세요. 양력 생일은 계속 사용할 수 있습니다.", true);
    console.error("음력 변환 라이브러리 로드 실패:", lunarLibraryError);
  } else if (!$("#notice-area").childElementCount && (!("Notification" in window) || Notification.permission !== "granted")) {
    showNotice("생일 알림을 설정해 보세요. 앱을 닫아 두어도 확실히 받으려면 '휴대폰 캘린더에 추가'도 함께 사용하세요.", false, true);
  }
  setInterval(renderAll, 60 * 1000);
}

startApp();
