# Roofy brand assets — v1.0

The shipped brand kit, at `public/brand/` so the browser can load any of it by URL
(favicon, app icon, og image). Replaces the Urbis set (`urbis-*.svg`, old `brand.css`).

## Mark — "Sun band"

Two roof planes over a slab, on a 48 × 48 grid at 45° pitch. The sun-facing plane
splits at mid-pitch (`y20`) into amber and orange. The four colours are the four
rooftop functions, in legend order: nature, energy, social, water.

| File                       | Use                                                         |
| -------------------------- | ----------------------------------------------------------- |
| `roofy-mark.svg`           | Mark on dark surfaces                                       |
| `roofy-mark-light.svg`     | Mark on light surfaces                                      |
| `roofy-mark-small.svg`     | 20px and below — split raised to `y17` so orange survives   |
| `favicon.svg`              | Browser tab (same geometry as the small mark)               |
| `roofy-lockup.svg`         | Mark + wordmark, dark                                       |
| `roofy-lockup-light.svg`   | Mark + wordmark, light                                      |
| `roofy-app-icon-dark.svg`  | 80px tile, 18px radius, dark                                |
| `roofy-app-icon-light.svg` | 80px tile, 18px radius, light                               |
| `brand.css`                | The kit's tokens + `.roofy-lockup`, for use OUTSIDE the app |
| `brand.tokens.json`        | The same data for design tooling                            |

Lockup SVGs use Outfit 600 with an embedded font, so they render independently of installed fonts. The app uses the same locally hosted Outfit font for its wordmark; UI text remains Source Sans 3. Fonts and their licenses live in `fonts/`.

Approved motion is C (Open possibilities): `roofy-lockup-animated-light.svg` and `roofy-lockup-animated-dark.svg` include the Outfit wordmark. They play once, respect reduced motion, and have transparent backgrounds. Static marks, favicons and app icons retain their approved geometry and palette; font changes only affect wordmarks. Historical comparison pages remain in `motion/`.

## Rules

- Clear space on all sides = slab height, 10 grid units (20.8% of mark height).
- Minimum size 16px; below 20px use `roofy-mark-small.svg` (the app's toolbar does).
- Keep static marks flat. The approved unfolding animation is the motion exception; do not recolor or rotate the mark.
- On a lime field, swap the lime plane and slab to `#14181E` and keep amber + orange.

## Tokens

The APP'S tokens live in `src/app/brand.css` (loaded before `app.css`, which derives
every interactive colour from them); `brand.css` here is the kit's own copy for docs
and slides, and `brand.tokens.json` is the same data for design tooling. The values
are identical: change one, change all three.
