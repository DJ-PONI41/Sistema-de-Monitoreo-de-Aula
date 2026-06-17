from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import os

from app.api.routes import router as vision_router
from app.api.dataset_routes import router as dataset_router
from app.api.train_routes import router as train_router

app = FastAPI(title="VisionProctor API")

# Register routers
app.include_router(vision_router)
app.include_router(dataset_router)
app.include_router(train_router)

# Ensure dataset directories exist
os.makedirs("dataset", exist_ok=True)

# Mount dataset directory as static files to serve cropped images in the dashboard
app.mount("/static/dataset", StaticFiles(directory="dataset"), name="dataset")

@app.get("/", response_class=HTMLResponse)
def root():
    """
    Serves the premium dashboard user interface.
    """
    static_html_path = os.path.join(os.path.dirname(__file__), "static", "classroom_monitoring_system.html")
    if os.path.exists(static_html_path):
        with open(static_html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(
        content="<h1>VisionProctor Dashboard</h1><p>El archivo classroom_monitoring_system.html no se encuentra en app/static/classroom_monitoring_system.html</p>",
        status_code=404
    )

# Mount the static files directory at root to serve CSS, JS and other assets
app.mount("/", StaticFiles(directory="app/static"), name="static")