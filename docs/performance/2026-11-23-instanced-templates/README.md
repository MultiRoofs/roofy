# Implicit geometry drawn as instances, 2026-11-23

Design: `docs/plans/2026-11-23-instanced-templates-design.md`. A template is
kept once from the reader to the GPU and drawn once per placement; "baked" is
the code before it (app `f878476`, plugins `0027850`), which copies the
template into every object.

## Result

**Memory follows the placements, not the copies: on 50,000 trees the main
thread's heap is 410 MB instead of 2,370 MB, and 62 MB instead of 915 MB goes
to the GPU. 200,000 trees load.**

| Trees  | Measure               | Baked    | Instanced |
| ------ | --------------------- | -------- | --------- |
| 10,000 | Heap after load       | 583 MB   | 298 MB    |
| 10,000 | Uploaded to the GPU   | 212 MB   | 40 MB     |
| 10,000 | Load, to a quiet page | 40.4 s   | 23.3 s    |
| 50,000 | Heap after load       | 2,370 MB | 410 MB    |
| 50,000 | Uploaded to the GPU   | 915 MB   | 62 MB     |
| 50,000 | Load, to a quiet page | 77.6 s   | 39.3 s    |

- An empty app holds 128 MB of heap, and its globe, terrain and basemap
  account for most of the 40 MB uploaded at 10,000 trees.
- Building the mesh of 50,000 trees takes 1.3 s of main-thread JavaScript,
  and of 200,000 trees 5.0 s; the heap at 200,000 trees is about 830 MB four
  minutes after opening. The baked build was not run at 200,000.
- The triangles drawn per frame are the same (23.0 million vertices per frame
  at 10,000 trees, in both), so instancing does not make a frame cheaper to
  rasterise. Restyle, hide and show settle in 2.2 to 3.5 s in both builds on
  this host, and a CPU profile shows that time inside the software
  rasteriser, not in JavaScript.
- What still grows with the surfaces: every placed surface keeps a style slot
  (112 or 88 per tree), which is where the heap above the empty app goes.

## Method

`node scripts/performance/make-template-forest.mjs <count> <out>` writes the
file: two templates of 112 and 88 surfaces, `count` trees on a 12 m grid, each
with its own rotation and scale. `gate-harness.mjs --scenario forest --file
<name>` loads it as a static layer and runs single colour, a rule on `height`,
surface type, hide and show. One run per row, SwiftShader in a container, so
timings compare only within this table and say nothing about a GPU. The
50,000-tree runs were stopped after the "loaded" line.

`instanced-10k-close.png` and `instanced-10k-cartoon.png` are the instanced
build from inside the forest, photoreal and with the cartoon theme's edges.

## Not measured

- Frame time on a GPU.
- A streamed source (FlatCityBuf or CityParquet) with templates in a browser;
  the unit tests cover the cell path.
