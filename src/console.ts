import { Ev, Run, Scenario, SYSTEM_NAME, System, Unit } from "./types";
import { Minimap } from "./minimap";
import { VIDEO_BASE } from "./config";

const EARTH_SET = 925;          // sim s: direct Earth visibility ends
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const clock = (t: number) => {
  const s = Math.max(0, t), m = Math.floor(s / 60);
  return `T+${String(m).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
const fmtArgs = (a: any) => {
  if (!a || typeof a !== "object") return "";
  return Object.entries(a).map(([k, v]) => {
    let s = typeof v === "string" ? v : JSON.stringify(v);
    if (Array.isArray(v)) s = `[${v.length} items]`;
    if (s.length > 90) s = s.slice(0, 88) + "…";
    return `${k}=${s}`;
  }).join("  ");
};
const PRETTY: Record<string, string> = {
  hold_reauthoring_required: "hold: new procedure required", grant: "granted", new_procedure: "new procedure",
  authorization: "authorization", information: "information",
};

interface Item { kind: string; t: number; e: Ev; subs: Ev[] }

function buildItems(run: Run): Item[] {
  const items: Item[] = [];
  let cur: Item | null = null;
  for (const e of run.events) {
    switch (e.k) {
      case "tool_proposed": case "call":
        cur = { kind: "step", t: e.t, e, subs: [] }; items.push(cur); break;
      case "guard_decision": case "approval_pending": case "execution_started": case "execution_finished":
      case "effect_verified": case "query_answered": case "local_tool": case "result":
        if (cur) cur.subs.push(e); break;
      case "mission_received": items.push({ kind: "mission", t: e.t, e, subs: [] }); break;
      case "reasoner_step_failed": items.push({ kind: "fail", t: e.t, e, subs: [] }); cur = null; break;
      case "operator_request_sent": case "escalate": items.push({ kind: "earth-out", t: e.t, e, subs: [] }); break;
      case "operator_answered": case "ground": items.push({ kind: "earth-in", t: e.t, e, subs: [] }); break;
      case "approval_granted": items.push({ kind: "grant", t: e.t, e, subs: [] }); break;
      case "operator_report": items.push({ kind: "report", t: e.t, e, subs: [] }); break;
      case "plan": items.push({ kind: "planner", t: e.t, e, subs: [] }); break;
      case "no_plan": items.push({ kind: "noplan", t: e.t, e, subs: [] }); break;
      case "node": if (e.state === "EXECUTING") items.push({ kind: "node", t: e.t, e, subs: [] }); break;
    }
  }
  return items;
}

function stepNumber(run: Run, e: Ev) {
  let n = 0;
  for (const x of run.events) { if (x.k === "tool_proposed" || x.k === "call") n++; if (x === e) return n; }
  return n;
}

export class MissionConsole {
  run: Run | null = null;
  scenario: Scenario | null = null;
  items: Item[] = [];
  video = $<HTMLVideoElement>("video");
  map = new Minimap($("minimap") as unknown as SVGSVGElement);
  rate = 4;
  lastIdx = -1;
  lastT = 0;
  renderedItems = 0;
  planIds = new Set<string>();
  unitsKey = "";
  flashTimer = 0;
  authShown = new Set<number>();
  playing = false;
  cache = new Map<string, Run>();

  constructor() {
    $("play").onclick = () => this.toggle();
    $("prev-ev").onclick = () => this.jump(-1);
    $("next-ev").onclick = () => this.jump(1);
    const sp = $<HTMLInputElement>("speed");
    sp.oninput = () => this.setRate(this.sliderToRate(+sp.value));
    this.setRate(this.sliderToRate(+sp.value));
    const tl = $("timeline");
    let drag = false;
    const seek = (ev: PointerEvent) => {
      if (!this.run) return;
      const r = tl.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      this.seek(this.run.video.t0 + f * (this.run.video.t1 - this.run.video.t0));
    };
    tl.addEventListener("pointerdown", ev => { drag = true; tl.setPointerCapture(ev.pointerId); seek(ev); });
    tl.addEventListener("pointermove", ev => { if (drag) seek(ev); });
    tl.addEventListener("pointerup", () => { drag = false; });
    this.video.addEventListener("ended", () => this.setPlaying(false));
    this.video.addEventListener("error", () => {
      if (!this.run || !this.video.getAttribute("src") || this.retryTimer) return;
      if (this.light && this.video.src.includes(".sd.mp4") && this.video.readyState === 0) { this.light = false; this.noLight = true; }
      this.recover();
    });
    $("cam").addEventListener("error", () => { const c = $<HTMLVideoElement>("cam"); const t = c.currentTime; c.src = c.src.split("?")[0] + `?r=${Date.now() % 1000}`; c.onloadedmetadata = () => { c.currentTime = t; }; });
    const feed = $("feed");
    feed.addEventListener("wheel", () => requestAnimationFrame(() => { this.stick = feed.scrollTop + feed.clientHeight > feed.scrollHeight - 40; }), { passive: true });
    feed.addEventListener("touchmove", () => { this.stick = feed.scrollTop + feed.clientHeight > feed.scrollHeight - 40; }, { passive: true });
    feed.addEventListener("click", ev => { const c = (ev.target as HTMLElement).closest(".clamp"); if (c) { c.classList.toggle("open"); this.stick = false; } });
    $("q-btn").onclick = () => { if (!this.run) return; this.light = !this.light; this.setSource(this.lastT - this.run.video.t0, 0); };
    $("auth-grant").onclick = () => this.closeAuth(true);
    $("auth-later").onclick = () => this.closeAuth(false);
    document.addEventListener("keydown", ev => {
      if (!this.run || (ev.target as HTMLElement).tagName === "INPUT") return;
      if (!this.inView()) return;
      if (ev.code === "Space") { ev.preventDefault(); this.toggle(); }
      if (ev.code === "ArrowRight") { ev.preventDefault(); this.jump(1); }
      if (ev.code === "ArrowLeft") { ev.preventDefault(); this.jump(-1); }
    });
    const loop = () => { this.tick(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // The two camera windows are one stacked video (front over wrist), drawn into two canvases. It plays alongside the
  // replay at the same rate and is only re-seeked when it drifts, so it costs one download and almost no requests.
  syncCams(t: number, force: boolean) {
    const run = this.run!;
    if (!run.cams) return;
    const c = $<HTMLVideoElement>("cam");
    const target = Math.max(0, t - run.cams.t0);
    if (c.readyState >= 1) {
      if (c.playbackRate !== this.video.playbackRate) c.playbackRate = this.video.playbackRate;
      const shouldPlay = !this.video.paused && !this.stalled;
      if (shouldPlay && c.paused) c.play().catch(() => {});
      if (!shouldPlay && !c.paused) c.pause();
      if (force || Math.abs(c.currentTime - target) > 1.5) c.currentTime = target;
    }
  }
  drawCams() {
    const c = $<HTMLVideoElement>("cam");
    if (!this.run?.cams || c.readyState < 2) return;
    for (const [id, y] of [["cam-front", 0], ["cam-wrist", 360]] as [string, number][]) {
      ($(id) as unknown as HTMLCanvasElement).getContext("2d")!.drawImage(c, 0, y, 480, 360, 0, 0, 480, 360);
    }
  }

  // Source choice and stall recovery. The media host hands out signed links that expire; a player that keeps using
  // an expired link stalls for good, so a stall of more than a few seconds or an error reloads the source where it was.
  // Two stalls in one replay switch to the light 960x540 version for the rest of the visit.
  light = false;
  noLight = false;
  stalled = false;
  stallSince = 0;
  stalls = 0;
  lastProgress = 0;
  lastVT = -1;
  srcFor(run: Run) {
    const v = this.video, b = `${VIDEO_BASE}${run.id}`;
    if (this.light) return `${b}.sd.mp4`;
    if (v.canPlayType('video/mp4; codecs="av01.0.08M.08"') === "probably") return `${b}.av1.mp4`;
    if (v.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"')) return `${b}.hevc.mp4`;
    return `${b}.sd.mp4`;
  }
  // Reload the source where the replay was (a fresh request gets a fresh signed link), backing off 1, 2, 4 ... 15 s
  // between attempts and never giving up; the replay's clock holds still meanwhile.
  recovering = false;
  retryTimer = 0;
  retries = 0;
  recover() {
    const at = this.lastT - this.run!.video.t0;
    this.recovering = true;
    $("hud-buf").classList.add("on");
    const wait = Math.min(15000, 1000 * 2 ** this.retries);
    this.retries++;
    this.retryTimer = window.setTimeout(() => { this.retryTimer = 0; this.setSource(at, this.retries); }, this.retries === 1 ? 0 : wait);
  }
  setSource(resume: number | null, retry = 0) {
    const run = this.run!, v = this.video;
    $("q-btn").textContent = this.light ? "SD" : "HD";
    v.removeAttribute("src");
    v.src = this.srcFor(run) + (retry ? `?r=${retry}` : "");
    v.playbackRate = this.rate;
    v.onloadedmetadata = () => {
      v.playbackRate = this.rate;
      if (resume !== null) v.currentTime = resume;
      this.recovering = false;
      if (this.playing) v.play().catch(() => {});
    };
    this.lastProgress = performance.now();
  }
  winStart = 0;
  winStalled = 0;
  lastTick = 0;
  watchdog() {
    const v = this.video, now = performance.now(), dt = now - (this.lastTick || now);
    this.lastTick = now;
    if (!this.playing || v.ended || !$("auth").hidden) { this.stalled = false; $("hud-buf").classList.remove("on"); this.lastProgress = now; this.winStart = now; this.winStalled = 0; return; }
    if (v.currentTime !== this.lastVT) { this.lastVT = v.currentTime; this.lastProgress = now; if (!this.recovering && v.readyState >= 3) this.retries = 0; }
    this.stalled = now - this.lastProgress > 600;
    $("hud-buf").classList.toggle("on", this.stalled);
    // the link cannot keep up: over a 20 s window, more than a quarter of it spent waiting
    if (this.stalled) this.winStalled += dt;
    if (now - this.winStart > 20000) {
      if (this.winStalled > 5000 && !this.light && !this.noLight && !this.recovering) { this.light = true; this.setSource(this.lastT - this.run!.video.t0, 0); }
      this.winStart = now; this.winStalled = 0;
    }
    if (now - this.lastProgress > 6000 && !this.retryTimer) {
      this.stalls++;
      if (this.stalls >= 2 && !this.light && !this.noLight) this.light = true;
      this.recover();
    }
  }

  stick = true;
  stickBottom() {
    const feed = $("feed");
    if (!this.stick) return;
    feed.scrollTop = feed.scrollHeight;
    feed.querySelectorAll("img:not([data-w])").forEach(img => {
      (img as HTMLElement).dataset.w = "1";
      img.addEventListener("load", () => { if (this.stick) feed.scrollTop = feed.scrollHeight; }, { once: true });
    });
  }

  inView() {
    const r = $("con").getBoundingClientRect();
    return r.top < innerHeight * 0.6 && r.bottom > innerHeight * 0.4;
  }

  sliderToRate(v: number) { return Math.round(0.5 * Math.pow(32, v / 1000) * 100) / 100; }   // 0.5x .. 16x, continuous
  setRate(r: number) {
    this.rate = r;
    this.video.playbackRate = r;
    $("speed-val").textContent = `×${r < 10 ? r.toFixed(r < 1 ? 2 : 1).replace(/\.0$/, "") : Math.round(r)}`;
  }

  async load(sc: Scenario, runId: string, autoplay = true) {
    const ref = sc.runs.find(r => r.id === runId);
    if (!ref) return;
    const system = ref.system;
    let run = this.cache.get(ref.id);
    if (!run) {
      run = await (await fetch(`data/runs/${ref.id}.json`)).json() as Run;
      this.cache.set(ref.id, run);
    }
    this.scenario = sc; this.run = run;
    this.items = buildItems(run);
    this.lastIdx = -1; this.renderedItems = 0; this.stick = true; this.planIds.clear(); this.unitsKey = ""; this.authShown.clear();
    $("feed").innerHTML = ""; $("plan").innerHTML = ""; $("units").innerHTML = "";
    $("con").classList.remove("idle");
    const name = ref.label ?? SYSTEM_NAME[system];
    const badge = $("sys-badge"); badge.textContent = name; badge.className = `badge ${system}`;
    $("hud-sys").textContent = `${name} · recorded run`;
    const mission = run.events.find(e => e.k === "mission_received");
    $("mission-text").textContent = mission ? mission.text : `${sc.title}. ${sc.condition}`;
    $("plan-h").textContent = system === "thoth" ? "Working plan" : system === "plexil" ? "Procedure" : "Planner output";
    $("plan-hint").textContent = system === "thoth" ? "written by the agent" : system === "plexil" ? "authored before the mission" : "from the EUROPA task domain";
    $("units-strip").style.display = run.events.some(e => e.units) ? "" : "none";
    this.renderTabs();
    this.map.setRun(run);
    this.renderMarks();
    this.video.pause();
    this.stalls = 0; this.retries = 0; this.recovering = false;
    clearTimeout(this.retryTimer); this.retryTimer = 0;
    this.setSource(null);
    const cams = $("cams");
    cams.classList.toggle("off", !run.cams);
    const cam = $<HTMLVideoElement>("cam");
    cam.src = run.cams ? `${VIDEO_BASE}cams/${run.id}.mp4` : "";
    this.lastT = run.video.t0;
    this.update(run.video.t0, true);
    if (autoplay) { this.setPlaying(true); }
  }

  renderTabs() {
    const sc = this.scenario!, tabs = $("sys-tabs");
    tabs.innerHTML = "";
    if (sc.group === "reference") return;
    const refs = [...sc.runs];
    for (const s of ["plexil", "europa"] as System[]) if (!refs.some(r => r.system === s)) refs.push({ id: "", system: s, label: null, duration: 0, success: null });
    for (const ref of refs) {
      const b = document.createElement("button");
      b.className = `sys-tab${this.run!.id === ref.id ? " on" : ""}${ref.id ? "" : " missing"}`;
      const res = ref.id ? (ref.success ? `<span class="res ok">mission complete</span>` : `<span class="res fail">mission failed</span>`) : `<span class="res">replay rendering</span>`;
      b.innerHTML = `${esc(ref.label ?? SYSTEM_NAME[ref.system])} ${res}`;
      if (ref.id) b.onclick = () => { if (this.run!.id !== ref.id) this.load(sc, ref.id); };
      tabs.appendChild(b);
    }
  }

  renderMarks() {
    const run = this.run!, span = run.video.t1 - run.video.t0, marks = $("tl-marks");
    const pos = (t: number) => `${((t - run.video.t0) / span) * 100}%`;
    let html = "";
    for (const e of run.events) {
      let c = "";
      if (e.k === "approval_pending") c = "hold";
      else if (e.k === "effect_verified" && e.verdict !== "verified") c = e.verdict;
      else if (e.k === "result" && !e.ok) c = "refuted";
      else if (["operator_request_sent", "operator_answered", "escalate", "ground"].includes(e.k)) c = "earth";
      else if (e.k === "ledger_changed" || e.k === "plan") c = "plan";
      if (c) html += `<i class="${c}" style="left:${pos(e.t)}" title="${clock(e.t)}"></i>`;
    }
    if (EARTH_SET < run.video.t1) html += `<i class="cutoff" style="left:${pos(EARTH_SET)}" title="Earth sets"></i>`;
    marks.innerHTML = html;
  }

  toggle() { this.setPlaying(!this.playing); }
  setPlaying(p: boolean) {
    this.playing = p;
    $("play-icon").setAttribute("d", p ? "M6 5h4v14H6zM14 5h4v14h-4z" : "M8 5v14l11-7z");
    if (!this.run) return;
    if (p) { if (this.video.ended) this.video.currentTime = 0; this.video.play().catch(() => this.setPlaying(false)); }
    else this.video.pause();
  }

  simTime() { return this.run ? this.run.video.t0 + this.video.currentTime : 0; }

  seek(t: number) {
    const run = this.run!;
    this.stick = true;
    t = Math.min(run.video.t1, Math.max(run.video.t0, t));
    this.video.currentTime = t - run.video.t0;
    this.update(t, true);
  }

  jump(dir: number) {
    if (!this.run) return;
    const t = this.simTime();
    const ts = this.items.map(i => i.t);
    if (dir > 0) { const n = ts.find(x => x > t + 0.05); if (n !== undefined) this.seek(n + 0.01); }
    else { const p = ts.filter(x => x < t - 1.0).pop(); this.seek(p !== undefined ? p + 0.01 : this.run.video.t0); }
  }

  tick() {
    if (!this.run) return;
    this.watchdog();
    if (this.recovering) return;
    this.drawCams();
    const t = this.simTime();
    if (Math.abs(t - this.lastT) > 1e-3) this.update(t, false);
  }

  update(t: number, seeked: boolean) {
    const run = this.run!;
    const forward = !seeked && t >= this.lastT;
    this.lastT = t;
    // clock, link, timeline
    $("hud-clock").textContent = clock(t);
    const link = $("hud-link");
    if (t < EARTH_SET) { link.textContent = innerWidth < 860 ? `Earth ${Math.ceil(EARTH_SET - t)} s` : `Earth link · 4.27 s · sets in ${Math.ceil(EARTH_SET - t)} s`; link.classList.remove("lost"); }
    else { link.textContent = "Earth below horizon"; link.classList.add("lost"); }
    const f = (t - run.video.t0) / (run.video.t1 - run.video.t0);
    $("tl-fill").style.width = `${f * 100}%`;
    $("tl-head").style.left = `${f * 100}%`;
    this.map.update(t);
    this.syncCams(t, seeked);
    // events
    let idx = 0;
    { let lo = 0, hi = run.events.length; while (lo < hi) { const m = (lo + hi) >> 1; if (run.events[m].t <= t) lo = m + 1; else hi = m; } idx = lo; }
    if (idx !== this.lastIdx) {
      const prev = this.lastIdx;
      this.lastIdx = idx;
      this.renderState(t, idx, forward && prev >= 0 ? prev : -1);
    }
    this.renderLive(t);
  }

  renderState(t: number, idx: number, prevIdx: number) {
    const run = this.run!;
    // plan
    let plan: Ev | null = null, units: Ev | null = null;
    for (let i = idx - 1; i >= 0 && (!plan || !units); i--) {
      const e = run.events[i];
      if (!plan && e.k === "ledger_changed") plan = e;
      if (!units && e.units) units = e;
    }
    if (run.system === "thoth") this.renderPlan(plan ? plan.plan : [], prevIdx >= 0);
    else this.renderBaselinePlan(idx);
    this.renderUnits(units ? units.units : null, prevIdx >= 0);
    // feed
    const visible = this.items.filter(i => i.t <= t).length;
    const feed = $("feed");
    if (prevIdx < 0 || visible < this.renderedItems) {
      feed.innerHTML = "";
      const from = Math.max(0, visible - 40);
      for (let i = from; i < visible; i++) feed.appendChild(this.renderItem(this.items[i], t, false));
    } else {
      const lastCard = Array.from(feed.querySelectorAll<HTMLElement>(".card")).pop() || null;
      if (this.renderedItems > 0 && lastCard) this.extend(lastCard, this.items[this.renderedItems - 1], t);
      for (let i = this.renderedItems; i < visible; i++) feed.insertBefore(this.renderItem(this.items[i], t, true), feed.querySelector(".thinking"));
      while (feed.children.length > 60) feed.firstElementChild!.remove();
    }
    this.renderedItems = visible;
    feed.querySelectorAll(".card.cur").forEach(c => c.classList.remove("cur"));
    const last = Array.from(feed.querySelectorAll(".card")).pop();
    if (last) last.classList.add("cur");
    this.stickBottom();
    // moments crossed during forward play
    if (prevIdx >= 0) {
      for (let i = prevIdx; i < idx; i++) this.moment(run.events[i], i);
    }
  }

  moment(e: Ev, i: number) {
    if (e.k === "approval_pending") this.flash("Permission check: HOLD for ground authorization", "var(--hold)");
    else if (e.k === "effect_verified" && e.verdict === "refuted") this.flash(`Effect refuted: ${e.effect.replace(/_/g, " ")}`, "var(--refuted)");
    else if (e.k === "effect_verified" && e.verdict === "unverified") this.flash(`Effect unverified: ${e.effect.replace(/_/g, " ")}`, "var(--unverified)");
    else if (e.k === "escalate") this.flash("Escalated to mission control: no procedure applies", "var(--earth)");
    else if (e.k === "operator_report") this.flash("Mission report sent", "var(--verified)");
    if (e.k === "operator_request_sent" && e.kind === "authorization" && !this.authShown.has(i)) {
      this.authShown.add(i);
      const pend = this.run!.events.slice(0, i).reverse().find(x => x.k === "approval_pending");
      $("auth-title").textContent = pend ? `${pend.tool} · ${pend.target}` : "Restricted operation";
      $("auth-reason").textContent = pend ? pend.reason : "";
      $("auth-text").textContent = e.text;
      $("auth").hidden = false;
      this.video.pause();
    }
  }

  closeAuth(granted: boolean) {
    $("auth").hidden = true;
    if (granted) this.flash("Grant recorded · the held operation may be proposed again", "var(--earth)");
    if (this.playing) this.video.play();
  }

  flash(text: string, color: string) {
    const f = $("hud-flash");
    f.textContent = text; f.style.color = color; f.style.borderColor = color;
    f.classList.add("on");
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => f.classList.remove("on"), 2200);
  }

  renderPlan(tasks: { id: string; text: string; status: string; depth: number }[], animate: boolean) {
    const ol = $("plan");
    const ids = new Set(tasks.map(x => x.id + x.text));
    ol.innerHTML = tasks.length ? tasks.map(x => {
      const isNew = animate && !this.planIds.has(x.id + x.text);
      return `<li class="${x.status}${x.depth ? " sub" : ""}${isNew ? " new" : ""}">${esc(x.text)}</li>`;
    }).join("") : `<li class="muted">The agent has not written a plan yet.</li>`;
    this.planIds = ids;
    const act = ol.querySelector("li.active") as HTMLElement | null;
    if (act) ol.scrollTop = act.offsetTop - ol.offsetTop - 40;
  }

  renderBaselinePlan(idx: number) {
    const ev = this.run!.events.slice(0, idx);
    let html = "";
    if (this.run!.system === "plexil") {
      const st = new Map<string, string>();
      for (const e of ev) if (e.k === "node") st.set(e.name, e.state === "FINISHED" ? "done" : "active");
      html = [...st].map(([n, s]) => `<li class="${s}">${esc(n)}</li>`).join("");
    } else {
      const plan = ev.filter(e => e.k === "plan").pop();
      if (plan) {
        const done = ev.filter(e => e.k === "result" && e.t >= plan.t).length;
        html = plan.steps.length ? plan.steps.map((s: string, i: number) => `<li class="${i < done ? "done" : i === done ? "active" : "pending"}">${esc(s.replace(/_/g, " "))}</li>`).join("")
          : `<li class="failed">No plan reaches the goal from the observed state.</li>`;
      }
    }
    if (ev.some(e => e.k === "escalate")) html += `<li class="blocked">Holding: new procedure requested from mission control</li>`;
    const key = html;
    if ($("plan").dataset.key !== key) { $("plan").innerHTML = html || `<li class="muted">Starting.</li>`; $("plan").dataset.key = key; }
  }

  renderUnits(units: Record<string, Unit> | null, animate: boolean) {
    const box = $("units");
    if (!units) { if (this.unitsKey !== "none") { box.innerHTML = `<p class="muted" style="font-size:12.5px">No telemetry read yet.</p>`; this.unitsKey = "none"; } return; }
    const key = JSON.stringify(units);
    if (key === this.unitsKey) return;
    const old = this.unitsKey && this.unitsKey !== "none" ? JSON.parse(this.unitsKey) : null;
    this.unitsKey = key;
    box.innerHTML = Object.entries(units).map(([k, u]) => {
      const trip = u.breaker !== "closed" || !u.energized;
      const changed = animate && old && old[k] && (old[k].breaker !== u.breaker || old[k].trip !== u.trip);
      const st = trip ? `${u.breaker}${u.trip ? " · " + u.trip.toLowerCase().replace(/_/g, " ") : ""}` : "nominal";
      return `<div class="unit${trip ? " trip" : ""}${changed ? " changed" : ""}"><span class="dot"></span><span class="u-name">${esc(u.name)}</span><span class="u-st">${esc(st)}</span></div>`;
    }).join("");
  }

  renderItem(it: Item, t: number, fresh: boolean): HTMLElement {
    const run = this.run!, e = it.e, d = document.createElement("div");
    const time = `<span class="t">${clock(it.t)}</span>`;
    if (it.kind === "step" && String(e.tool).startsWith("local/")) {
      d.className = "card local";
      d.innerHTML = `<div class="ch"><span class="step">#${stepNumber(run, e)}</span><span class="tool">${esc(e.tool.replace("local/", "").replace(/_/g, " "))}${e.args?.status ? " → " + esc(e.args.status) : ""}</span>${time}</div>` + (e.why ? `<div class="why">${esc(e.why)}</div>` : "");
      d.dataset.subs = String(it.subs.length);
    } else if (it.kind === "step") {
      d.className = "card step";
      const n = stepNumber(run, e);
      let html = `<div class="ch"><span class="step">#${n}</span><span class="tool">${esc(e.tool)}</span>${time}</div>`;
      const a = fmtArgs(e.args);
      if (a) html += `<div class="args">${esc(a)}</div>`;
      if (e.why) html += `<div class="why${fresh ? " typing" : ""}">${esc(e.why)}</div>`;
      if (e.think) html += `<details><summary>model reasoning · ${e.llm_s ?? "–"} s</summary><div class="think">${esc(e.think)}</div></details>`;
      let k = 0;
      for (const s of it.subs) {
        if (s.t > t) break;
        html += this.renderSub(s); k++;
      }
      d.innerHTML = html;
      d.dataset.subs = String(k);
      if (fresh && e.why) this.typeOut(d.querySelector(".why") as HTMLElement, e.why);
    } else if (it.kind === "mission") {
      d.className = "card sys"; d.innerHTML = `<div class="ch"><span class="tool">mission received</span>${time}</div><div class="why">${esc(e.text)}</div>`;
    } else if (it.kind === "earth-out") {
      d.className = "card earth";
      const kind = PRETTY[e.kind] ?? e.kind;
      d.innerHTML = `<div class="ch"><span class="tool">→ mission control</span><span class="step">${esc(kind)} request</span>${time}</div><details${run.system !== "thoth" ? " open" : ""}><summary>message</summary><div class="think">${esc(e.text)}</div></details>`;
    } else if (it.kind === "earth-in") {
      d.className = "card earth";
      const out = e.outcome ? (PRETTY[e.outcome] ?? e.outcome) : "";
      d.innerHTML = `<div class="ch"><span class="tool">← mission control</span><span class="pill ${e.outcome === "grant" ? "verified" : "hold"}">${esc(out)}</span>${time}</div><div class="why">${esc(e.text)}</div>`;
    } else if (it.kind === "grant") {
      d.className = "card earth"; d.innerHTML = `<div class="ch"><span class="tool">grant recorded</span>${time}</div><div class="why">${esc(e.tool)} on ${esc(e.target)} may now pass the permission check.</div>`;
    } else if (it.kind === "report") {
      d.className = "card report"; d.innerHTML = `<div class="ch"><span class="tool">mission report</span>${time}</div><div class="why">${esc(e.text)}</div>`;
    } else if (it.kind === "fail") {
      d.className = "card sys"; d.innerHTML = `<div class="ch"><span class="tool">call rejected</span>${time}</div><div class="why">The model's output was not an executable call (${esc(e.tool)}). It is returned to the model.</div>`;
    } else if (it.kind === "planner") {
      d.className = "card step";
      d.innerHTML = `<div class="ch"><span class="tool" style="color:var(--europa)">EUROPA plan</span><span class="pill ${e.solved ? "ok" : "fail"}">${e.solved ? `${e.steps.length} activities` : "no plan"}</span>${time}</div>` +
        (e.steps.length ? `<div class="args">${e.steps.slice(0, 8).map(esc).join("<br>")}${e.steps.length > 8 ? "<br>…" : ""}</div>` : "");
    } else if (it.kind === "noplan") {
      d.className = "card sys"; d.innerHTML = `<div class="ch"><span class="tool" style="color:var(--deny)">planner: no plan</span>${time}</div><div class="why">The task domain has no actions that reach the goal from the observed state.</div>`;
    } else if (it.kind === "node") {
      d.className = "card sys"; d.innerHTML = `<div class="ch"><span class="tool" style="color:var(--plexil)">procedure · ${esc(e.name)}</span>${time}</div>`;
    }
    return d;
  }

  extend(el: HTMLElement, it: Item, t: number) {
    if (it.kind !== "step" || el.classList.contains("local")) return;
    const done = +(el.dataset.subs || 0);
    let k = 0, html = "";
    for (const s of it.subs) { if (s.t > t) break; if (k >= done) html += this.renderSub(s); k++; }
    if (html) { el.insertAdjacentHTML("beforeend", html); el.dataset.subs = String(k); }
  }

  renderSub(s: Ev): string {
    const row = (k: string, v: string) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    switch (s.k) {
      case "guard_decision": return row("permit", `<span class="pill ${s.outcome}">${s.outcome}</span> ${esc(s.reason || "")}`);
      case "approval_pending": return row("permit", `<span class="pill hold">hold</span> ${esc(s.reason)}`);
      case "execution_started": return row("execute", `<span class="pill run">dispatched</span>`);
      case "execution_finished": return row("skill", `<span class="pill ${s.ok ? "ok" : "fail"}">${s.ok ? "reported success" : "reported failure"}</span> ${esc((s.fail || "").slice(0, 200))}` +
        (s.serials ? ` serials read: ${esc(s.serials.join(", ") || "none")}` : "")) + (s.img ? `<img loading="lazy" src="${s.img}" alt="">` : "");
      case "result": return row("skill", `<span class="pill ${s.ok ? "ok" : "fail"}">${s.ok ? "success" : "failure"}</span> ${esc((s.fail || "").slice(0, 200))}`) +
        row("effect", `<span class="muted">no independent effect judgment</span>`);
      case "effect_verified": {
        const facts = Object.entries(s.facts || {}).slice(0, 4).map(([k, v]) => `${k.replace(/_/g, " ")} ${typeof v === "number" ? +(+v).toFixed(3) : v}`).join(" · ");
        return row("effect", `<span class="pill ${s.verdict}">${s.verdict}</span> ${esc(s.effect.replace(/_/g, " "))}${facts ? `<br><span class="muted">${esc(facts)}</span>` : ""}`);
      }
      case "query_answered":
        if (s.answer) return row("answer", `<span class="clamp" title="${esc(s.answer)}">${esc(s.answer)}</span>`) + (s.img ? `<img loading="lazy" src="${s.img}" alt="camera view">` : "");
        if (s.units) return row("answer", "unit telemetry read");
        return row("answer", esc(s.fail || ((s.value || "").length > 180 ? s.value.slice(0, 178) + " …" : s.value || "")));
      case "local_tool": return row("record", esc(s.detail));
    }
    return "";
  }

  typeOut(el: HTMLElement, text: string) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.textContent = ""; el.classList.add("caret");
    let i = 0;
    const step = () => {
      if (!el.isConnected) return;
      i = Math.min(text.length, i + Math.max(2, Math.round(text.length / 60)));
      el.textContent = text.slice(0, i);
      if (i < text.length) requestAnimationFrame(step); else el.classList.remove("caret");
    };
    requestAnimationFrame(step);
  }

  renderLive(t: number) {
    const run = this.run!, feed = $("feed");
    // model deciding between step start and proposal
    let thinking: Ev | null = null, running: Ev | null = null;
    for (let i = this.lastIdx - 1; i >= 0; i--) {
      const e = run.events[i];
      if (e.k === "reasoner_step_started") { thinking = e; break; }
      if (e.k === "tool_proposed" || e.k === "call" || e.k === "reasoner_step_failed") break;
    }
    for (let i = this.lastIdx - 1; i >= 0; i--) {
      const e = run.events[i];
      if (e.k === "execution_finished" || e.k === "result") break;
      if (e.k === "execution_started" || e.k === "call") { running = e; break; }
    }
    let th = feed.querySelector(".thinking") as HTMLElement | null;
    if (thinking && run.system === "thoth") {
      if (!th) { th = document.createElement("div"); th.className = "thinking"; feed.appendChild(th); this.stickBottom(); }
      th.innerHTML = `<i></i>step ${thinking.step} · model deciding · ${(t - thinking.t).toFixed(0)} s`;
    } else if (th) th.remove();
    const op = $("hud-op");
    if (running) {
      op.classList.add("on");
      op.innerHTML = `<span class="op-k">executing · ${(t - running.t).toFixed(0)} s</span><span class="op-v">${esc(running.tool)} <span class="arg">${esc(fmtArgs(running.args).slice(0, 80))}</span></span>`;
    } else if (thinking && run.system === "thoth") {
      op.classList.add("on");
      op.innerHTML = `<span class="op-k">mission agent</span><span class="op-v">choosing the next operation…</span>`;
    } else op.classList.remove("on");
  }
}
