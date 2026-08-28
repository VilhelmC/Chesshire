#!/bin/sh
# WHAT DEPTH DOES THE MATE RUNG NEED? — read off the labels, not searched for.
#
# Will: "why not just look at the puzzle answers, see what length they are and
# whether they are classified as mate category instead of running whole suite?
# We have the whole lichess puzzle corpus and we can easily read out the maximum
# depth checkmate in it."
#
# Correct, and it is the better instrument. The corpus states the answer: every
# mate puzzle is labelled mateInK and carries its solution, so the depth the rung
# needs is arithmetic rather than an experiment. This runs in about forty seconds
# over all six million puzzles; the sweep it replaces took eleven minutes over a
# thousand and answered a blurrier question.
#
# PLY ACCOUNTING. Lichess solutions start with the OPPONENT'S blunder, so the
# stored line is even: mateIn1 is 2 plies, mateIn2 is 4, mateIn3 is 6. The ladder
# is asked from the position AFTER the blunder, so what it needs is
#
#     depth = plies - 1 = 2K - 1
#
# which is 1, 3, 5, 7, 9 for K = 1..5.
#
# WATCH FOR: `mateIn5` is a BUCKET, not a value. Lichess labels everything from
# five upwards as mateIn5, so the (K, plies) table at the bottom is where the real
# tail lives — and the deepest puzzle in the corpus is much deeper than 5.
#
# Usage:  sh scripts/mate-depth.sh [path/to/lichess_db_puzzle.csv.zst]
set -e
DB="${1:-data/lichess_db_puzzle.csv.zst}"
[ -f "$DB" ] || { echo "no corpus at $DB" >&2; exit 1; }

zstdcat "$DB" | awk -F, '
	NR == 1 { next }
	{ total++ }
	$8 ~ /mateIn/ {
		mates++
		n = split($3, a, " ")
		plies[n]++
		if (match($8, /mateIn[0-9]+/)) {
			k = substr($8, RSTART + 6, RLENGTH - 6)
			label[k]++
			pair[k "\t" n]++
		}
	}
	END {
		printf "\n  %d puzzles, %d mate-labelled (%.1f%%)\n\n", total, mates, 100 * mates / total
		printf "  %-9s %-7s %10s %9s %11s\n", "label", "depth", "puzzles", "share", "cumulative"
		cum = 0
		for (k = 1; k <= 5; k++) {
			if (!(k in label)) continue
			cum += label[k]
			printf "  mateIn%-3d %-7d %10d %8.2f%% %10.2f%%\n", k, 2 * k - 1, label[k], 100 * label[k] / mates, 100 * cum / mates
		}
		printf "\n  the tail — solution plies, which is where mateIn5 stops being a number\n"
		cum = 0
		for (n = 2; n <= 40; n += 2) {
			if (!(n in plies)) continue
			cum += plies[n]
			printf "    %2d plies -> depth %-3d %9d %10.4f%% cumulative\n", n, n - 1, plies[n], 100 * cum / mates
		}
	}
'
