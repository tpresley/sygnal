#!/bin/sh
# A/B: interleave runs of edit-loop.mjs on two sygnal-check src trees (A=$A_SRC, B=$B_SRC).
#   A_SRC=... B_SRC=... sh ab.sh <dir> [rounds=5] [edits=20]
here=$(dirname "$0"); dir=$1; rounds=${2:-5}; edits=${3:-20}
for i in $(seq 1 $rounds); do
  printf 'A '; SYGNAL_CHECK_SRC=$A_SRC node $here/edit-loop.mjs $dir $edits
  printf 'B '; SYGNAL_CHECK_SRC=$B_SRC node $here/edit-loop.mjs $dir $edits
done
