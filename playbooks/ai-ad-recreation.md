# Recreating a winning ad with AI (work in progress)

How to take a competitor ad that works and make our own versions of its structure with AI, without filming anyone.
Generic: no product names, competitors, audiences or copy belong here. Those go in a plan document.

## Goal

Turn one winning ad into a set of finished videos we can test. The owner sets the number and the audiences for each
run. Every video keeps the structure of the original and changes the content.

## Where things live

| What | Where |
| --- | --- |
| Goals, status and results for a run | A plan document: `pnpm product docs add <slug> --kind plan --file <path>` |
| Scene clips and finished videos | R2, through `store()` in `src/lib/storage.ts` with the `ai-ads` prefix. Link them from the plan document. |
| Working files | `local/`, which git ignores |
| This method | This file |

R2 objects are public to anyone who has the link, and the keys are content hashes.

## The steps

**Stop after each step and show the owner the result.** Do not start the next step, and do not spend money on
generation, until the owner says go.

| Step | Output | Tool |
| --- | --- | --- |
| 1. Break down | One clip per scene, plus a table: time, on screen, spoken, job, how to rebuild it | Gemini (`video-analyzer` skill), `ffmpeg` scene detection |
| 2. Script | One script per video, in the original's structure | Brand documents and the product's real features |
| 3. Scene images | One approved still per generated scene | GPT Image 2.5 |
| 4. Video | Motion only where a scene needs it | Seedance 2.5 at 480p, animating the approved still |
| 5. Assemble | Finished 9:16 videos | `ffmpeg` |
| 6. Launch | Ads in a test | `playbooks/ad-changes.md` |

## Rules

- **A scene is one continuous set-up.** Jump cuts inside it, or a new spoken line, do not make a new scene. Check real
  cuts by frame analysis, and give the owner clips to watch, not only a table.
- **Claims come from the product's brand document.** Anything shown as a feature, lesson or list must exist in the
  product.
- **No testimonials from AI people.** A generated person must not say they used or liked the product. The FTC rule on
  fake reviews and testimonials covers AI-generated ones. Have the presenter speak to the viewer instead.
- **Do not copy** the competitor's name, logo, footage, people or wording.
- **Generate only what needs it.** A flat background is an image. A list or a mock phone screen is built in code.
- **Animate the approved still.** Never regenerate a person from text alone, because the result is a different person.
