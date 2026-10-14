# Demonstration scripts

All demonstrations run against a synthetic session and need no hardware.

## Guided demo (about two minutes)

Overview → **Guided demo**, or press `⌘K` and choose “Start guided demo”. Six acts: the room, the
measurements, the pipeline, the reconstruction, a deliberate failure, and a saved and replayed
experiment.

## Recorded walkthroughs

With a production server on port 3100 (`pnpm build && pnpm start -p 3100`):

```bash
node apps/web/scripts/showcase/record.mjs http://localhost:3100   # two videos + WebVTT subtitles
node apps/web/scripts/showcase/capture.mjs http://localhost:3100  # gallery screenshots
```

Subtitle cue times are taken from the moments the script performs each step.

## Acceptance flow

`pnpm e2e` runs the eleven-step acceptance flow from the product specification plus route,
keyboard and failure-state checks.
