# attention-morph backend

Static-data backend for the attention-morph frontend. All ML
(classification, attribution, saliency) is precomputed offline. The
runtime backend has only one nontrivial job: per dwell, run the
saliency-driven blending function to produce a merged image.

## setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # on windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Then **paste your `composite()` implementation** into:

```
backend/app/pipeline/composite.py
```

The placeholder will raise `NotImplementedError` until you do.

## run

```bash
# from inside backend/
uvicorn app.main:app --reload --port 8000
```

The frontend Vite dev server proxies `/api/*` and `/ws/*` to
`localhost:8000`, so just run both processes side by side.

## data layout

The runtime backend assumes precomputed data is laid out under
`backend/data/`:

```
backend/data/
├── manifest.json                    # { "default_image_ids": [...] }
├── images/
│   ├── dog.png
│   ├── hotdog.png
│   ├── cat.png
│   └── coffee.png
├── channels/
│   ├── 0.png ... 191.png            # rep-max images, DeiT-Tiny block 11
└── precomputed/
    ├── dog.json                     # baseline + 196 patches
    ├── dog/
    │   ├── original_saliency_display.png
    │   ├── original_saliency_raw.png
    │   ├── 0_0_saliency_display.png
    │   ├── 0_0_saliency_raw.png
    │   └── ...                      # 196 × 2 PNGs
    └── ...
```

`tmp/` is gitignored and gets populated at runtime with merged images.

## endpoints

- `GET /manifest` → `ManifestResponse` listing the 4 default images
  with their baseline classifications.
- `GET /images/<image_id>.png` → source images (static).
- `GET /channels/<id>.png` → rep-max images (static).
- `GET /precomputed/<image_id>/...` → saliency PNGs (static).
- `GET /tmp/<image_id>/<r>_<c>/merged.png` → runtime-rendered merged
  images (static, populated lazily by WS requests).
- `WS /morph` — patch processing requests. See `app/schemas.py`.

## layout

```
app/
├── main.py                # FastAPI app, lifespan, static mounts
├── schemas.py             # pydantic models (WS + HTTP)
├── storage.py             # disk paths, URL helpers
├── precomputed_loader.py  # loads JSONs into memory at startup
├── pipeline/
│   ├── composite.py       # ← paste your composite() here
│   └── blending.py        # I/O wrapper around composite()
└── routes/
    ├── manifest.py        # GET /manifest
    └── morph_ws.py        # WS /morph
```
