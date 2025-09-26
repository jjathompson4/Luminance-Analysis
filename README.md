# Luminance Analysis Web

Web-based port of the desktop HDR luminance analysis tool. Upload Radiance `.hdr` or OpenEXR `.exr` files, adjust exposure/gamma, toggle false-color overlays, calibrate luminance, inspect pixels/ROIs, and review log-scale histograms – all in the browser.

## Features

- HDR/EXR upload with tone mapping or false color visualization
- Exposure EV and gamma control with optional sRGB curve
- Interactive pixel and rectangular region probes with luminance readouts
- Single-click calibration against known luminance values
- Luminance statistics (min / max / mean) updated live
- False-color range controls with selectable colormaps and colorbar
- Log-scale histogram of calibrated or raw luminance data
- Tag management to clear annotations quickly

## Getting Started

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Then open [http://localhost:8000](http://localhost:8000) in a browser.

## Project Layout

```
app/
  main.py          # FastAPI application and API routes
  processing.py    # Image loading, tone mapping, false-color utilities
  image_store.py   # In-memory session store for uploaded HDR data
static/
  styles.css       # Minimal dark theme styling
  app.js           # Front-end interactions and API calls
index.html         # Main HTML shell served by FastAPI
requirements.txt   # Python dependencies
```

## Notes

- The server keeps uploads in memory for the current session; restart the server to clear state.
- Chart.js is loaded via CDN for the histogram visualization.
- For headless deployments use `opencv-python-headless` (already listed) to avoid GUI package requirements.
