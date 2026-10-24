# usage: python3 -I replicate-grid.py in.city.jsonl out.city.jsonl N [COLS]
# N copies of a CityJSONSeq tile on a grid COLS wide (default N, one row),
# each offset by the tile's extent plus a 1,000-unit gap, ids suffixed #k.
# Used by gate-harness.mjs to make a large file from the Delft tile.
import json, math, sys
src, dst, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
cols = int(sys.argv[4]) if len(sys.argv) > 4 else n
rows = math.ceil(n / cols)
lines = [l for l in open(src) if l.strip()]
header = json.loads(lines[0])
sx = header["transform"]["scale"][0]
ext = header["metadata"]["geographicalExtent"]
width_q = math.ceil((ext[3] - ext[0]) / sx) + 1000
sy = header["transform"]["scale"][1]
height_q = math.ceil((ext[4] - ext[1]) / sy) + 1000
header["metadata"]["geographicalExtent"] = [ext[0], ext[1], ext[2], ext[3] + (min(n, cols) - 1) * width_q * sx, ext[4] + (rows - 1) * height_q * sy, ext[5]]
with open(dst, "w") as out:
    out.write(json.dumps(header) + "\n")
    for k in range(n):
        sfx = "" if k == 0 else f"#{k}"
        for line in lines[1:]:
            f = json.loads(line)
            f["id"] = f["id"] + sfx
            objs = {}
            for oid, o in f["CityObjects"].items():
                for key in ("children", "parents"):
                    if key in o:
                        o[key] = [x + sfx for x in o[key]]
                objs[oid + sfx] = o
            f["CityObjects"] = objs
            dx, dy = (k % cols) * width_q, (k // cols) * height_q
            f["vertices"] = [[v[0] + dx, v[1] + dy, v[2]] for v in f["vertices"]]
            out.write(json.dumps(f, separators=(",", ":")) + "\n")
