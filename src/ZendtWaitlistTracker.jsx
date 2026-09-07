import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import storage from "./storage";

const STORAGE_KEY = "zendt-waitlist-leads-v3";
const CONFIG_KEY = "zendt-waitlist-config-v1";
const DUPELOG_KEY = "zendt-waitlist-dupelog-v1";

const SHEET_URL = "https://script.google.com/macros/s/AKfycbx1X12rn1yRtUCF1C8lT5NQHC2EyKdW-2-vCGzw8SEC_Xr2J5M__DRzkVhwJwKjTIzGIg/exec";

const C = {
  bg: "#0A0A0A", surface: "#161514", surface2: "#121110",
  ink: "#FFFFFF", ink2: "#E8E6E2", muted: "#8A8580", muted2: "#5A5550",
  border: "#262422", line2: "#1B1917",
  warm: "#E8B796", warm2: "#C99A78", cool: "#B7B3E8",
  danger: "#E07A5F", good: "#8FBF9F",
};

const SOURCES = ["Upwork", "Fiverr", "Behance", "Dribbble", "LinkedIn", "Instagram", "Reddit", "Facebook group", "Discord / Slack", "Freelancer database", "Chennai event", "Referral", "Other"];
const CORRIDORS = ["United States", "United Kingdom", "Canada", "Australia", "Germany", "Netherlands", "UAE", "Saudi Arabia", "Qatar", "Singapore", "Other Europe", "Other"];
const TOOLS = ["PayPal", "Wise", "Payoneer", "Direct bank wire", "Upwork / Fiverr payout", "Skydo", "BriskPe", "Crypto", "Not sure", "Other"];

const STATUSES = [
  { key: "new", label: "Not contacted" },
  { key: "attempted", label: "Called, no answer" },
  { key: "talked", label: "Conversation done" },
  { key: "signed", label: "On waitlist" },
  { key: "followup", label: "Follow up" },
  { key: "dead", label: "Not interested" },
];

const statusColor = (k) =>
  ({ new: C.muted2, attempted: C.muted, talked: C.cool, signed: C.warm, followup: C.warm2, dead: C.danger }[k] || C.muted);

const TARGETS = { dials: 40, talked: 15, signed: 5 };

const inr = (n) => {
  const v = Number(n || 0);
  if (!v) return "\u20B90";
  return "\u20B9" + v.toLocaleString("en-IN");
};

const inrShort = (n) => {
  const v = Number(n || 0);
  if (v >= 10000000) return "\u20B9" + (v / 10000000).toFixed(2) + " Cr";
  if (v >= 100000) return "\u20B9" + (v / 100000).toFixed(2) + " L";
  return inr(v);
};

const norm = (s) =>
  (s || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").replace(/[\s\-().@]/g, "").trim();

const normPhone = (s) => {
  const d = (s || "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
};

// Indian mobile: 10 digits starting 6-9, optionally with +91 / 91 / 0 in front
const phoneCheck = (raw) => {
  const t = (raw || "").trim();
  if (!t) return { ok: true, digits: "" };
  let d = t.replace(/\D/g, "");
  if (d.startsWith("91") && d.length === 12) d = d.slice(2);
  else if (d.startsWith("0") && d.length === 11) d = d.slice(1);
  if (d.length !== 10) return { ok: false, digits: d, why: "An Indian mobile number is 10 digits" };
  if (!/^[6-9]/.test(d)) return { ok: false, digits: d, why: "Indian mobiles start with 6, 7, 8 or 9" };
  return { ok: true, digits: d };
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const stamp = () => new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const emptyLead = () => ({
  id: "", name: "", phone: "", email: "",
  linkedin: "", website: "", socials: "",
  sources: [], sourceOther: "", skill: "",
  corridors: [], corridorOther: "", volume: "",
  tools: [], toolOther: "", fee: "", status: "new",
  followupOn: "", notes: "", createdOn: todayStr(),
  dialedOn: "", talkedOn: "", signedOn: "", syncedOn: "",
});

// older records stored single strings; bring them forward
const migrate = (l) => ({
  ...emptyLead(),
  ...l,
  sources: Array.isArray(l.sources) ? l.sources : l.source ? [l.source] : [],
  corridors: Array.isArray(l.corridors) ? l.corridors : l.corridor ? [l.corridor] : [],
  tools: Array.isArray(l.tools) ? l.tools : l.tool ? [l.tool] : [],
});

// swaps "Other" for whatever was typed in the box next to it
const listOf = (l, key, otherKey) => {
  const arr = l[key] || [];
  return arr.map((v) => (v === "Other" && l[otherKey] ? l[otherKey] : v));
};
const listText = (l, key, otherKey) => listOf(l, key, otherKey).join(", ") || "\u2014";

export default function ZendtWaitlistTracker() {
  const [leads, setLeads] = useState([]);
  const [dupeLog, setDupeLog] = useState([]);
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState("idle");
  const [form, setForm] = useState(emptyLead());
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDupeLog, setShowDupeLog] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [confirmDupe, setConfirmDupe] = useState(false);
  const [toast, setToast] = useState("");
  const [syncing, setSyncing] = useState(false);
  const saveStateRef = useRef("idle");
  saveStateRef.current = saveState;

  const loadAll = useCallback(async (isInitial) => {
    try {
      const r = await storage.get(STORAGE_KEY);
      if (r && r.value) setLeads(JSON.parse(r.value).map(migrate));
      else if (isInitial) setLeads([]);
    } catch (e) { if (isInitial) setLeads([]); }
    try {
      const c = await storage.get(CONFIG_KEY);
      if (c && c.value) setConfig(JSON.parse(c.value));
    } catch (e) { /* first run */ }
    try {
      const d = await storage.get(DUPELOG_KEY);
      if (d && d.value) setDupeLog(JSON.parse(d.value));
      else if (isInitial) setDupeLog([]);
    } catch (e) { if (isInitial) setDupeLog([]); }
    if (isInitial) setLoading(false);
  }, []);

  useEffect(() => {
    loadAll(true);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && saveStateRef.current !== "saving") loadAll(false);
    }, 4000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const persist = useCallback(async (next) => {
    setLeads(next);
    setSaveState("saving");
    try {
      const ok = await storage.set(STORAGE_KEY, JSON.stringify(next), true);
      setSaveState(ok ? "saved" : "error");
    } catch (e) { setSaveState("error"); }
    setTimeout(() => setSaveState("idle"), 2000);
  }, []);

  const saveConfig = async (next) => {
    setConfig(next);
    try { await storage.set(CONFIG_KEY, JSON.stringify(next), true); } catch (e) { /* ignore */ }
  };

  const logDupe = async (entry) => {
    const next = [{ ...entry, at: stamp() }, ...dupeLog].slice(0, 200);
    setDupeLog(next);
    try { await storage.set(DUPELOG_KEY, JSON.stringify(next), true); } catch (e) { /* ignore */ }
  };

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const pushToSheet = async (lead) => {
    try {
      const res = await fetch(SHEET_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          name: lead.name, phone: lead.phone, email: lead.email,
          linkedin: lead.linkedin, website: lead.website, socials: lead.socials,
          source: listOf(lead, "sources", "sourceOther").join(", "),
          skill: lead.skill,
          corridor: listOf(lead, "corridors", "corridorOther").join(", "),
          volume: lead.volume,
          tool: listOf(lead, "tools", "toolOther").join(", "),
          fee: lead.fee, notes: lead.notes, addedBy: "Govind",
        }),
      });
      return await res.json();
    } catch (e) {
      return { status: "error", message: String(e) };
    }
  };

  const syncOne = async (lead, list) => {
    const r = await pushToSheet(lead);
    if (r.status === "added" || r.status === "duplicate") {
      const next = (list || leads).map((l) => (l.id === lead.id ? { ...l, syncedOn: todayStr() } : l));
      persist(next);
      flash(r.status === "duplicate" ? "Sheet already had this person. Marked as synced." : "Sent to the sheet.");
    } else {
      flash("Could not reach the sheet. It stays in the queue and you can send it again.");
    }
  };

  const unsynced = useMemo(() => leads.filter((l) => l.status === "signed" && !l.syncedOn), [leads]);

  const syncAll = async () => {
    setSyncing(true);
    let list = leads;
    for (const l of unsynced) {
      const r = await pushToSheet(l);
      if (r.status === "added" || r.status === "duplicate") {
        list = list.map((x) => (x.id === l.id ? { ...x, syncedOn: todayStr() } : x));
      }
    }
    await persist(list);
    setSyncing(false);
    flash("Sheet is up to date.");
  };

  // ---- live duplicate check ----
  const checks = useMemo(() => {
    const p = normPhone(form.phone), e = norm(form.email), n = norm(form.name);
    const li = norm(form.linkedin), w = norm(form.website), so = norm(form.socials);
    const filled = [p, e, li, w, so].filter(Boolean).length;
    const hits = leads
      .map((l) => {
        if (editingId && l.id === editingId) return null;
        const why = [];
        if (p && normPhone(l.phone) === p) why.push("phone");
        if (e && norm(l.email) === e) why.push("email");
        if (li && norm(l.linkedin) === li) why.push("LinkedIn");
        if (w && norm(l.website) === w) why.push("website");
        if (so && norm(l.socials) === so) why.push("social handle");
        if (n && n.length > 3 && norm(l.name) === n) why.push("name");
        return why.length ? { lead: l, why } : null;
      })
      .filter(Boolean);
    return { filled, hits, anyInput: filled > 0 || n.length > 3 };
  }, [form.phone, form.email, form.linkedin, form.website, form.socials, form.name, leads, editingId]);

  const dupes = checks.hits;

  // which individual field is clashing, so the warning sits on the box itself
  const fieldHit = useMemo(() => {
    const out = {};
    const pairs = [
      ["phone", (l) => normPhone(l.phone), normPhone(form.phone)],
      ["email", (l) => norm(l.email), norm(form.email)],
      ["linkedin", (l) => norm(l.linkedin), norm(form.linkedin)],
      ["website", (l) => norm(l.website), norm(form.website)],
      ["socials", (l) => norm(l.socials), norm(form.socials)],
      ["name", (l) => norm(l.name), norm(form.name).length > 3 ? norm(form.name) : ""],
    ];
    pairs.forEach(([key, get, val]) => {
      if (!val) return;
      const m = leads.find((l) => (editingId ? l.id !== editingId : true) && get(l) === val);
      if (m) out[key] = m.name;
    });
    return out;
  }, [form.phone, form.email, form.linkedin, form.website, form.socials, form.name, leads, editingId]);

  const phoneState = useMemo(() => phoneCheck(form.phone), [form.phone]);

  const Warn = ({ k }) => fieldHit[k] ? (
    <span style={{ ...mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.danger, marginTop: 5 }}>
      Already used by {fieldHit[k]}
    </span>
  ) : null;

  const stats = useMemo(() => {
    const t = todayStr();
    const signed = leads.filter((l) => l.status === "signed");
    const withVol = signed.filter((l) => Number(l.volume) > 0);
    const monthly = withVol.reduce((a, l) => a + Number(l.volume || 0), 0);
    const byCorridor = {};
    withVol.forEach((l) => {
      const cs = listOf(l, "corridors", "corridorOther");
      if (!cs.length) return;
      const share = Number(l.volume) / cs.length;
      cs.forEach((c) => { byCorridor[c] = (byCorridor[c] || 0) + share; });
    });
    return {
      total: leads.length,
      signed: signed.length,
      talked: leads.filter((l) => l.talkedOn).length,
      monthly, annual: monthly * 12,
      avg: withVol.length ? Math.round(monthly / withVol.length) : 0,
      today: {
        dials: leads.filter((l) => l.dialedOn === t).length,
        talked: leads.filter((l) => l.talkedOn === t).length,
        signed: leads.filter((l) => l.signedOn === t).length,
      },
      corridors: Object.entries(byCorridor).sort((a, b) => b[1] - a[1]).slice(0, 6),
      followupsDue: leads.filter((l) => l.followupOn && l.followupOn <= t && l.status !== "signed" && l.status !== "dead").length,
    };
  }, [leads]);

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim();
    return leads
      .filter((l) =>
        filter === "all" ? true
        : filter === "due" ? l.followupOn && l.followupOn <= todayStr() && l.status !== "signed" && l.status !== "dead"
        : filter === "unsynced" ? l.status === "signed" && !l.syncedOn
        : l.status === filter
      )
      .filter((l) => !q ? true : [l.name, l.phone, l.email, l.linkedin, l.website, l.socials, l.skill, l.notes, (l.sources || []).join(" "), (l.corridors || []).join(" "), (l.tools || []).join(" "), l.sourceOther, l.corridorOther, l.toolOther].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (b.createdOn + b.id).localeCompare(a.createdOn + a.id));
  }, [leads, search, filter]);

  const toggle = (key, v) =>
    setForm((f) => ({ ...f, [key]: (f[key] || []).includes(v) ? f[key].filter((x) => x !== v) : [...(f[key] || []), v] }));

  const submit = async () => {
    if (!form.name.trim()) return flash("Name is required.");
    if (!form.phone.trim() && !form.email.trim() && !form.linkedin.trim() && !form.website.trim() && !form.socials.trim())
      return flash("Add a phone, email, LinkedIn, website or social handle so duplicates can be caught.");
    if (form.phone.trim() && !phoneState.ok)
      return flash(phoneState.why + ". We only take Indian mobile numbers.");
    if (!form.sources.length) return flash("Pick where you found them.");
    if (form.sources.includes("Other") && !form.sourceOther.trim()) return flash("Say where exactly you found them.");
    if (form.corridors.includes("Other") && !form.corridorOther.trim()) return flash("Name the country their clients pay from.");
    if (form.tools.includes("Other") && !form.toolOther.trim()) return flash("Name what they use to get paid today.");
    if (form.status === "signed" && !Number(form.volume))
      return flash("Monthly inbound is required before someone counts as on the waitlist.");
    if (form.status === "signed" && !form.corridors.length)
      return flash("Pick at least one country their clients pay from.");

    if (dupes.length && !confirmDupe && !editingId) {
      logDupe({ name: form.name, matched: dupes[0].lead.name, why: dupes[0].why.join(", "), action: "blocked" });
      return flash("Already in the list as " + dupes[0].lead.name + " (" + dupes[0].why.join(", ") + "). Tick the box to add anyway.");
    }
    if (dupes.length && confirmDupe && !editingId) {
      logDupe({ name: form.name, matched: dupes[0].lead.name, why: dupes[0].why.join(", "), action: "added anyway" });
    }

    const now = todayStr();
    const rec = { ...form, phone: phoneState.digits || "" };
    if (!rec.id) rec.id = "l_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    if (rec.status !== "new" && !rec.dialedOn) rec.dialedOn = now;
    if (["talked", "signed", "followup"].includes(rec.status) && !rec.talkedOn) rec.talkedOn = now;
    if (rec.status === "signed" && !rec.signedOn) rec.signedOn = now;

    const next = editingId ? leads.map((l) => (l.id === editingId ? rec : l)) : [rec, ...leads];
    await persist(next);
    setForm(emptyLead());
    setEditingId(null);
    setConfirmDupe(false);
    setShowForm(false);
    flash(editingId ? "Updated." : "Added.");

    if (rec.status === "signed" && !rec.syncedOn) syncOne(rec, next);
  };

  const quickStatus = async (id, status) => {
    const now = todayStr();
    let changed = null;
    const next = leads.map((l) => {
      if (l.id !== id) return l;
      const u = { ...l, status };
      if (!u.dialedOn && status !== "new") u.dialedOn = now;
      if (!u.talkedOn && ["talked", "signed", "followup"].includes(status)) u.talkedOn = now;
      if (!u.signedOn && status === "signed") u.signedOn = now;
      changed = u;
      return u;
    });
    await persist(next);
    if (status === "signed" && changed && !changed.syncedOn) {
      if (!Number(changed.volume)) return flash("Add their monthly inbound before this goes to the sheet.");
      syncOne(changed, next);
    }
  };

  const edit = (l) => {
    setForm(migrate(l)); setEditingId(l.id); setShowForm(true); setConfirmDupe(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = (id) => persist(leads.filter((l) => l.id !== id));

  const exportCsv = () => {
    const head = ["name", "phone", "email", "linkedin", "website", "socials", "sources", "skill", "corridors", "monthly_inr", "tools", "fee", "status", "followupOn", "notes", "createdOn", "signedOn"];
    const row = (l) => [
      l.name, l.phone, l.email, l.linkedin, l.website, l.socials,
      listOf(l, "sources", "sourceOther").join(" | "), l.skill,
      listOf(l, "corridors", "corridorOther").join(" | "), l.volume,
      listOf(l, "tools", "toolOther").join(" | "), l.fee,
      l.status, l.followupOn, l.notes, l.createdOn, l.signedOn,
    ];
    const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const csv = [head.join(","), ...leads.map((l) => row(l).map(esc).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "zendt-waitlist-" + todayStr() + ".csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const mono = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" };
  const label = { ...mono, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted };
  const input = { width: "100%", background: C.surface2, border: "1px solid " + C.border, borderRadius: 10, padding: "10px 12px", color: C.ink, fontFamily: "Cairo, system-ui, sans-serif", fontSize: 14, outline: "none", boxSizing: "border-box" };
  const card = { background: C.surface, border: "1px solid " + C.border, borderRadius: 14 };
  const btn = { ...mono, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", padding: "10px 18px", borderRadius: 999, border: "1px solid " + C.border, background: "transparent", color: C.ink2, cursor: "pointer", transition: "all 200ms ease" };
  const btnPrimary = { ...btn, background: C.warm, color: "#0A0A0A", border: "none", fontWeight: 600 };

  const Field = ({ children, k }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={label}>{k}</span>
      {children}
    </div>
  );

  const Chips = ({ options, selected, onPick }) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => {
        const on = (selected || []).includes(o);
        return (
          <button key={o} onClick={() => onPick(o)} style={{
            ...mono, fontSize: 10, letterSpacing: "0.05em", padding: "7px 12px", borderRadius: 999,
            border: "1px solid " + (on ? C.warm : C.border),
            background: on ? "rgba(232,183,150,0.12)" : "transparent",
            color: on ? C.warm : C.muted, cursor: "pointer", transition: "all 200ms ease",
          }}>{o}</button>
        );
      })}
    </div>
  );

  if (loading)
    return <div style={{ background: C.bg, color: C.muted, minHeight: 400, display: "grid", placeItems: "center", ...mono, fontSize: 12 }}>Loading waitlist\u2026</div>;

  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: "100vh", padding: "28px 20px 80px", fontFamily: "Cairo, system-ui, sans-serif" }}>
      <style>{`
        @import url('https://api.fontshare.com/v2/css?f[]=clash-display@400,500,600&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        input:focus, select:focus, textarea:focus { border-color: ${C.warm2} !important; }
        input::placeholder, textarea::placeholder { color: ${C.muted2}; }
        select option { background: ${C.surface2}; color: ${C.ink}; }
        .row:hover { background: ${C.line2}; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      `}</style>

      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16, paddingBottom: 22, borderBottom: "1px solid " + C.border }}>
          <div>
            <h1 style={{ fontFamily: "'Clash Display', system-ui", fontWeight: 500, fontSize: 30, letterSpacing: "-0.03em", margin: 0 }}>Freelancer waitlist</h1>
            <p style={{ color: C.muted, fontSize: 14, margin: "6px 0 0" }}>Every Indian freelancer we talk to, with the corridors and monthly inbound behind them.</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ ...mono, fontSize: 10, color: saveState === "error" ? C.danger : C.muted2, letterSpacing: "0.15em", textTransform: "uppercase" }}>
              {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : ""}
            </span>
            <button style={btn} onClick={() => setShowDupeLog((s) => !s)}>Duplicates {dupeLog.length ? "(" + dupeLog.length + ")" : ""}</button>
            <button style={btn} onClick={() => setShowSettings((s) => !s)}>Settings</button>
            <button style={btn} onClick={exportCsv}>Export CSV</button>
            <button style={btnPrimary} onClick={() => { setShowForm((s) => !s); setEditingId(null); setForm(emptyLead()); setConfirmDupe(false); }}>
              {showForm ? "Close" : "Add person"}
            </button>
          </div>
        </div>

        {showDupeLog && (
          <div style={{ ...card, marginTop: 20, padding: 22 }}>
            <div style={{ fontFamily: "'Clash Display', system-ui", fontSize: 18, letterSpacing: "-0.02em", marginBottom: 4 }}>Duplicates caught</div>
            <p style={{ color: C.muted, fontSize: 13, margin: "0 0 16px" }}>
              Every time a name already in the list came up again, and what happened next.
            </p>
            {dupeLog.length === 0 ? (
              <p style={{ color: C.muted2, fontSize: 14, margin: 0 }}>No repeats so far.</p>
            ) : (
              <div style={{ maxHeight: 280, overflowY: "auto" }}>
                {dupeLog.map((d, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid " + C.line2, fontSize: 13, flexWrap: "wrap" }}>
                    <span style={{ color: C.ink2 }}>{d.name} matched {d.matched}</span>
                    <span style={{ ...mono, fontSize: 10, color: d.action === "blocked" ? C.danger : C.warm2 }}>
                      {d.why} \u00B7 {d.action} \u00B7 {d.at}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showSettings && (
          <div style={{ ...card, marginTop: 20, padding: 22 }}>
            <div style={{ fontFamily: "'Clash Display', system-ui", fontSize: 18, letterSpacing: "-0.02em", marginBottom: 4 }}>Cloud save</div>
            <p style={{ color: C.muted, fontSize: 13, margin: "0 0 18px", maxWidth: 620 }}>
              The full list is stored in the cloud, so every device sees the same people. Anyone marked as on the waitlist is also written to the Zendt Waitlist sheet.
            </p>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button style={btn} onClick={syncAll} disabled={syncing}>{syncing ? "Sending\u2026" : "Send " + unsynced.length + " pending to sheet"}</button>
              <span style={{ ...mono, fontSize: 11, color: C.good }}>Cloud + sheet connected</span>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 1, background: C.border, border: "1px solid " + C.border, borderRadius: 14, overflow: "hidden", marginTop: 24 }}>
          {[
            { k: "Dials today", v: String(stats.today.dials), t: TARGETS.dials, raw: stats.today.dials },
            { k: "Conversations today", v: String(stats.today.talked), t: TARGETS.talked, raw: stats.today.talked },
            { k: "Signed up today", v: String(stats.today.signed), t: TARGETS.signed, raw: stats.today.signed },
            { k: "On waitlist", v: String(stats.signed), t: 100, raw: stats.signed },
            { k: "Monthly inbound", v: inrShort(stats.monthly) },
            { k: "Annualised", v: inrShort(stats.annual) },
          ].map((s) => (
            <div key={s.k} style={{ background: C.surface, padding: "16px 18px" }}>
              <div style={label}>{s.k}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
                <span style={{ fontFamily: "'Clash Display', system-ui", fontSize: 24, letterSpacing: "-0.03em", color: s.t && s.raw >= s.t ? C.warm : C.ink }}>{s.v}</span>
                {s.t ? <span style={{ ...mono, fontSize: 11, color: C.muted2 }}>/ {s.t}</span> : null}
              </div>
              {s.t ? (
                <div style={{ height: 2, background: C.line2, marginTop: 10, borderRadius: 999 }}>
                  <div style={{ height: 2, width: Math.min(100, (s.raw / s.t) * 100) + "%", background: "linear-gradient(90deg, " + C.warm + ", " + C.warm2 + ")", borderRadius: 999, transition: "width 220ms ease" }} />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {(stats.followupsDue > 0 || unsynced.length > 0) && (
          <div style={{ ...card, marginTop: 16, padding: "12px 16px", borderColor: C.warm2, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <span style={{ fontSize: 14, color: C.ink2 }}>
              {stats.followupsDue > 0 ? stats.followupsDue + " due for follow-up today. " : ""}
              {unsynced.length > 0 ? unsynced.length + " waiting to go to the sheet." : ""}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {stats.followupsDue > 0 && <button style={btn} onClick={() => setFilter("due")}>Show follow-ups</button>}
              {unsynced.length > 0 && <button style={btn} onClick={syncAll} disabled={syncing}>{syncing ? "Sending\u2026" : "Send to sheet"}</button>}
            </div>
          </div>
        )}

        {showForm && (
          <div style={{ ...card, marginTop: 20, padding: 22 }}>
            <div style={{ fontFamily: "'Clash Display', system-ui", fontSize: 18, letterSpacing: "-0.02em", marginBottom: 18 }}>{editingId ? "Edit person" : "New person"}</div>

            {checks.anyInput && !editingId && (
              <div style={{
                background: dupes.length ? "rgba(224,122,95,0.08)" : "rgba(143,191,159,0.06)",
                border: "1px solid " + (dupes.length ? C.danger : C.border),
                borderRadius: 12, padding: "14px 16px", marginBottom: 18,
              }}>
                <div style={{ ...mono, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: dupes.length ? C.danger : C.good, marginBottom: dupes.length ? 8 : 0 }}>
                  {dupes.length ? "Already in the list" : "Checked against " + leads.length + " people, no match"}
                </div>
                {dupes.slice(0, 4).map(({ lead: d, why }) => (
                  <div key={d.id} style={{ fontSize: 14, color: C.ink2, marginBottom: 5 }}>
                    {d.name} \u00B7 added {d.createdOn} \u00B7 matches on {why.join(", ")}
                    <button style={{ ...btn, padding: "3px 10px", marginLeft: 10, fontSize: 9 }} onClick={() => edit(d)}>Open</button>
                  </div>
                ))}
                {dupes.length > 0 && (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13, color: C.muted, cursor: "pointer" }}>
                    <input type="checkbox" checked={confirmDupe} onChange={(e) => setConfirmDupe(e.target.checked)} />
                    This is a different person, add anyway
                  </label>
                )}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <Field k="Name"><input style={{ ...input, borderColor: fieldHit.name ? C.danger : C.border }} value={form.name} placeholder="Full name" onChange={(e) => setForm({ ...form, name: e.target.value })} /><Warn k="name" /></Field>
              <Field k="Phone">
                <input style={{ ...input, borderColor: (fieldHit.phone || !phoneState.ok) ? C.danger : C.border }} value={form.phone} placeholder="98765 43210" inputMode="numeric" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                {!phoneState.ok && (
                  <span style={{ ...mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.danger, marginTop: 5 }}>{phoneState.why}</span>
                )}
                <Warn k="phone" />
              </Field>
              <Field k="Email"><input style={{ ...input, borderColor: fieldHit.email ? C.danger : C.border }} value={form.email} placeholder="name@email.com" onChange={(e) => setForm({ ...form, email: e.target.value })} /><Warn k="email" /></Field>
              <Field k="LinkedIn"><input style={{ ...input, borderColor: fieldHit.linkedin ? C.danger : C.border }} value={form.linkedin} placeholder="linkedin.com/in/\u2026" onChange={(e) => setForm({ ...form, linkedin: e.target.value })} /><Warn k="linkedin" /></Field>
              <Field k="Website or portfolio"><input style={{ ...input, borderColor: fieldHit.website ? C.danger : C.border }} value={form.website} placeholder="Behance, personal site, Upwork profile" onChange={(e) => setForm({ ...form, website: e.target.value })} /><Warn k="website" /></Field>
              <Field k="Social media"><input style={{ ...input, borderColor: fieldHit.socials ? C.danger : C.border }} value={form.socials} placeholder="@instagram, X, YouTube" onChange={(e) => setForm({ ...form, socials: e.target.value })} /><Warn k="socials" /></Field>
              <Field k="What they do"><input style={input} value={form.skill} placeholder="Video editor, backend dev\u2026" onChange={(e) => setForm({ ...form, skill: e.target.value })} /></Field>
              <Field k="Monthly inbound in rupees"><input style={input} type="number" value={form.volume} placeholder="180000" onChange={(e) => setForm({ ...form, volume: e.target.value })} /></Field>
              <Field k="Fee they pay now"><input style={input} value={form.fee} placeholder="4.5% plus fx markup" onChange={(e) => setForm({ ...form, fee: e.target.value })} /></Field>
              <Field k="Status">
                <select style={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
              </Field>
              <Field k="Follow up on"><input style={input} type="date" value={form.followupOn} onChange={(e) => setForm({ ...form, followupOn: e.target.value })} /></Field>
            </div>

            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 18 }}>
              <Field k="Where you found them, pick any">
                <Chips options={SOURCES} selected={form.sources} onPick={(v) => toggle("sources", v)} />
                {form.sources.includes("Other") && (
                  <input style={{ ...input, marginTop: 10 }} value={form.sourceOther} placeholder="Where exactly?" onChange={(e) => setForm({ ...form, sourceOther: e.target.value })} />
                )}
              </Field>
              <Field k="Clients pay from, pick any">
                <Chips options={CORRIDORS} selected={form.corridors} onPick={(v) => toggle("corridors", v)} />
                {form.corridors.includes("Other") && (
                  <input style={{ ...input, marginTop: 10 }} value={form.corridorOther} placeholder="Which country?" onChange={(e) => setForm({ ...form, corridorOther: e.target.value })} />
                )}
              </Field>
              <Field k="What they use today, pick any">
                <Chips options={TOOLS} selected={form.tools} onPick={(v) => toggle("tools", v)} />
                {form.tools.includes("Other") && (
                  <input style={{ ...input, marginTop: 10 }} value={form.toolOther} placeholder="What do they use?" onChange={(e) => setForm({ ...form, toolOther: e.target.value })} />
                )}
              </Field>
              <Field k="Notes from the call">
                <textarea style={{ ...input, minHeight: 80, resize: "vertical" }} value={form.notes} placeholder="What frustrates them about getting paid, what they asked about, anything to remember next time." onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "center", flexWrap: "wrap" }}>
              <button style={btnPrimary} onClick={submit}>{editingId ? "Save changes" : "Add to list"}</button>
              <button style={btn} onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyLead()); }}>Cancel</button>
              {form.status === "signed" && (
                <span style={{ fontSize: 12, color: C.muted }}>This goes to the sheet on save.</span>
              )}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...input, maxWidth: 300 }} value={search} placeholder="Search name, number, notes\u2026" onChange={(e) => setSearch(e.target.value)} />
          {[{ key: "all", label: "All" }, { key: "due", label: "Follow-ups due" }, ...STATUSES, { key: "unsynced", label: "Not in sheet" }].map((s) => (
            <button key={s.key} onClick={() => setFilter(s.key)} style={{ ...btn, padding: "7px 14px", fontSize: 10, borderColor: filter === s.key ? C.warm : C.border, color: filter === s.key ? C.warm : C.muted }}>
              {s.label}
            </button>
          ))}
        </div>

        <div style={{ ...card, marginTop: 16, overflow: "hidden" }}>
          {visible.length === 0 ? (
            <div style={{ padding: "60px 24px", textAlign: "center" }}>
              <div style={{ fontFamily: "'Clash Display', system-ui", fontSize: 18, color: C.ink2 }}>{leads.length === 0 ? "Nothing here yet" : "Nothing matches that"}</div>
              <p style={{ color: C.muted, fontSize: 14, marginTop: 8 }}>{leads.length === 0 ? "Add the first freelancer you speak to today." : "Try a different filter or search."}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                <thead>
                  <tr>
                    {["Name", "Found on", "Corridors", "Monthly inbound", "Uses today", "Status", "Sheet", "Follow up", ""].map((h) => (
                      <th key={h} style={{ ...label, textAlign: "left", padding: "12px 14px", borderBottom: "1px solid " + C.border, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((l) => (
                    <tr key={l.id} className="row" style={{ borderBottom: "1px solid " + C.line2, transition: "background 200ms ease" }}>
                      <td style={{ padding: "12px 14px", minWidth: 190 }}>
                        <div style={{ fontSize: 14, color: C.ink }}>{l.name}</div>
                        <div style={{ ...mono, fontSize: 10, color: C.muted2, marginTop: 3 }}>{[l.skill, l.phone || l.email].filter(Boolean).join(" \u00B7 ")}</div>
                        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                          {[["in", l.linkedin], ["web", l.website], ["social", l.socials]].filter(([, v]) => v).map(([k, v]) => (
                            <a key={k} href={v.startsWith("http") ? v : "https://" + v} target="_blank" rel="noreferrer"
                              style={{ ...mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.cool, textDecoration: "none" }}>{k}</a>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: "12px 14px", fontSize: 13, color: C.muted, maxWidth: 160 }}>{listText(l, "sources", "sourceOther")}</td>
                      <td style={{ padding: "12px 14px", fontSize: 13, color: C.ink2, maxWidth: 180 }}>{listText(l, "corridors", "corridorOther")}</td>
                      <td style={{ padding: "12px 14px", ...mono, fontSize: 13, color: l.volume ? C.warm : C.muted2, whiteSpace: "nowrap" }}>{l.volume ? inr(l.volume) : "\u2014"}</td>
                      <td style={{ padding: "12px 14px", fontSize: 13, color: C.muted, maxWidth: 170 }}>{listText(l, "tools", "toolOther")}{l.fee ? " \u00B7 " + l.fee : ""}</td>
                      <td style={{ padding: "12px 14px" }}>
                        <select value={l.status} onChange={(e) => quickStatus(l.id, e.target.value)}
                          style={{ ...mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", border: "1px solid " + statusColor(l.status), color: statusColor(l.status), borderRadius: 999, padding: "5px 10px", cursor: "pointer", outline: "none" }}>
                          {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                        {l.status !== "signed" ? <span style={{ ...mono, fontSize: 10, color: C.muted2 }}>\u2014</span>
                          : l.syncedOn ? <span style={{ ...mono, fontSize: 10, color: C.good }}>In sheet</span>
                          : <button style={{ ...btn, padding: "4px 10px", fontSize: 9, borderColor: C.warm2, color: C.warm2 }} onClick={() => syncOne(l)}>Send</button>}
                      </td>
                      <td style={{ padding: "12px 14px", ...mono, fontSize: 11, color: l.followupOn && l.followupOn <= todayStr() ? C.warm : C.muted2, whiteSpace: "nowrap" }}>{l.followupOn || "\u2014"}</td>
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap", textAlign: "right" }}>
                        <button style={{ ...btn, padding: "5px 12px", fontSize: 9 }} onClick={() => edit(l)}>Edit</button>
                        <button style={{ ...btn, padding: "5px 12px", fontSize: 9, marginLeft: 6, color: C.muted2 }} onClick={() => remove(l.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {stats.corridors.length > 0 && (
          <div style={{ ...card, marginTop: 20, padding: 22 }}>
            <div style={{ fontFamily: "'Clash Display', system-ui", fontSize: 18, letterSpacing: "-0.02em", marginBottom: 4 }}>Where the money comes from</div>
            <p style={{ color: C.muted, fontSize: 13, margin: "0 0 18px" }}>
              Monthly inbound on the waitlist by country. Anyone with clients in more than one country has their volume split evenly across them.
            </p>
            {stats.corridors.map(([name, v]) => (
              <div key={name} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: C.ink2 }}>{name}</span>
                  <span style={{ ...mono, color: C.warm }}>{inr(Math.round(v))}</span>
                </div>
                <div style={{ height: 3, background: C.line2, borderRadius: 999 }}>
                  <div style={{ height: 3, width: (v / stats.corridors[0][1]) * 100 + "%", background: "linear-gradient(90deg, " + C.warm + ", " + C.warm2 + ")", borderRadius: 999 }} />
                </div>
              </div>
            ))}
            <div style={{ borderTop: "1px solid " + C.border, marginTop: 18, paddingTop: 16, display: "flex", gap: 32, flexWrap: "wrap" }}>
              <div><div style={label}>Average per freelancer</div><div style={{ ...mono, fontSize: 18, color: C.ink, marginTop: 6 }}>{inr(stats.avg)}</div></div>
              <div><div style={label}>Conversations logged</div><div style={{ ...mono, fontSize: 18, color: C.ink, marginTop: 6 }}>{stats.talked}</div></div>
              <div><div style={label}>Total people in list</div><div style={{ ...mono, fontSize: 18, color: C.ink, marginTop: 6 }}>{stats.total}</div></div>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: C.surface, border: "1px solid " + C.border, borderRadius: 999, padding: "12px 22px", fontSize: 13, color: C.ink2, zIndex: 50, maxWidth: "90vw", textAlign: "center" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
