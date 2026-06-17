from fastapi import APIRouter
from app.services.vision_service import VisionService

router = APIRouter()

vision_service = VisionService()

@router.get("/start-detection")
def start_detection():

    return vision_service.start()