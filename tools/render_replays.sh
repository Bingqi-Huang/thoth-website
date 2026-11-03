#!/bin/bash
# Clean third-person replays (no overlay) for the runs that have none yet, rendered from each run's bag with the
# research repo's experiments/video/replay_render.py in the run-farm image, then the run's track for the mini-map.
#
#   tools/render_replays.sh <gpu> <slot>        one worker; several share a GPU (a replay needs ~1/4 of one)
#
# Queue: media_build/render_queue.txt, one run per line: <checkout> <run dir> <fps>. The checkout must hold the scene
# the run was simulated in (its SRB's interaction.json lists the run's items). Checkouts whose SRB predates the
# relative body-texture path (exp1b, compound-fault) need the texture mount, as in render_1x.sh.
G=${1:?gpu}; S=${2:?slot}
T=/mnt/SharedData/Research/thoth; B=$T/media_build; R=/mnt/SharedData/Research/Space_Robot_Harness
Q=$B/render_queue.txt; mkdir -p $B/replay $B/track
CPUS=$((4 * (2 * G + S)))-$((4 * (2 * G + S) + 3))
export RUNFARM_CPUS=$CPUS RUNFARM_MEMS=0
export RUNFARM_ARGS="-v /mnt/SharedData/Research/lunarbot_textures/textures:/home/bingqi/SharedData/Research/LunarSim/assets/USD_Assets/robots/lunarbot/configuration/materials/textures:ro"
while true; do
  read -r W run fps <<< "$(flock "$Q.lock" bash -c "head -1 $Q; sed -i 1d $Q")"
  [ -z "$run" ] && break
  id=$(basename $run); c=site-$id
  echo "$(date '+%F %T') gpu$G.$S start $id" >> $B/render.log
  $R/docker/runfarm/runfarm.sh $G $c "/home/bingqi/Programs/isaac-sim/python.sh $W/experiments/video/replay_render.py $run $B/replay/$id --fps $fps > $B/replay/$id.log 2>&1" > /dev/null
  docker wait $c > /dev/null
  docker run --rm --cpuset-cpus $CPUS -v /mnt/SharedData:/mnt/SharedData runfarm:22.04 bash -lc \
    "source /opt/ros/humble/setup.bash && nice -n 19 $R/openral/.venv/bin/python $R/experiments/video/track_from_bag.py $run/bag $B/track/$id.track.json" > $B/track/$id.log 2>&1
  echo "$(date '+%F %T') gpu$G.$S done $id $(ls $B/replay/$id | wc -l) frames, $(tail -1 $B/replay/$id.log)" >> $B/render.log
done
echo "$(date '+%F %T') gpu$G.$S worker done" >> $B/render.log
