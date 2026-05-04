# attention-morph backend

FastAPI service that backs the attention-morph frontend. Currently a
stub — real ML pipeline (attention concentration, saliency, channel
extraction, image merge) is wired in at `app/pipeline_stub.py` and can
be swapped wholesale without touching routes or storage.

## setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # on windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## run

```bash
# from inside backend/
uvicorn app.main:app --reload --port 8000
```

The frontend Vite dev server proxies `/api/*` and `/ws/*` to
`localhost:8000`, so just run both processes side by side.

## endpoints

- `POST /upload` — multipart form, field name `file`. Returns
  `{image_hash, size}`. Server-side center-crops the image and kicks
  off a background precompute of all 196 patches.
- `GET /tmp/{image_hash}/...` — static file serving for generated
  saliency maps and merged images.
- `WS /morph` — bidirectional message stream for patch processing
  requests and precompute progress. See `app/schemas.py` for the
  message shapes.

## layout

```
app/
├── main.py            # app factory, route registration, static mount
├── schemas.py         # pydantic models (WS + HTTP)
├── storage.py         # disk paths, image_hash → file resolution
├── cache.py           # (image_hash, patch) → result cache
├── precompute.py      # background precompute of all 196 patches
├── pipeline_stub.py   # FAKE ML pipeline — replace with real one
├── ws_manager.py      # tracks WS connections per image_hash
└── routes/
    ├── upload.py      # POST /upload
    └── morph_ws.py    # WS /morph
```

`tmp/` is gitignored and gets populated at runtime.
