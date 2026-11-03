"""Scenarios shown on the site and the recorded runs behind them.

Paths are relative to the research repository's artifacts/runs. `video` names the clean replay frames directory
(1600x900, 10 frames per simulated second, file names are sim time) and the track file, when they exist.
"""
RUNS = "/mnt/SharedData/Research/Space_Robot_Harness/artifacts/runs"
FIG = "/mnt/SharedData/Research/Space_Robot_Harness/artifacts/figures"
V1X = f"{FIG}/exp1b/video_1x"
VB = f"{FIG}/exp1b/video"


MB = "/mnt/SharedData/Research/thoth/media_build"


def thoth(run, rep=None):
    return dict(system="thoth", dir=f"exp1b/{run}", replay=f"{V1X}/replay/{run}", track=f"{V1X}/{run}.track.json")


def base(system, run, d="exp1b", success=False, label=None):
    """Baseline replays rendered for the site (5 frames per simulated second); timelines rebuilt from the logs."""
    return dict(system=system, dir=f"{d}/{run}", replay=f"{MB}/replay/{run}", track=f"{MB}/track/{run}.track.json",
                timeline=f"{MB}/timeline/{run}.timeline.json", success=success, label=label)


def site(run, d, success, label=None):
    return dict(system="thoth", dir=f"{d}/{run}", replay=f"{MB}/replay/{run}", track=f"{MB}/track/{run}.track.json",
                success=success, label=label)


# group: reference | contingency | sequential | identity
SCENARIOS = [
    dict(id="restore-pdu2", group="reference", family="maintenance", title="Restore PDU-2",
         condition="Tripped breaker at PDU-2.",
         keywords="pdu-2 pdu2 communication comms breaker reset trip",
         runs=[thoth("ours_a_pdu2")]),
    dict(id="restore-bess", group="reference", family="maintenance", title="Restore BESS",
         condition="Tripped breaker at the battery energy storage system.",
         keywords="bess battery storage breaker reset trip",
         runs=[thoth("ours_a_bess")]),
    dict(id="restore-isru", group="reference", family="maintenance", title="Restore ISRU",
         condition="Tripped breaker at the oxygen plant.",
         keywords="isru oxygen plant breaker reset trip",
         runs=[thoth("ours_a_isru")]),
    dict(id="locate-fault", group="reference", family="maintenance", title="Locate and restore faulty equipment",
         condition="The report names PDU-2, but the tripped breaker is at BESS.",
         keywords="locate find wrong misreport misreported report different unit",
         runs=[thoth("ours_a_misreport")]),
    dict(id="deliver-oru", group="reference", family="delivery", title="Deliver a spare module to PDU-3",
         condition="Standard inventory and destination.",
         keywords="deliver spare oru module pdu-3 pdu3 shelf",
         runs=[thoth("ours_b_oru_pdu3")]),
    dict(id="deliver-battery", group="reference", family="delivery", title="Deliver a battery module to BESS",
         condition="Standard inventory and destination.",
         keywords="deliver battery module bess stand",
         runs=[thoth("ours_b_bat_bess")]),
    dict(id="deliver-consumables", group="reference", family="delivery", title="Deliver consumables to the habitat",
         condition="Standard inventory and destination.",
         keywords="deliver consumables container habitat logistics",
         runs=[thoth("ours_b_cons_habitat")]),
    dict(id="pdu1-shutter", group="contingency", family="maintenance", title="Restore PDU-1",
         condition="Overheating trip with the heat-rejection shutter closed.",
         keywords="pdu-1 pdu1 overheat overheating shutter radiator heat temperature",
         runs=[thoth("ours_l2a_pdu1_r1"), base("plexil", "plexil_l2a_pdu1"), base("europa", "europa_l2a_pdu1")]),
    dict(id="bess-shutter", group="contingency", family="maintenance", title="Restore BESS",
         condition="Overheating trip with the heat-rejection shutter closed.",
         keywords="bess overheat overheating shutter hvac heat temperature",
         runs=[thoth("ours_l2a_bess_r1"), base("plexil", "plexil_l2a_bess"), base("europa", "europa_l2a_bess")]),
    dict(id="bess-battery", group="contingency", family="maintenance", title="Restore BESS",
         condition="A failed battery module prevents sustained recovery after reset.",
         keywords="bess battery module failed replace swap recurring",
         runs=[thoth("ours_l3_bess_r1"), base("plexil", "plexil_l3_bess"), base("europa", "europa_l3_bess")]),
    dict(id="isru-filter", group="contingency", family="maintenance", title="Restore ISRU",
         condition="A clogged filter prevents sustained recovery after reset.",
         keywords="isru filter clogged cartridge oxygen replace",
         runs=[thoth("ours_l3_isru_r1"), base("plexil", "plexil_l3_isru"), base("europa", "europa_l3_isru")]),
    dict(id="no-spare", group="contingency", family="maintenance", title="Restore PDU-1",
         condition="No serviceable spare in storage; compatible modules remain installed in energized equipment.",
         keywords="pdu-1 pdu1 no spare cannibalize donor borrow authorization approval energized",
         runs=[thoth("ours_l4_pdu1_r1"), base("plexil", "plexil_l4_pdu1"), base("europa", "europa_l4_pdu1")]),
    dict(id="occupied-destination", group="contingency", family="delivery", title="Deliver an item to the habitat",
         condition="The destination support is occupied by a recorded return item.",
         keywords="habitat occupied destination blocked relocate return item",
         runs=[thoth("ours_l2b_habitat_r1"), base("plexil", "plexil_l2b_habitat"), base("europa", "europa_l2b_habitat")]),
    dict(id="sequential-faults", group="sequential", family="maintenance", title="Restore BESS",
         condition="A battery-module fault is followed by an overheating trip after replacement and reset.",
         keywords="bess sequential second fault after replacement compound overheating battery",
         runs=[site("ours_compound_bess_r1", "compound_fault/formal/gpu0", True),
               base("plexil", "plexil_compound_bess", "compound_fault/formal/gpu1"),
               base("europa", "europa_compound_bess", "compound_fault/formal/gpu1", True)]),
    dict(id="serial-mislocated", group="identity", family="delivery", title="Deliver ORU-0417 to PDU-3",
         condition="The item's physical location differs from the inventory record.",
         keywords="serial number oru-0417 mislocated wrong place record label scan",
         runs=[site("post_ours_h1_r1", "exp2/post", True), site("pre_ours_h1", "exp2/pre", False, "Thoth · before serial reading"),
               base("plexil", "post_plexil_h1", "exp2/post", True), base("europa", "post_europa_h1_f145", "exp2/post", True),
               base("plexil", "pre_plexil_h1", "exp2/pre", False, "PLEXIL · before"),
               base("europa", "pre_europa_h1", "exp2/pre", False, "EUROPA→PLEXIL · before")]),
    dict(id="serial-swapped", group="identity", family="delivery", title="Deliver ORU-0417 to PDU-1",
         condition="Inventory records for two visually similar items are exchanged.",
         keywords="serial number oru-0417 swapped exchanged records label scan",
         runs=[site("post_ours_h2_r1", "exp2/post", True), site("pre_ours_h2", "exp2/pre", False, "Thoth · before serial reading"),
               base("plexil", "post_plexil_h2", "exp2/post", True), base("europa", "post_europa_h2", "exp2/post", True),
               base("plexil", "pre_plexil_h2", "exp2/pre", False, "PLEXIL · before"),
               base("europa", "pre_europa_h2", "exp2/pre", False, "EUROPA→PLEXIL · before")]),
]
