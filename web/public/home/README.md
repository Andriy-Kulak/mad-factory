# Art

Paper-cut illustrations for the sign-in screen (`web/components/factory-art.tsx`) and the repository README.
Generated 2026-10-05 with OpenAI GPT Image 2.5 (Flare) through fal.ai, then trimmed, split and converted to WebP.
Style: tactile layered cut paper, navy / cream / teal / sky blue / lime / marigold / coral; no text, logos or
watermarks.

| File | Source | Use |
|---|---|---|
| `factory-simple.webp` | text-to-image (daytime factory diorama), then edit passes that removed the baked-in smoke and clouds and simplified the hill to one factory with two chimneys | sign-in background |
| `factory-animated.webp` | the sign-in scene (factory, puffs, clouds) rendered headless with the clouds held still and frames captured over one 6.5 s puff cycle, so it loops seamlessly; 780×500 animated WebP | README banner |
| `puff-1..3.webp` | text-to-image, transparent sprite sheet of paper smoke puffs, split | animated chimney smoke |
| `cloud-1..3.webp` | text-to-image, transparent sprite sheet of paper clouds, split | drifting hero clouds |
| `blimp`, `gears`, `conveyor`, `megaphone` `.webp` | text-to-image, transparent sprite sheet of factory machines, split | README feature icons |
| `emblem.webp` | text-to-image, transparent | logo mark |

Chimney positions for the smoke are percentages of `factory-simple.webp` in `factory-art.tsx`; update them if
the hero image is regenerated.
