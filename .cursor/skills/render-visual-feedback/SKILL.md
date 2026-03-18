---
name: render-visual-feedback
description: Captures world and city screenshots and verifies WebGL renderer mode for visual rendering changes. Use when editing city/world rendering, scene layout, camera, lighting, shadows, colors, windows, or when the user asks for visual feedback.
---
# Render Visual Feedback

Use this whenever a task changes how the city/world looks.

## Quick loop

1. Run `VISUAL_BOOTSTRAP=false npm run capture:3d` for fast iteration.
2. Check `artifacts/visual-feedback/manifest.json`:
   - `renderer.cityStageMode` must be `webgl2` or `webgl`
   - `renderer.requireWebgl` should be `true`
3. Inspect:
   - `artifacts/visual-feedback/world.png`
   - `artifacts/visual-feedback/city.png`
   - `artifacts/visual-feedback/city-stage.png`
4. If rendering still looks mid-transition, rerun with stronger settle:
   - `RENDER_DEBOUNCE_MS=3000 RENDER_STABLE_SAMPLES=4 VISUAL_BOOTSTRAP=false npm run capture:3d`

## Report back

In the final response, state whether colors, shadows, and windows improved/regressed, and include screenshot paths.

## Apply when

- Editing `packages/web/src/scene/*`
- Editing `packages/web/src/main.ts`
- Editing `packages/web/src/world-surface-canvas.ts`
- User mentions screenshot, render quality, visual feedback, colors, shadows, or windows
