import os
import cv2
import uuid
import shutil
import threading
import time
from app.detectors.face_mesh_detector import FaceMeshDetector
from app.detectors.head_pose_estimator import HeadPoseEstimator
from app.utils.dataset_utils import setup_dataset_dirs, apply_augmentations

class DatasetService:
    def __init__(self):
        self.base_dir = setup_dataset_dirs()
        self.progress = {
            "status": "idle",  # "idle", "processing", "completed", "failed"
            "current_frame": 0,
            "total_frames": 0,
            "faces_extracted": 0,
            "augmented_generated": 0,
            "blurry_skipped": 0,
            "duplicate_skipped": 0,
            "percentage": 0,
            "current_video": "",
            "error": ""
        }
        self.detector = None
        self.pose_estimator = None
        self._thread = None
        self._stop_event = threading.Event()

    def get_counts(self):
        """
        Returns the detailed count of total, original, and augmented files in each class folder.
        """
        counts = {
            "Atento": {"total": 0, "original": 0, "augmented": 0},
            "Distraido": {"total": 0, "original": 0, "augmented": 0},
            "Sospechoso": {"total": 0, "original": 0, "augmented": 0}
        }
        
        aug_suffixes = ["_flip", "_bright", "_dark", "_hicontrast", "_locontrast", "_rotcw", "_rotccw", "_blur", "_noise"]
        
        for cls in counts.keys():
            folder = os.path.join(self.base_dir, cls)
            if os.path.exists(folder):
                files = [f for f in os.listdir(folder) if os.path.isfile(os.path.join(folder, f))]
                counts[cls]["total"] = len(files)
                
                orig = 0
                aug = 0
                for f in files:
                    name_without_ext = os.path.splitext(f)[0]
                    # Check if file name ends with any of the augmentation suffixes
                    is_aug = any(name_without_ext.endswith(suffix) for suffix in aug_suffixes)
                    if is_aug:
                        aug += 1
                    else:
                        orig += 1
                
                counts[cls]["original"] = orig
                counts[cls]["augmented"] = aug
        return counts

    def get_recent_crops(self, limit=12):
        """
        Returns the paths of the most recent crops for each class.
        """
        recent = {"Atento": [], "Distraido": [], "Sospechoso": []}
        for cls in recent.keys():
            folder = os.path.join(self.base_dir, cls)
            if os.path.exists(folder):
                files = [f for f in os.listdir(folder) if os.path.isfile(os.path.join(folder, f))]
                # Sort by modification time (newest first)
                files.sort(key=lambda x: os.path.getmtime(os.path.join(folder, x)), reverse=True)
                # Take top limits
                recent[cls] = [f"/static/dataset/{cls}/{f}" for f in files[:limit]]
        return recent

    def start_processing(self, video_paths, label, frame_interval=10, augmentation_settings=None, delete_after=False, filter_blur=True, filter_pose=True):
        """
        Starts video batch processing in a background thread.
        """
        if self.progress["status"] == "processing":
            raise ValueError("Another video batch is already being processed.")

        self.progress = {
            "status": "processing",
            "current_frame": 0,
            "total_frames": 0,
            "faces_extracted": 0,
            "augmented_generated": 0,
            "blurry_skipped": 0,
            "duplicate_skipped": 0,
            "percentage": 0,
            "queue_index": 1,
            "queue_total": len(video_paths),
            "current_video": os.path.basename(video_paths[0]),
            "error": ""
        }
        self._stop_event.clear()
        
        self._thread = threading.Thread(
            target=self._process_video_thread,
            args=(video_paths, label, frame_interval, augmentation_settings, delete_after, filter_blur, filter_pose),
            daemon=True
        )
        self._thread.start()
        return self.progress

    def stop_processing(self):
        """
        Stops the current video processing thread.
        """
        if self.progress["status"] == "processing":
            self._stop_event.set()
            self.progress["status"] = "idle"
            self.progress["error"] = "Procesamiento detenido por el usuario."

    def get_progress(self):
        """
        Returns the current processing progress.
        """
        return self.progress

    def zip_dataset(self):
        """
        Zips the dataset folder and returns the file path.
        """
        zip_base_name = "vision_proctor_dataset"
        zip_path = shutil.make_archive(zip_base_name, 'zip', self.base_dir)
        return zip_path

    def clear_dataset(self):
        """
        Clears all dataset files but keeps the directory structure.
        """
        for cls in ["Atento", "Distraido", "Sospechoso"]:
            folder = os.path.join(self.base_dir, cls)
            if os.path.exists(folder):
                for f in os.listdir(folder):
                    file_path = os.path.join(folder, f)
                    try:
                        if os.path.isfile(file_path):
                            os.unlink(file_path)
                    except Exception as e:
                        print(f"Error deleting file {file_path}: {e}")
        return self.get_counts()

    def _process_video_thread(self, video_paths, label, frame_interval, augmentation_settings, delete_after, filter_blur, filter_pose):
        """
        Core logic to extract face crops and augment them inside a thread.
        Processes multiple videos sequentially.
        """
        # Initialize detector if not done yet
        if self.detector is None:
            try:
                self.detector = FaceMeshDetector()
            except Exception as e:
                self.progress["status"] = "failed"
                self.progress["error"] = f"Failed to initialize FaceMeshDetector: {str(e)}"
                return

        # Initialize pose estimator if not done yet
        if self.pose_estimator is None:
            try:
                self.pose_estimator = HeadPoseEstimator()
            except Exception as e:
                self.progress["status"] = "failed"
                self.progress["error"] = f"Failed to initialize HeadPoseEstimator: {str(e)}"
                return

        faces_count = 0
        augmented_count = 0
        blurry_skipped = 0
        duplicate_skipped = 0
        last_pose = None
        total_videos = len(video_paths)

        try:
            for idx, video_path in enumerate(video_paths):
                if self._stop_event.is_set():
                    break

                self.progress["queue_index"] = idx + 1
                self.progress["queue_total"] = total_videos
                self.progress["current_video"] = os.path.basename(video_path)
                self.progress["current_frame"] = 0
                self.progress["percentage"] = 0

                cap = cv2.VideoCapture(video_path)
                if not cap.isOpened():
                    print(f"Error opening video: {video_path}")
                    if delete_after:
                        try:
                            if os.path.exists(video_path):
                                os.unlink(video_path)
                        except:
                            pass
                    continue

                total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                self.progress["total_frames"] = total_frames

                video_filename = os.path.splitext(os.path.basename(video_path))[0]
                video_filename = "".join(c for c in video_filename if c.isalnum() or c in ("_", "-")).rstrip()

                frame_idx = 0

                while cap.isOpened() and not self._stop_event.is_set():
                    ret, frame = cap.read()
                    if not ret:
                        break

                    # Process every 'frame_interval' frames
                    if frame_idx % frame_interval == 0:
                        results = self.detector.process(frame)
                        img_h, img_w = frame.shape[:2]

                        if results and results.face_landmarks:
                            for face_idx, face in enumerate(results.face_landmarks):
                                # Calculate bounding box of face
                                x_coords = [landmark.x * img_w for landmark in face]
                                y_coords = [landmark.y * img_h for landmark in face]
                                
                                x_min = int(min(x_coords))
                                x_max = int(max(x_coords))
                                y_min = int(min(y_coords))
                                y_max = int(max(y_coords))

                                # Crop margin padding (20%)
                                w_face = x_max - x_min
                                h_face = y_max - y_min
                                margin_w = int(w_face * 0.2)
                                margin_h = int(h_face * 0.2)

                                x_min_padded = max(0, x_min - margin_w)
                                x_max_padded = min(img_w, x_max + margin_w)
                                y_min_padded = max(0, y_min - margin_h)
                                y_max_padded = min(img_h, y_max + margin_h)

                                face_crop = frame[y_min_padded:y_max_padded, x_min_padded:x_max_padded]

                                if face_crop.size > 0 and face_crop.shape[0] > 20 and face_crop.shape[1] > 20:
                                    # Mask background (black-out outside of face convex hull)
                                    try:
                                        import numpy as np
                                        crop_h, crop_w = face_crop.shape[:2]
                                        points = []
                                        for lm in face:
                                            pixel_x = int(lm.x * img_w) - x_min_padded
                                            pixel_y = int(lm.y * img_h) - y_min_padded
                                            points.append([pixel_x, pixel_y])
                                        points = np.array(points, dtype=np.int32)
                                        
                                        hull = cv2.convexHull(points)
                                        mask = np.zeros((crop_h, crop_w), dtype=np.uint8)
                                        cv2.fillConvexPoly(mask, hull, 255)
                                        face_crop = cv2.bitwise_and(face_crop, face_crop, mask=mask)
                                    except Exception as e:
                                        # Fallback to centered ellipse mask in case of error
                                        crop_h, crop_w = face_crop.shape[:2]
                                        mask = np.zeros((crop_h, crop_w), dtype=np.uint8)
                                        center = (crop_w // 2, crop_h // 2)
                                        axes = (int(crop_w * 0.43), int(crop_h * 0.49))
                                        cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)
                                        face_crop = cv2.bitwise_and(face_crop, face_crop, mask=mask)

                                    # 1. Blur filter check (Nitidez)
                                    if filter_blur:
                                        blur_val = cv2.Laplacian(face_crop, cv2.CV_64F).var()
                                        if blur_val < 80.0:
                                            blurry_skipped += 1
                                            self.progress["blurry_skipped"] = blurry_skipped
                                            continue

                                    # 2. Pose filter check (Diversidad de postura)
                                    if filter_pose:
                                        try:
                                            x_rot, y_rot, z_rot = self.pose_estimator.estimate(face, img_w, img_h)
                                            if last_pose is not None:
                                                diff_x = abs(x_rot - last_pose[0])
                                                diff_y = abs(y_rot - last_pose[1])
                                                diff_z = abs(z_rot - last_pose[2])
                                                if diff_x < 4.0 and diff_y < 4.0 and diff_z < 4.0:
                                                    duplicate_skipped += 1
                                                    self.progress["duplicate_skipped"] = duplicate_skipped
                                                    continue
                                            last_pose = (x_rot, y_rot, z_rot)
                                        except Exception as ex:
                                            pass
                                    else:
                                        try:
                                            x_rot, y_rot, z_rot = self.pose_estimator.estimate(face, img_w, img_h)
                                            last_pose = (x_rot, y_rot, z_rot)
                                        except:
                                            pass

                                    faces_count += 1
                                    # Generate unique filename
                                    unique_id = str(uuid.uuid4())[:8]
                                    file_name = f"{video_filename}_f{frame_idx}_face{face_idx}_{unique_id}.jpg"
                                    save_path = os.path.join(self.base_dir, label, file_name)
                                    
                                    # Save original face crop
                                    cv2.imwrite(save_path, face_crop)

                                    # Apply augmentations
                                    if augmentation_settings:
                                        aug_images = apply_augmentations(face_crop, augmentation_settings)
                                        for suffix, aug_img in aug_images.items():
                                            aug_file_name = f"{video_filename}_f{frame_idx}_face{face_idx}_{unique_id}{suffix}.jpg"
                                            aug_save_path = os.path.join(self.base_dir, label, aug_file_name)
                                            cv2.imwrite(aug_save_path, aug_img)
                                            augmented_count += 1

                    frame_idx += 1
                    
                    # Update progress state
                    percentage = int((frame_idx / total_frames) * 100) if total_frames > 0 else 0
                    self.progress["current_frame"] = frame_idx
                    self.progress["faces_extracted"] = faces_count
                    self.progress["augmented_generated"] = augmented_count
                    self.progress["percentage"] = percentage

                cap.release()
                if delete_after:
                    try:
                        if os.path.exists(video_path):
                            os.unlink(video_path)
                    except Exception as e:
                        print(f"Error deleting temporary video file {video_path}: {e}")

            # Check if execution stopped due to finishing or event
            if self._stop_event.is_set():
                self.progress["status"] = "idle"
            else:
                self.progress["status"] = "completed"
                self.progress["percentage"] = 100

        except Exception as e:
            self.progress["status"] = "failed"
            self.progress["error"] = f"Error during processing: {str(e)}"
        finally:
            # Cleanup all remaining temp video files in queue if stopped or crashed
            if delete_after:
                for video_path in video_paths:
                    try:
                        if os.path.exists(video_path):
                            os.unlink(video_path)
                    except:
                        pass

    def get_landmarks_and_pose(self, relative_img_path):
        """
        Reads a cropped face image from the dataset folder, runs face mesh landmarking,
        and estimates head pose angles (pitch, yaw, roll).
        """
        full_path = os.path.abspath(os.path.join(self.base_dir, relative_img_path))
        base_dir_abs = os.path.abspath(self.base_dir)
        
        # Security check to prevent directory traversal
        if not full_path.startswith(base_dir_abs):
            return None
            
        if not os.path.exists(full_path):
            return None
            
        # Initialize detector & pose estimator if they are None
        if self.detector is None:
            self.detector = FaceMeshDetector()
        if self.pose_estimator is None:
            self.pose_estimator = HeadPoseEstimator()
            
        img = cv2.imread(full_path)
        if img is None:
            return None
            
        img_h, img_w = img.shape[:2]
        results = self.detector.process(img)
        
        if results and results.face_landmarks:
            face = results.face_landmarks[0]
            landmarks = [{"x": lm.x, "y": lm.y} for lm in face]
            
            try:
                pitch, yaw, roll = self.pose_estimator.estimate(face, img_w, img_h)
                pose = {"pitch": round(pitch, 1), "yaw": round(yaw, 1), "roll": round(roll, 1)}
            except Exception as e:
                print(f"Error estimating pose in preview: {e}")
                pose = None
                
            return {"landmarks": landmarks, "pose": pose}
            
        return {"landmarks": [], "pose": None}
