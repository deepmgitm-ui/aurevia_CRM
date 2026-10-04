// One-off helper: rewrites the user-facing Hinglish strings to professional
// English. Exact-match only, so a comment or an identifier can never be hit by
// accident. Run with: node scripts/translate-to-english.mjs
import { readFileSync, writeFileSync } from "node:fs";

/** Every entry is an exact string that appears in the source, verbatim. */
const REPLACEMENTS = {
  // ---- shared fallbacks -------------------------------------------------
  "Attendance check nahi hua.": "Could not check attendance.",
  "Attendance mark nahi hua.": "Could not mark attendance.",
  "Attendance load nahi hua.": "Could not load attendance.",
  "Attendance save nahi hua.": "Could not save attendance.",
  "Attendance update nahi hua.": "Could not update attendance.",
  "Attendance delete nahi hua.": "Could not delete attendance.",
  "Pehle login karo.": "Please sign in first.",
  "Month 2026-09 jaisa hona chahiye.": "Month must look like 2026-09.",
  "Status Present / Absent / Half-Day me se ek chuno.":
    "Choose one of Present, Absent or Half-Day.",
  "Attendance sirf admin/manager change kar sakta hai.":
    "Only an admin or manager can change attendance.",
  "Attendance sirf admin/manager delete kar sakta hai.":
    "Only an admin or manager can delete attendance.",
  "Team attendance sirf admin/manager dekh sakta hai.":
    "Only an admin or manager can view team attendance.",
  "Attendance row nahi mili.": "That attendance row no longer exists.",
  "Ye attendance row ab nahi hai (shayad delete ho gayi).":
    "This attendance row no longer exists — it may have been deleted.",

  // ---- empty states (one string, many call sites) ------------------------
  "Is window me koi lead nahi.": "No leads in this date range.",
  "Is window me koi booked/attended consultation nahi.":
    "No booked or attended consultations in this date range.",
  "Is window me koi completed surgery nahi.":
    "No completed surgeries in this date range.",
  "Is window me first contact se aage koi lead nahi.":
    "No leads in this date range have moved past first contact.",

  // ---- section descriptions ---------------------------------------------
  "Pehle contact se aage badhe leads — yehi team abhi kaam kar rahi hai":
    "Leads that have moved past first contact — the team currently working these",
  "Sabhi agents ke assigned leads — Assigned To column se dekh lo kis agent ke paas kaun hai":
    "Every agent's assigned leads — use the Assigned To column to see who owns which",
  "Har channel ke leads — Source column se group samajh lo":
    "Leads from every channel — group them by the Source column",
  "Sabhi leads — City column se group samajh lo":
    "All leads — group them by the City column",
  "Poore window ke leads — jaise Overview dashboard me, naam pe tap karke record kholo":
    "Every lead in this range, same as the Overview dashboard — click a name to open the record",

  // ---- lead drawer -------------------------------------------------------
  "Lead load nahi hua": "Could not load lead",
  "Ye lead is view me nahi dikhta.": "This lead is not visible in this view.",
  "Save nahi hua": "Could not save",
  "Note save nahi hua": "Could not save note",
  "Call log nahi hua": "Could not log call",
  "Follow-up me kya hua…": "What happened in this follow-up…",
  "Abhi koi activity nahi — pehla note Info tab se add karo.":
    "No activity yet — add the first note from the Info tab.",
  "Lead open nahi ho paya. Dobara tap karo.":
    "Could not open this lead. Tap again.",

  // ---- calendar ----------------------------------------------------------
  "Abhi koi activity record nahi hui.": "No activity recorded yet.",
  "Is din koi naya lead add nahi hua.": "No new leads were added on this day.",
  "Event edit karo": "Edit event",
  "Lead ka follow-up schedule karo (optional)":
    "Schedule a follow-up for a lead (optional)",
  "lead ka naam ya phone search karo…": "Search by lead name or phone…",
  "Koi lead nahi mili.": "No leads found.",
  "Lead ki poori timeline dekho": "View this lead's full timeline",

  // ---- pipeline detail ---------------------------------------------------
  "Is segment me koi patient nahi mila.": "No patients in this segment.",

  // ---- attendance UI -----------------------------------------------------
  "Login time nahi (manager entry)": "No login time (entered by manager)",
  "Aaj ki attendance — login karte hi mark ho gayi":
    "Today's attendance — marked automatically when you signed in",
  "Employee dhoondo": "Search employees",
  "Sab employees": "All employees",
  "Aaj: mark nahi": "Today: not marked",

  // ---- attendance actions (round two) -----------------------------------
  "Employee chuno.": "Choose an employee.",
  "Date 2026-09-30 jaisi honi chahiye.": "Date must look like 2026-09-30.",

  // ---- attendance UI toasts ---------------------------------------------
  "Update nahi hua": "Could not update",
  "Delete nahi hua": "Could not delete",
  "Mark nahi hua": "Could not mark",

  // ---- attendance calendar legend ---------------------------------------
  "Har dot ek employee hai — green = Present, amber = Half-Day, red = Absent. Din pe tap karo aur us din ki list kholo.":
    "Each dot is one employee — green = Present, amber = Half-Day, red = Absent. Tap a day to see everyone marked on it.",
  "Din pe tap karo aur detail kholo.": "Tap a day for details.",
  "Aapka {name} ka": "{name}'s",

  // ---- calendar actions --------------------------------------------------
  "calendar_events table abhi bani nahi hai — pehle supabase-calendar-migration.sql ko Supabase SQL editor me chalao.":
    "The calendar_events table does not exist yet — run supabase-calendar-migration.sql in the Supabase SQL editor first.",
  "Date samajh nahi aayi.": "Could not read that date.",
  "Postpone nahi ho paya.": "Could not postpone.",
  "Clear nahi ho paya.": "Could not clear.",
  "Done mark nahi ho paya.": "Could not mark as done.",
  "Follow-up calendar se done mark kiya gaya.": "Follow-up marked done from the calendar.",
  "Event ko ek title do.": "Give the event a title.",
  "Type note, call, visit ya leave me se ho.":
    "Type must be one of note, call, visit or leave.",

  // ---- leads table -------------------------------------------------------
  "City, Treatment, Insurance &amp; Remarks yahan se edit kiye ja sakte hain.":
    "City, Treatment, Insurance and Remarks can be edited here.",

  // ---- plan calendar legend ---------------------------------------------
  "Neeli goli = lead follow-up / call, dusre rang = tumhare personal events, ":
    "Blue dot = lead follow-up or call, other colours = your personal events, ",
  "new</span> = us din lead create hui, grey dot = koi activity (note / status / call). Din par double-click karke personal event add karo, ya selected din par “Follow-up” se kisi lead ka follow-up schedule karo.":
    "green</span> = a lead was created that day, grey dot = activity (note, status or call). Double-click a day to add a personal event, or use Follow-up on a selected day to schedule a lead's follow-up.",

  // ---- page metadata -----------------------------------------------------
  "Aurevia HealthCare ka CRM — leads, pipeline, consultations, surgeries, patients aur attendance ek hi system me.":
    "Aurevia HealthCare's CRM — leads, pipeline, consultations, surgeries, patients and attendance in one system.",

  // ---- comments that quote user-facing wording --------------------------
  "konsa lead kis treatment ka hai": "which lead wants which treatment",

  // ---- attendance UI (round three) --------------------------------------
  "Is din kisi ne login nahi kiya — koi attendance mark nahi.":
    "Nobody signed in on this day — no attendance marked.",
  "Mark karo": "Mark",
  "Login time nahi": "No login time",
  "Login time nahi (manager entry)": "No login time (entered by manager)",

  // ---- attendance page subtitle -----------------------------------------
  "Employee login karte hi check-in mark ho jata hai. Kisi bhi employee ka card tap karo\n          aur uska apna calendar khul jayega.":
    "Attendance is marked automatically the moment an employee signs in. Tap any employee card to open that person's own calendar.",

  // ---- employee search empty state --------------------------------------
  "&quot;{query}&quot; se koi employee nahi mila.":
    "No employees match \u201C{query}\u201D.",
  "se koi employee nahi mila.": " matches no employees.",

  // ---- calendar actions (round two) -------------------------------------
  "Event add nahi ho paya.": "Could not add the event.",
  "Event update nahi ho paya.": "Could not update the event.",
  "Event delete nahi ho paya.": "Could not delete the event.",
  "Lead nahi mila (aapki access me nahi hai).":
    "Lead not found (it is outside your access).",
  "Timeline load nahi ho paya.": "Could not load the timeline.",
  "Lead search nahi ho paya.": "Could not search leads.",
  "Follow-up set nahi hua": "Could not set the follow-up",

  // ---- calendar page subtitle -------------------------------------------
  "Lead follow-ups aur DNP callbacks apne aap aate hain, aur neeche Event dabakar apni chhutti / visit / note\n          khud plan karo.":
    "Lead follow-ups and DNP callbacks appear automatically. Use the Event button below to plan your own leave, visits and notes.",

  // ---- treatment tally comment ------------------------------------------
  "\"konsa lead kis treatment / disease\n * ka hai\"": "\"which lead wants which treatment / disease\"",

  // ---- plan calendar (round two) ----------------------------------------
  "double-click se personal event add karo": "double-click to add a personal event",
  "Is din koi follow-up / call reminder nahi hai.":
    "No follow-up or call reminders on this day.",
  "Is din koi note / status / call activity nahi hui.":
    "No notes, status changes or calls on this day.",
  "Koi personal event nahi — Event dabakar chhutti, visit ya note add karo.":
    "No personal events — use Event to add leave, a visit or a note.",
  "Lead chunoge to ye {selectedIso} par us lead ka follow-up ban jayega — tab Title/Type khaali chhodo.":
    "Picking a lead turns {selectedIso} into that lead's follow-up — leave Title and Type blank.",

  // ---- code comments (kept, but tidied) ---------------------------------
  "\"chart pe click karo, list aa jaaye\"": "\"click a chart, get the matching list\"",

  // ---- leads page ---------------------------------------------------------
  "Treatment-wise tally — \"konsa lead kis treatment / disease ka hai\"":
    "Treatment-wise tally — \"which lead wants which treatment / disease\"",
  "\"konsa lead kis treatment / disease ka hai\" — one chip":
    "\"which lead wants which treatment / disease\" — one chip",
  "ke leads dikh rahe hain — din/hafte ke filter\n          iske saath lagta nahi hai.":
    " leads are shown — the day and week filters do not apply alongside it.",

  // ---- pipeline detail ----------------------------------------------------
  "Segment ke patient load ho rahe hain…": "Loading patients in this segment…",
  "patient is segment me — naam pe tap karke dekho aur edit bhi karo.":
    " patients in this segment — click a name to view and edit it.",
  "Pehle {patients.length} dikhaye ja rahe hain.":
    "Showing the first {patients.length}.",

  // ---- leads page caption (multiline) ------------------------------------
  "{monthFilterLabel(filters.month)} ke leads dikh rahe hain — din/hafte ke filter":
    "Showing leads for {monthFilterLabel(filters.month)} — the day and week filters do",
  "          iske saath lagta nahi hai.":
    "          not apply alongside it.",

  // ---- lead list card caption --------------------------------------------
  "— pehle ${limit} dikh rahe hain, baaki Leads module me.":
    "— showing the first ${limit}; the rest are in the Leads module.",
  "— naam pe tap karke poora record kholo.":
    "— click a name to open the full record.",

  // ---- login --------------------------------------------------------------
  "Din khatam ho gaya, isliye aapko logout kar diya gaya hai. Dobara login\n              karte hi aaj ki attendance apne aap mark ho jayegi.":
    "The day has ended, so you have been signed out. Today's attendance will be marked automatically the moment you sign in again.",

  // ---- remaining code comments -------------------------------------------
  "\"konsa lead kis treatment / disease\n * ka hai\" at a glance":
    "\"which lead wants which treatment / disease\" at a glance",
  "\"konsa lead kis treatment / disease ka hai\" at a glance":
    "\"which lead wants which treatment / disease\" at a glance",
};

for (const file of process.argv.slice(2)) {
  const before = readFileSync(file, "utf8");
  let after = before;
  for (const [from, to] of Object.entries(REPLACEMENTS)) {
    after = after.split(from).join(to);
  }
  if (after !== before) {
    writeFileSync(file, after, "utf8");
    console.log(`translated: ${file}`);
  }
}