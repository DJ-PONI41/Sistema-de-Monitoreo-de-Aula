from fastapi import APIRouter
from pydantic import BaseModel
from app.services.train_service import TrainService

router = APIRouter(prefix="/api/train", tags=["train"])
train_service = TrainService()

class FramePayload(BaseModel):
    image: str # Base64 encoded string
    camera_pitch_offset: float = 0.0

@router.post("/start")
def start_training(epochs: int = 5, batch_size: int = 16, lr: float = 1e-4):
    """
    Inicia el entrenamiento del modelo MobileViT en segundo plano.
    """
    try:
        progress = train_service.start_training(epochs=epochs, batch_size=batch_size, lr=lr)
        return {"status": "success", "message": "Entrenamiento iniciado", "progress": progress}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.post("/stop")
def stop_training():
    """
    Detiene el proceso de entrenamiento activo.
    """
    train_service.stop_training()
    return {"status": "success", "message": "Entrenamiento detenido por el usuario"}

@router.get("/status")
def get_status():
    """
    Retorna el progreso actual del entrenamiento (época, batch, loss, acc).
    """
    return train_service.get_progress()

@router.get("/metrics")
def get_metrics():
    """
    Retorna las métricas de evaluación final (reporte, matriz de confusión, curvas).
    """
    metrics = train_service.get_metrics()
    if metrics is None:
        return {"status": "error", "message": "Métricas no disponibles. Por favor completa el entrenamiento primero."}
    return {"status": "success", "metrics": metrics}

@router.post("/predict")
def predict_frame(payload: FramePayload):
    """
    Recibe un frame en Base64, detecta el rostro, estima pose y predice comportamiento con el modelo MobileViT.
    """
    import base64
    import numpy as np
    import cv2
    
    try:
        header, encoded = payload.image.split(",", 1) if "," in payload.image else ("", payload.image)
        data = base64.b64decode(encoded)
        nparr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            return {"status": "error", "message": "No se pudo decodificar la imagen."}
            
        res = train_service.predict_frame(img, camera_pitch_offset=payload.camera_pitch_offset)
        return res
    except Exception as e:
        return {"status": "error", "message": str(e)}
