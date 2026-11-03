"""Recorded runs -> the site's JSON (public/data) and evidence images (public/media/evidence).

    python3 tools/build_data.py

Every Thoth event already carries the simulation time the replay frames are named by, so the page plays the video,
the mini-map and the agent loop on one clock. Server paths, endpoints and the raw model I/O stay out of the output;
the model's reasoning is kept as a short excerpt.
"""
import json
import os
import re
from pathlib import Path

from PIL import Image

from catalog import RUNS, SCENARIOS

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data"
EVID = ROOT / "public" / "media" / "evidence"
REASONING_CHARS = 900


def short(v, n=600):
    s = v if isinstance(v, str) else json.dumps(v, separators=(", ", ": "))
    return s if len(s) <= n else s[:n].rstrip() + " …"


def units(value):
    return {k: dict(name=u["name"], load=u.get("load"), crit=u.get("criticality"), breaker=u["breaker"],
                    energized=u["energized"], trip=u.get("trip_cause"),
                    modules=u.get("installed_modules", {}))
            for k, u in value["units"].items()}


def evidence_image(src, run_id):
    p = Path(src)
    if not p.exists():
        return None
    EVID.joinpath(run_id).mkdir(parents=True, exist_ok=True)
    out = EVID / run_id / (p.stem + ".webp")
    if not out.exists():
        im = Image.open(p).convert("RGB")
        im.thumbnail((960, 720))
        im.save(out, "WEBP", quality=82)
    return f"media/evidence/{run_id}/{out.name}"


def thoth_events(path, run_id):
    out, last_units = [], None
    for line in open(path):
        e = json.loads(line)
        k, t = e["kind"], round(e["sim_t"], 2)
        r = dict(t=t, k=k)
        if k == "mission_received":
            r["text"] = e["text"]
        elif k == "reasoner_attached":
            r["model"] = e["model"]
        elif k == "reasoner_step_started":
            r["step"] = e["step"]
        elif k == "tool_proposed":
            r.update(tool=e["tool"], args=e["args"], why=e.get("rationale", ""), say=e.get("content", "").strip(),
                     think=short(e.get("reasoning", ""), REASONING_CHARS), llm_s=e.get("llm_s"))
        elif k == "reasoner_step_failed":
            r.update(tool=e["tool"], detail=short(e.get("detail", ""), 300))
        elif k == "query_answered":
            r.update(query=e["query"], ok=e["success"])
            v = e.get("value")
            if e["query"] == "observe" and isinstance(v, dict):
                r.update(answer=v.get("answer", ""), camera=v.get("camera"), vlm=v.get("model"))
                if v.get("image"):
                    r["img"] = evidence_image(v["image"], run_id)
            elif e["query"] == "power_status" and isinstance(v, dict) and "units" in v:
                r["units"] = units(v)
            else:
                r["value"] = short(v, 700)
            if not e["success"]:
                r["fail"] = short(e.get("failure_reason", ""), 300)
        elif k == "local_tool":
            r.update(ok=e["success"], detail=short(e.get("detail", ""), 200))
        elif k == "ledger_changed":
            r["plan"] = [dict(id=x["task_id"], text=x["text"], status=x["status"], depth=x.get("depth", 0))
                         for x in e["ledger"]["tasks"]]
        elif k == "equipment_telemetry":
            u = units(e["value"])
            if u == last_units:
                continue
            last_units = r["units"] = u
        elif k == "guard_decision":
            r.update(tool=e["tool"], outcome=e["outcome"], reason=e.get("reason", ""))
        elif k == "approval_pending":
            r.update(tool=e["capability"], target=e["target"], reason=e["reason"])
        elif k == "approval_granted":
            r.update(tool=e["capability"], target=e["target"])
        elif k == "operator_request_sent":
            r.update(kind=e["request_kind"], text=short(e["text"], 1600))
        elif k == "operator_answered":
            r.update(text=e["text"], outcome=e.get("outcome"))
        elif k == "execution_started":
            r.update(tool=e["capability"], args=e["args"])
        elif k == "execution_finished":
            r.update(tool=e["capability"], ok=e["success"], fail=e.get("failure_reason", ""))
            scan = (e.get("evidence") or {}).get("scan")
            if scan:
                r["serials"] = scan.get("serials", [])
                if scan.get("image"):
                    r["img"] = evidence_image(scan["image"], run_id)
        elif k == "effect_verified":
            v = {True: "verified", False: "refuted", None: "unverified"}[e["holds"]]
            facts = {x: e[x] for x in e if x not in ("seq", "kind", "wall_t", "sim_t", "capability", "effect", "holds")
                     and not isinstance(e[x], (dict, list)) and x != "image"}
            r.update(tool=e["capability"], effect=e["effect"], verdict=v, facts=facts)
        elif k == "operator_report":
            r["text"] = e["text"]
        else:
            continue
        out.append(r)
    return out


def baseline_events(timeline, operator):
    """PLEXIL / EUROPA->PLEXIL: capability calls, plan steps or planner output, and the ground exchange."""
    out = []
    for e in json.load(open(timeline))["events"]:
        k = e["kind"]
        if k == "capability":
            out.append(dict(t=round(e["sim_t_start"], 2), k="call", tool=e["capability"], args=e["args"]))
            out.append(dict(t=round(e["sim_t_end"], 2), k="result", tool=e["capability"], ok=e["success"],
                            fail=e.get("failure_reason", "")))
        elif k == "dispatch":
            out.append(dict(t=round(e["sim_t"], 2), k="call", tool=e["capability"], args=e["args"]))
        elif k == "result" and "sim_t" in e:
            out.append(dict(t=round(e["sim_t"], 2), k="result", tool=e["capability"], ok=e["success"],
                            fail=e.get("failure_reason", "")))
        elif k == "node_status" and e["level"] == "top" and e["state"] in ("EXECUTING", "FINISHED"):
            out.append(dict(t=round(e["sim_t"], 2), k="node", name=e["name"], state=e["state"]))
        elif k == "plan" and "sim_t" in e:
            out.append(dict(t=round(e["sim_t"], 2), k="plan", solved=e["solved"],
                            steps=[a[0].split(".")[-1] + " " + " ".join(str(v) for v in a[1].values())
                                   for a in e["activities"]]))
        elif k == "no_plan":
            out.append(dict(t=round(e["sim_t"], 2), k="no_plan", reason=e.get("reason", "")))
    for line in open(operator):
        e = json.loads(line)
        if e["kind"] == "interaction_start":
            out.append(dict(t=round(e["sent_mission_t"], 2), k="escalate", kind=e["request_kind"], text=e["text"]))
        elif e["kind"] == "interaction_end":
            answer = dict(k="ground", outcome=e["outcome"], text=e["text"])
        elif e["kind"] == "reply_delivered":
            out.append(dict(t=round(e["mission_t"], 2)) | answer)
    return sorted(out, key=lambda x: x["t"])


def track(path):
    t = json.load(open(path))
    pts, last = [], -1.0
    for p in t["track"]:
        if p["t"] - last < 0.5:
            continue
        last = p["t"]
        held = p["held"]["name"] if p["held"] else None
        pts.append([round(p["t"], 1), round(p["robot"][0], 2), round(p["robot"][1], 2), round(p["robot"][2], 2), held])
    return pts


def frame_range(replay):
    names = sorted(n for n in os.listdir(replay) if n.endswith(".png"))
    return float(names[0][:-4]), float(names[-1][:-4]), len(names)


def main():
    OUT.joinpath("runs").mkdir(parents=True, exist_ok=True)
    index = []
    for sc in SCENARIOS:
        entries = []
        for r in sc["runs"]:
            rid = Path(r["dir"]).name
            d = Path(RUNS) / r["dir"]
            if not (Path(r["replay"]).is_dir() and Path(r["track"]).exists()):
                print("skip (no replay yet)", rid)
                continue
            t0, t1, n = frame_range(r["replay"])
            run = dict(id=rid, system=r["system"], scenario=sc["id"], video=dict(t0=t0, t1=t1, frames=n),
                       track=track(r["track"]))
            if r["system"] == "thoth":
                run["events"] = thoth_events(d / "ours" / "events.jsonl", rid)
            else:
                run["events"] = baseline_events(r["timeline"], d / "operator" / "events.jsonl")
            row = Path(RUNS).parent / "eval" / "exp1b" / "rows" / f"exp1b__{rid}.json"
            if row.exists():
                ev = json.load(open(row))
                run["outcome"] = dict(success=ev["autonomous_mission_success"], reason=ev["failure_reason"],
                                      elapsed=ev["mission_elapsed_s"])
            cams = json.load(open(ROOT / "media_build" / "video" / "cams" / "t0.json"))
            if rid in cams:
                run["cams"] = dict(t0=cams[rid])
            if "success" in r:
                run["outcome"] = dict(success=r["success"], reason=None, elapsed=round(t1, 1))
            json.dump(run, open(OUT / "runs" / f"{rid}.json", "w"), separators=(",", ":"))
            entries.append(dict(id=rid, system=r["system"], label=r.get("label"), duration=round(t1, 1),
                                success=run["outcome"]["success"]))
            print("wrote", rid, n, "frames")
        index.append({k: sc[k] for k in ("id", "group", "family", "title", "condition", "keywords")} | dict(runs=entries))
    json.dump(index, open(OUT / "scenarios.json", "w"), indent=1)


if __name__ == "__main__":
    main()
