# Gaze-Driven Attention Visualization

Interactive system: mouse dwell on a 14×14 patch grid → attention concentration
→ saliency + top channels → animated blend of rep max visualizations.

## Project Structure

```
gaze-viz/
├── index.html
├── vite.config.ts          # proxies /api → localhost:8000
├── src/
│   ├── main.ts             # app orchestrator
│   ├── style.css
│   ├── types/index.ts      # shared TS interfaces
│   └── modules/
│       ├── DwellTracker.ts     # mouse→patch dwell detection
│       ├── BackendClient.ts    # HTTP client for Python API
│       ├── RepMaxStore.ts      # preloads all rep max images
│       ├── BlendEngine.ts      # pixel blending + animation
│       └── OverlayRenderer.ts  # dwell progress HUD
└── backend/
    ├── main.py             # FastAPI app + routes
    ├── model.py            # DeiT-Tiny loading + hooks
    ├── pipeline.py         # attention concentration, saliency, channels
    └── requirements.txt
```

## Setup

### Frontend
```bash
npm install
npm run dev       # starts at http://localhost:5173
```

Place your input image at `public/input.jpg`.

Place rep max visualizations at `public/rep_max/channel_0.jpg` through
`public/rep_max/channel_N.jpg` where N = totalChannels - 1.

### Backend
```bash
cd backend
pip install -r requirements.txt
# Download ImageNet class names:
curl -o imagenet_classes.txt https://raw.githubusercontent.com/pytorch/hub/master/imagenet_classes.txt
uvicorn main:app --reload --port 8000
```

## TODOs (fill these in with your existing implementations)

| File | Location | What to fill in |
|------|----------|-----------------|
| `backend/pipeline.py` | `apply_attention_concentration()` | Your attention concentration method |
| `backend/pipeline.py` | `compute_saliency()` | Your saliency method (replace gradient stub) |
| `backend/model.py` | `_patch_attn_for_weights()` | timm attention hook for weight capture |
| `src/modules/BlendEngine.ts` | `computeTargetBlend()` | Store originalImageData separately in `drawImage()` |
| `src/main.ts` | dwell slider | Wire up the `#dwell-slider` input to update DwellTracker |
| `src/types/index.ts` | `totalChannels` | Confirm DeiT-Tiny's last-block channel count |

## Data Flow

```
Mouse move → DwellTracker (14×14 grid, 5s threshold)
    ↓ onDwell
BackendClient.getAttentionResult(image, patch)
    ↓ POST /api/attention
pipeline.run_pipeline()
    ├─ apply_attention_concentration(x, row, col)
    ├─ model.forward_with_hooks(x_modified)
    ├─ extract_top_channels(patch_tokens, top_k=3)
    └─ compute_saliency(x_modified, class_idx)
    ↓ AttentionResponse JSON
BlendEngine.triggerBlend(response)
    ├─ snapshot current canvas → fromData
    ├─ computeTargetBlend() → toData
    │    ├─ upsample saliency 14×14 → full resolution
    │    ├─ upsample per-channel spatial weights
    │    └─ pixel: s*original + (1-s)*(Σ actWeight*spatWeight*repMax_i)
    └─ requestAnimationFrame lerp fromData → toData over 2.5s
```