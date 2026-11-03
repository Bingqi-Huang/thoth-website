import "./styles.css";
import { MissionConsole } from "./console";
import { loadBounds } from "./minimap";
import { Run, Scenario, System } from "./types";

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const GROUP: Record<string, string> = { reference: "Reference", contingency: "Contingency", sequential: "Sequential faults", identity: "Serial identity" };
const CHIPS: [string, string][] = [
  ["no-spare", "PDU-1 down, no spare in storage"],
  ["occupied-destination", "Deliver to an occupied stand"],
  ["pdu1-shutter", "PDU-1 overheats"],
  ["bess-battery", "BESS battery module failed"],
  ["isru-filter", "Oxygen plant filter clogged"],
  ["sequential-faults", "BESS fails again after the repair"],
  ["serial-mislocated", "Deliver ORU-0417 by its serial"],
  ["locate-fault", "Fault reported at the wrong unit"],
  ["deliver-battery", "Deliver a battery module"],
  ["restore-pdu2", "Reset PDU-2"],
];
const STOP = new Set("a an the to of and or in on at is are be it its with from for my our please can you then that this".split(" "));

let scenarios: Scenario[] = [];
const con = new MissionConsole();

function playable(sc: Scenario) { return sc.runs.some(r => r.system === "thoth"); }

function match(q: string): { sc: Scenario; score: number } | null {
  const words = q.toLowerCase().replace(/[^a-z0-9\- ]/g, " ").split(/\s+/).filter(w => w && !STOP.has(w));
  if (!words.length) return null;
  let best: { sc: Scenario; score: number } | null = null;
  for (const sc of scenarios) {
    if (!playable(sc)) continue;
    const hay = `${sc.keywords} ${sc.title} ${sc.condition}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (hay.split(/[\s.,;]+/).includes(w)) score += /\d/.test(w) ? 3 : 2;
      else if (w.length > 3 && hay.includes(w.slice(0, -1))) score += 1;
    }
    if (sc.group !== "reference") score += 0.1;
    if (!best || score > best.score) best = { sc, score };
  }
  return best && best.score >= 2 ? best : null;
}

function runScenario(sc: Scenario, scroll = true) {
  document.querySelectorAll(".chip").forEach(c => c.classList.toggle("on", (c as HTMLElement).dataset.id === sc.id));
  $("match-note").innerHTML = `Replaying recorded run · <b>${esc(sc.title)}</b> · ${esc(sc.condition)}`;
  if (scroll) scrollTo({ top: document.querySelector(".prompt")!.getBoundingClientRect().top + scrollY - 76, behavior: "smooth" });
  con.load(sc, sc.runs.find(r => r.system === "thoth")!.id);
}

function submitPrompt() {
  const q = ($("prompt-input") as HTMLInputElement).value.trim();
  if (!q) return;
  const m = match(q);
  if (!m) {
    $("match-note").innerHTML = `No recorded run matches that mission. Missions on this base are maintenance of PDU-1/2/3, BESS and ISRU, or deliveries; try one of the suggestions.`;
    return;
  }
  runScenario(m.sc, true);
}

function renderChips() {
  $("prompt-chips").innerHTML = CHIPS.map(([id, label]) => {
    const sc = scenarios.find(s => s.id === id)!;
    return `<button class="chip" data-id="${id}"><span class="g">${sc.group === "reference" ? "ref" : "new"}</span>${esc(label)}</button>`;
  }).join("");
  document.querySelectorAll<HTMLElement>(".chip").forEach(c => c.onclick = () => {
    const sc = scenarios.find(s => s.id === c.dataset.id)!;
    ($("prompt-input") as HTMLInputElement).value = c.textContent!.replace(/^(ref|new)/, "");
    runScenario(sc, true);
  });
  $("prompt-run").onclick = submitPrompt;
  $("prompt-input").addEventListener("keydown", e => { if ((e as KeyboardEvent).key === "Enter") submitPrompt(); });
}

function renderCards(group = "all") {
  const box = $("cards");
  box.innerHTML = scenarios.filter(s => group === "all" || s.group === group).map(sc => {
    const thoth = sc.runs.find(r => r.system === "thoth");
    const res = (["thoth", "plexil", "europa"] as System[]).map(sys => {
      const r = sc.runs.find(x => x.system === sys);
      const nm = { thoth: "Thoth", plexil: "PLEXIL", europa: "EUROPA" }[sys];
      if (sc.group === "reference" && sys !== "thoth") return "";
      if (!r) return `<span class="na">${nm} –</span>`;
      return `<span><b class="${r.success ? "ok" : "fail"}">${r.success ? "✓" : "✕"}</b> ${nm}</span>`;
    }).join("");
    return `<article class="sc${thoth ? "" : " soon"}" data-id="${sc.id}">
      <div class="thumb" style="${thoth ? `background-image:url(media/posters/${thoth.id}.webp)` : ""}">
        ${thoth ? `<video muted loop playsinline preload="none" data-src="media/preview/${thoth.id}.mp4"></video>` : ""}
        <span class="tag">${GROUP[sc.group]} · ${sc.family}</span></div>
      <div class="body"><h3>${esc(sc.title)}</h3><p>${esc(sc.condition)}</p><div class="res">${res}</div></div></article>`;
  }).join("");
  box.querySelectorAll<HTMLElement>(".sc").forEach(card => {
    const sc = scenarios.find(s => s.id === card.dataset.id)!;
    const v = card.querySelector("video");
    if (v) {
      card.addEventListener("mouseenter", () => {
        if (!v.src) { v.src = v.dataset.src!; v.addEventListener("canplay", () => v.classList.add("ready"), { once: true }); }
        v.play().catch(() => {});
      });
      card.addEventListener("mouseleave", () => v.pause());
      card.onclick = () => runScenario(sc);
    }
  });
}

function renderResults() {
  const rows: [string, string, string, string, string][] = [
    ["grp", "Reference scenarios", "", "", ""],
    ["restore-pdu2", "Seven standard maintenance and delivery missions", "7/7", "7/7", "7/7"],
    ["grp", "Operational contingencies", "", "", ""],
    ["pdu1-shutter", "PDU-1: closed shutter", "3/3", "0/1→1/1", "0/1→1/1"],
    ["bess-shutter", "BESS: closed shutter", "3/3", "0/1→1/1", "0/1→1/1"],
    ["bess-battery", "BESS: failed battery module", "3/3", "0/1→1/1", "0/1→1/1"],
    ["isru-filter", "ISRU: clogged filter", "3/3", "0/1→1/1", "0/1→1/1"],
    ["occupied-destination", "Habitat: occupied destination", "3/3", "0/1→1/1", "0/1→1/1"],
    ["no-spare", "PDU-1: no serviceable spare", "3/3", "0/1→1/1", "0/1→1/1"],
    ["grp", "Sequential faults and serial identity", "", "", ""],
    ["sequential-faults", "BESS: sequential faults", "3/3", "0/1", "1/1"],
    ["serial-mislocated", "Serial ID: mislocated item", "0/1→3/3", "0/1→1/1", "0/1→1/1"],
    ["serial-swapped", "Serial ID: swapped records", "0/1→3/3", "0/1→1/1", "0/1→1/1"],
  ];
  const cell = (s: string) => {
    if (!s) return "";
    const parts = s.split("→");
    const cls = (x: string) => (x.startsWith("0/") ? "fail" : "ok");
    return `<span class="score">${parts.map(p => `<span class="${cls(p)}">${p}</span>`).join(`<span class="arrow">→</span>`)}</span>`;
  };
  $("res-table").innerHTML = `<table><thead><tr><th>Task condition</th><th class="n">Thoth</th><th class="n">PLEXIL</th><th class="n">EUROPA→PLEXIL</th></tr></thead><tbody>` +
    rows.map(([id, name, a, b, c]) => id === "grp" ? `<tr class="grp"><td colspan="4">${name}</td></tr>` :
      `<tr class="${scenarios.find(s => s.id === id && playable(s)) ? "click" : ""}" data-id="${id}"><td>${name}</td><td class="n">${cell(a)}</td><td class="n">${cell(b)}</td><td class="n">${cell(c)}</td></tr>`).join("") +
    `</tbody></table><p class="muted" style="font-size:12.5px;margin-top:14px">Arrows: before → after the baseline task model was revised by an engineer, or before → after serial reading was registered. Click a row to replay it.</p>`;
  $("res-table").querySelectorAll<HTMLElement>("tr.click").forEach(tr => tr.onclick = () => runScenario(scenarios.find(s => s.id === tr.dataset.id)!));
  const bars = (id: string, data: [string, string, number, string][], max: number) => {
    $(id).innerHTML = data.map(([nm, cls, v, lbl]) => `<div class="bar"><span class="nm">${nm}</span><span class="track"><span class="fill ${cls}" data-w="${(v / max) * 100}"></span><span class="val" data-l="${(v / max) * 100}" style="left:0">${lbl}</span></span></div>`).join("");
  };
  bars("ext-chart", [["Thoth", "thoth", 4.7, "4.7 min · 52 lines"], ["PLEXIL", "plexil", 10.8, "10.8 min · 136 lines"], ["EUROPA→PLEXIL", "europa", 20.8, "20.8 min · 141 lines"]], 36);
  bars("dur-chart", [["Thoth", "thoth", 538, "538 s"], ["PLEXIL", "plexil", 264, "264 s"], ["EUROPA→PLEXIL", "europa", 265, "265 s"]], 760);
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.querySelectorAll<HTMLElement>(".fill").forEach(f => f.style.width = `${f.dataset.w}%`);
    e.target.querySelectorAll<HTMLElement>(".val").forEach(f => f.style.left = `calc(${f.dataset.l}% + 8px)`);
    io.unobserve(e.target);
  }), { threshold: 0.4 });
  document.querySelectorAll(".bars").forEach(b => io.observe(b));
}

async function renderHow() {
  const svg = $("how-svg");
  const N = [
    { k: "MISSION AGENT", l: "Foundation model", x: 30, y: 30 },
    { k: "PERMISSION", l: "Γ: allow · deny · hold", x: 290, y: 30 },
    { k: "CAPABILITY", l: "Robot skill + sensors", x: 290, y: 250 },
    { k: "VERIFIER", l: "verified · refuted · unverified", x: 30, y: 250 },
  ];
  let html = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="rgba(160,180,210,.5)"/></marker></defs>`;
  const edges = ["M230 70 L288 70", "M390 112 L390 248", "M288 292 L232 292", "M130 248 L130 112"];
  edges.forEach((d, i) => html += `<path class="edge" id="e${i}" d="${d}" marker-end="url(#ah)"/>`);
  html += `<rect x="150" y="150" width="220" height="62" rx="10" fill="none" stroke="rgba(160,180,210,.2)" stroke-dasharray="4 4"/>
    <text x="260" y="176" text-anchor="middle" style="font:10px var(--mono);fill:var(--text-3);letter-spacing:.1em">EVENT RECORD</text>
    <text x="260" y="196" text-anchor="middle" style="font:12.5px var(--sans);fill:var(--text-2)">append-only · rebuilds each decision</text>`;
  N.forEach((n, i) => html += `<g class="node" id="n${i}"><rect x="${n.x}" y="${n.y}" width="200" height="82" rx="12"/><text class="k" x="${n.x + 18}" y="${n.y + 30}">${n.k}</text><text x="${n.x + 18}" y="${n.y + 56}">${n.l}</text></g>`);
  html += `<g id="earth"><rect x="290" y="372" width="200" height="50" rx="10" fill="none" stroke="rgba(165,139,255,.45)"/><text x="306" y="402" style="font:12.5px var(--sans);fill:var(--earth)">Mission control · grants</text></g>
    <path class="edge" d="M390 370 L390 336" marker-end="url(#ah)" style="stroke:rgba(165,139,255,.45)"/>
    <circle class="pulse" r="4" id="pulse"><animateMotion id="pm" dur="1.6s" repeatCount="indefinite" path="M230 70 L288 70"/></circle>`;
  svg.innerHTML = html;
  const run = await (await fetch("data/runs/ours_l4_pdu1_r1.json")).json() as Run;
  const pick = (k: string, f: (e: any) => boolean = () => true) => run.events.find(e => e.k === k && f(e))!;
  const p = pick("tool_proposed", e => e.tool === "press"), g = pick("approval_pending"), x = pick("execution_finished", e => e.tool === "pick" && e.ok), v = pick("effect_verified", e => e.tool === "press");
  const samples = [
    `<div class="card"><div class="ch"><span class="tool">${p.tool}</span><span class="t">recorded · no-spare repair</span></div><div class="args">feature=pdu_1_panel/press</div><div class="why">${esc(p.why)}</div></div>`,
    `<div class="card"><div class="ch"><span class="tool">pick</span><span class="t">recorded · no-spare repair</span></div><div class="row"><span class="k">permit</span><span class="v"><span class="pill hold">hold</span> ${esc(g.reason)}</span></div></div>`,
    `<div class="card"><div class="ch"><span class="tool">${x.tool}</span><span class="t">recorded · no-spare repair</span></div><div class="row"><span class="k">skill</span><span class="v"><span class="pill ok">reported success</span> grasp, lift and carry posture reached</span></div></div>`,
    `<div class="card"><div class="ch"><span class="tool">press</span><span class="t">recorded · no-spare repair</span></div><div class="row"><span class="k">effect</span><span class="v"><span class="pill ${v.verdict}">${v.verdict}</span> ${esc(v.effect)}<br><span class="muted">${esc(Object.entries(v.facts).slice(0, 4).map(([k, val]) => `${k.replace(/_/g, " ")} ${val}`).join(" · "))}</span></span></div></div>`,
  ];
  const set = (i: number) => {
    document.querySelectorAll("#how-steps li").forEach((li, j) => li.classList.toggle("on", i === j));
    N.forEach((_, j) => $(`n${j}`).classList.toggle("on", i === j));
    $("pm").setAttribute("path", edges[i]);
    $("how-sample").innerHTML = samples[i];
  };
  set(0);
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) set(+(e.target as HTMLElement).dataset.step!); }), { rootMargin: "-45% 0px -45% 0px" });
  document.querySelectorAll<HTMLElement>("#how-steps li").forEach(li => { io.observe(li); li.onclick = () => set(+li.dataset.step!); });
}

function chrome() {
  const nav = document.querySelector(".nav")!;
  addEventListener("scroll", () => nav.classList.toggle("solid", scrollY > 40), { passive: true });
  document.querySelectorAll(".section-head, .sc, .trust-card, .res-card, .how-steps li, .code, .layout").forEach(el => el.classList.add("reveal"));
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach(el => io.observe(el));
  document.querySelectorAll<HTMLElement>("[data-jump]").forEach(a => a.onclick = ev => {
    ev.preventDefault();
    runScenario(scenarios.find(s => s.id === a.dataset.jump)!);
  });
  document.querySelectorAll<HTMLElement>("#filters button").forEach(b => b.onclick = () => {
    document.querySelectorAll("#filters button").forEach(x => x.classList.toggle("on", x === b));
    renderCards(b.dataset.g);
    document.querySelectorAll("#cards .sc").forEach(el => el.classList.add("in"));
  });
  document.querySelectorAll<HTMLElement>(".copy").forEach(b => b.onclick = () => {
    navigator.clipboard.writeText($(b.dataset.copy!).innerText).then(() => { b.textContent = "Copied"; setTimeout(() => b.textContent = "Copy", 1500); });
  });
}

async function main() {
  [scenarios] = await Promise.all([fetch("data/scenarios.json").then(r => r.json()), loadBounds()]);
  renderChips();
  renderCards();
  renderResults();
  chrome();
  renderHow();
}
main();
