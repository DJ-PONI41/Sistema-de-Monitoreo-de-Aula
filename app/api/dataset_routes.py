from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import FileResponse
from typing import Optional, List
import os
import shutil
import uuid
import tempfile
import random
from app.services.dataset_service import DatasetService

router = APIRouter(prefix="/api/dataset", tags=["dataset"])
dataset_service = DatasetService()

@router.get("/status")
def get_status():
    """
    Returns the current counts per class and a short preview list of recent crops.
    """
    return {
        "counts": dataset_service.get_counts(),
        "recent": dataset_service.get_recent_crops(limit=12)
    }

@router.get("/progress")
def get_progress():
    """
    Returns the current extraction process progress.
    """
    return dataset_service.get_progress()

@router.post("/stop")
def stop_processing():
    """
    Stops the currently running extraction process.
    """
    dataset_service.stop_processing()
    return {"status": "success", "message": "Procesamiento detenido por el usuario"}

@router.post("/process")
def process_video(
    label: str = Form(...),
    frame_interval: int = Form(10),
    local_path: Optional[str] = Form(None),
    files: List[UploadFile] = File(default=[]),
    flip: bool = Form(True),
    brightness: bool = Form(True),
    contrast: bool = Form(True),
    rotation: bool = Form(True),
    blur_noise: bool = Form(True),
    filter_blur: bool = Form(True),
    filter_pose: bool = Form(True)
):
    """
    Initiates video processing for one or multiple videos.
    Accepts either a list of uploaded files OR comma-separated local paths.
    """
    # Create augmentation settings dict
    augmentation_settings = {
        "flip": flip,
        "brightness": brightness,
        "contrast": contrast,
        "rotation": rotation,
        "blur_noise": blur_noise
    }

    delete_after = False
    video_paths = []

    if local_path and local_path.strip():
        # Split local paths by comma to support multiple local files
        paths = [p.strip() for p in local_path.split(",") if p.strip()]
        for p in paths:
            if not os.path.exists(p):
                return {"status": "error", "message": f"El archivo local no existe: {p}"}
            video_paths.append(p)
    elif files and len(files) > 0 and files[0].filename:
        temp_dir = tempfile.gettempdir()
        for file in files:
            if not file.filename:
                continue
            ext = os.path.splitext(file.filename)[1]
            temp_file_path = os.path.join(temp_dir, f"upload_{uuid.uuid4().hex}{ext}")
            
            try:
                with open(temp_file_path, "wb") as buffer:
                    shutil.copyfileobj(file.file, buffer)
                video_paths.append(temp_file_path)
            except Exception as e:
                # Clean up already saved temp files
                for vp in video_paths:
                    try:
                        os.unlink(vp)
                    except:
                        pass
                return {"status": "error", "message": f"Error al guardar archivo temporal: {str(e)}"}
        delete_after = True
    else:
        return {"status": "error", "message": "Debe proporcionar al menos un video (subir archivo o ingresar ruta local)"}

    if not video_paths:
        return {"status": "error", "message": "No se encontraron archivos de video válidos para procesar."}

    try:
        progress = dataset_service.start_processing(
            video_paths=video_paths,
            label=label,
            frame_interval=frame_interval,
            augmentation_settings=augmentation_settings,
            delete_after=delete_after,
            filter_blur=filter_blur,
            filter_pose=filter_pose
        )
        return {"status": "success", "message": f"Procesamiento de {len(video_paths)} videos iniciado", "progress": progress}
    except Exception as e:
        # Clean up temp files if start failed
        if delete_after:
            for vp in video_paths:
                try:
                    os.unlink(vp)
                except:
                    pass
        return {"status": "error", "message": f"No se pudo iniciar el procesamiento: {str(e)}"}

@router.get("/download")
def download_dataset():
    """
    Compiles the dataset folder into a ZIP file and triggers a browser download.
    """
    try:
        zip_path = dataset_service.zip_dataset()
        if os.path.exists(zip_path):
            return FileResponse(
                zip_path, 
                media_type="application/zip", 
                filename="vision_proctor_dataset.zip"
            )
        else:
            return {"status": "error", "message": "No se pudo generar el archivo ZIP de descarga"}
    except Exception as e:
        return {"status": "error", "message": f"Error al comprimir el dataset: {str(e)}"}

@router.post("/clear")
def clear_dataset():
    """
    Deletes all files inside the dataset directories.
    """
    counts = dataset_service.clear_dataset()
    return {"status": "success", "message": "El dataset ha sido vaciado", "counts": counts}

@router.get("/images/{cls}")
def get_class_images(cls: str):
    """
    Returns the full list of saved frame files for a specific class.
    Used to display all frames under that class in the dashboard gallery.
    """
    if cls not in ["Atento", "Distraido", "Sospechoso"]:
        return {"status": "error", "message": "Clase inválida"}
        
    folder = os.path.join(dataset_service.base_dir, cls)
    if not os.path.exists(folder):
        return {"images": []}
        
    files = [f for f in os.listdir(folder) if os.path.isfile(os.path.join(folder, f))]
    # Mezclar los archivos en desorden para mostrar caras variadas al cliente
    random.shuffle(files)
    
    return {"images": [f"/static/dataset/{cls}/{f}" for f in files]}

@router.post("/delete-frame")
def delete_frame(img_url: str):
    """
    Deletes a specific face crop frame.
    """
    parts = img_url.split("/static/dataset/")
    if len(parts) < 2:
        return {"status": "error", "message": "Ruta inválida"}
        
    relative_path = parts[1]
    # Secure validation to avoid path traversal (e.g., ../../../)
    full_path = os.path.abspath(os.path.join(dataset_service.base_dir, relative_path))
    base_dir_abs = os.path.abspath(dataset_service.base_dir)
    
    if not full_path.startswith(base_dir_abs):
        return {"status": "error", "message": "Acceso no autorizado"}
        
    if os.path.exists(full_path) and os.path.isfile(full_path):
        try:
            os.unlink(full_path)
            return {"status": "success", "message": "Imagen eliminada correctamente"}
        except Exception as e:
            return {"status": "error", "message": f"Error al eliminar la imagen: {str(e)}"}
            
    return {"status": "error", "message": "Imagen no encontrada"}

@router.get("/landmarks")
def get_landmarks(img_url: str):
    """
    Returns landmarks and pose estimation for a given image URL.
    """
    parts = img_url.split("/static/dataset/")
    if len(parts) < 2:
        return {"status": "error", "message": "Ruta inválida"}
        
    relative_path = parts[1]
    res = dataset_service.get_landmarks_and_pose(relative_path)
    if res is None:
        return {"status": "error", "message": "Imagen no encontrada o error al procesar"}
        
    return {"status": "success", "data": res}
