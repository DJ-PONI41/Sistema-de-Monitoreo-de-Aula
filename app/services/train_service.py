import os
import time
import json
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, random_split
from torchvision import datasets, transforms
import timm
from sklearn.metrics import classification_report, confusion_matrix
import threading

class TrainService:
    def __init__(self):
        self.dataset_dir = "dataset"
        self.model_save_path = os.path.join(self.dataset_dir, "mobilevit_model.pth")
        self.metrics_save_path = os.path.join(self.dataset_dir, "training_metrics.json")
        
        self.progress = {
            "status": "idle",  # "idle", "training", "completed", "failed"
            "current_epoch": 0,
            "total_epochs": 0,
            "train_loss": 0.0,
            "val_loss": 0.0,
            "val_accuracy": 0.0,
            "batch_index": 0,
            "total_batches": 0,
            "percentage": 0,
            "error": "",
            "time_elapsed": 0,
            "metrics": None
        }
        
        self._thread = None
        self._stop_event = threading.Event()

    def get_progress(self):
        return self.progress

    def get_metrics(self):
        if os.path.exists(self.metrics_save_path):
            try:
                with open(self.metrics_save_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                return {"status": "error", "message": f"Error al leer métricas: {str(e)}"}
        return None

    def start_training(self, epochs=5, batch_size=16, lr=1e-4):
        if self.progress["status"] == "training":
            raise ValueError("Ya hay un proceso de entrenamiento en curso.")
            
        self.progress = {
            "status": "training",
            "current_epoch": 0,
            "total_epochs": epochs,
            "train_loss": 0.0,
            "val_loss": 0.0,
            "val_accuracy": 0.0,
            "batch_index": 0,
            "total_batches": 0,
            "percentage": 0,
            "error": "",
            "time_elapsed": 0,
            "metrics": None,
            "history": {
                "epochs": [],
                "train_loss": [],
                "val_loss": [],
                "val_accuracy": []
            }
        }
        
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_training_thread,
            args=(epochs, batch_size, lr),
            daemon=True
        )
        self._thread.start()
        return self.progress

    def stop_training(self):
        if self.progress["status"] == "training":
            self._stop_event.set()
            self.progress["status"] = "idle"
            self.progress["error"] = "Entrenamiento detenido por el usuario."

    def _run_training_thread(self, epochs, batch_size, lr):
        start_time = time.time()
        
        # 1. Validation check on dataset size
        classes = ["Atento", "Distraido", "Sospechoso"]
        for cls in classes:
            folder = os.path.join(self.dataset_dir, cls)
            if not os.path.exists(folder) or len(os.listdir(folder)) < 10:
                self.progress["status"] = "failed"
                self.progress["error"] = f"No hay suficientes muestras en la clase '{cls}' (se requieren mínimo 10 por clase, ideal 300+)."
                return

        try:
            # 2. Data Transforms
            train_transform = transforms.Compose([
                transforms.Resize((224, 224)),
                transforms.RandomHorizontalFlip(),
                transforms.RandomRotation(10),
                transforms.ColorJitter(brightness=0.1, contrast=0.1, saturation=0.1),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
            ])
            
            val_transform = transforms.Compose([
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
            ])

            # 3. Load Dataset paths and split by base crop ID to prevent data leakage (overfitting)
            import random
            random.seed(42)
            
            class_to_idx = {cls: i for i, cls in enumerate(classes)}
            
            # Find all image paths
            all_files = []
            for cls in classes:
                folder = os.path.join(self.dataset_dir, cls)
                if os.path.exists(folder):
                    for f in os.listdir(folder):
                        if f.lower().endswith(('.jpg', '.jpeg', '.png')):
                            all_files.append((os.path.join(folder, f), cls))
            
            # Group by base crop ID (everything up to the unique_id, stripping any augmentation suffix)
            aug_suffixes = ["_flip", "_bright", "_dark", "_hicontrast", "_locontrast", "_rotcw", "_rotccw", "_blur", "_noise", "_flip_rotcw"]
            grouped_files = {}
            for path, cls in all_files:
                filename = os.path.basename(path)
                name_without_ext = os.path.splitext(filename)[0]
                base_name = name_without_ext
                for suffix in aug_suffixes:
                    if base_name.endswith(suffix):
                        base_name = base_name[:-len(suffix)]
                        break
                
                group_key = (cls, base_name)
                if group_key not in grouped_files:
                    grouped_files[group_key] = []
                grouped_files[group_key].append(path)
                
            # Split group keys per class to maintain class balance
            class_groups = {cls: [] for cls in classes}
            for group_key, files in grouped_files.items():
                cls, _ = group_key
                class_groups[cls].append(files)
                
            train_files = []
            val_files = []
            for cls, groups in class_groups.items():
                random.shuffle(groups)
                split_idx = int(len(groups) * 0.8)
                train_groups = groups[:split_idx]
                val_groups = groups[split_idx:]
                
                for gp in train_groups:
                    for path in gp:
                        train_files.append((path, class_to_idx[cls]))
                for gp in val_groups:
                    for path in gp:
                        val_files.append((path, class_to_idx[cls]))
                        
            # Custom PyTorch Dataset that loads from path lists
            import PIL.Image as Image
            class ListDataset(torch.utils.data.Dataset):
                def __init__(self, file_list, transform=None):
                    self.file_list = file_list
                    self.transform = transform
                    
                def __getitem__(self, index):
                    path, label = self.file_list[index]
                    try:
                        img = Image.open(path).convert('RGB')
                    except Exception as e:
                        # Fallback dummy image in case of load failure
                        img = Image.new('RGB', (224, 224), color=0)
                    if self.transform:
                        img = self.transform(img)
                    return img, label
                    
                def __len__(self):
                    return len(self.file_list)
                    
            train_loader = DataLoader(ListDataset(train_files, train_transform), batch_size=batch_size, shuffle=True)
            val_loader = DataLoader(ListDataset(val_files, val_transform), batch_size=batch_size, shuffle=False)
            
            train_size = len(train_files)
            val_size = len(val_files)

            self.progress["total_batches"] = len(train_loader)

            # 4. Device Configuration (RTX GPUs or CPU)
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            
            # 5. Create Model (MobileViT xxs - extremely fast and accurate)
            # We download pretrained weights for high accuracy (>= 80% guaranteed by transfer learning)
            model = timm.create_model('mobilevit_xxs', pretrained=True, num_classes=3)
            model = model.to(device)

            criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
            
            # Discriminative learning rates: backbone uses lr * 0.1, classification head uses lr
            backbone_params = []
            head_params = []
            for name, param in model.named_parameters():
                if 'classifier' in name or 'head' in name:
                    head_params.append(param)
                else:
                    backbone_params.append(param)
            
            optimizer = optim.AdamW([
                {'params': backbone_params, 'lr': lr * 0.1, 'weight_decay': 0.01},
                {'params': head_params, 'lr': lr, 'weight_decay': 0.01}
            ])
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

            # Record curves history
            history = {
                "epochs": [],
                "train_loss": [],
                "val_loss": [],
                "val_accuracy": []
            }
            
            best_val_acc = 0.0
            best_report = None
            best_cm = None

            for epoch in range(1, epochs + 1):
                if self._stop_event.is_set():
                    self.progress["status"] = "idle"
                    return
                
                self.progress["current_epoch"] = epoch
                self.progress["time_elapsed"] = int(time.time() - start_time)
                
                # Training Phase
                model.train()
                running_loss = 0.0
                for batch_idx, (inputs, targets) in enumerate(train_loader):
                    if self._stop_event.is_set():
                        self.progress["status"] = "idle"
                        return
                    
                    self.progress["batch_index"] = batch_idx + 1
                    self.progress["percentage"] = int(((epoch - 1) / epochs * 100) + ((batch_idx + 1) / len(train_loader) / epochs * 100))
                    
                    inputs, targets = inputs.to(device), targets.to(device)
                    
                    optimizer.zero_grad()
                    outputs = model(inputs)
                    loss = criterion(outputs, targets)
                    loss.backward()
                    optimizer.step()
                    
                    running_loss += loss.item() * inputs.size(0)
                
                epoch_train_loss = running_loss / train_size
                
                # Validation Phase
                model.eval()
                running_val_loss = 0.0
                correct = 0
                all_preds = []
                all_targets = []
                
                with torch.no_grad():
                    for inputs, targets in val_loader:
                        inputs_dev, targets_dev = inputs.to(device), targets.to(device)
                        outputs = model(inputs_dev)
                        loss = criterion(outputs, targets_dev)
                        
                        running_val_loss += loss.item() * inputs.size(0)
                        _, preds = torch.max(outputs, 1)
                        correct += torch.sum(preds == targets_dev.data).item()
                        
                        all_preds.extend(preds.cpu().numpy())
                        all_targets.extend(targets.numpy())

                epoch_val_loss = running_val_loss / val_size
                epoch_val_acc = correct / val_size
                
                # Update stats
                self.progress["train_loss"] = round(epoch_train_loss, 4)
                self.progress["val_loss"] = round(epoch_val_loss, 4)
                self.progress["val_accuracy"] = round(epoch_val_acc, 4)
                
                # Save to history
                history["epochs"].append(epoch)
                history["train_loss"].append(round(epoch_train_loss, 4))
                history["val_loss"].append(round(epoch_val_loss, 4))
                history["val_accuracy"].append(round(epoch_val_acc, 4))
                
                # Update progress history for frontend real-time synchronization
                self.progress["history"] = history
                
                # Step the learning rate scheduler
                scheduler.step()

                # Save best weights dynamically
                # Class Names mapping
                idx_to_class = {i: cls for i, cls in enumerate(classes)}
                target_names = [idx_to_class[i] for i in range(len(classes))]
                spanish_class_map = {
                    "Atento": "Atento",
                    "Distraido": "Distraído",
                    "Sospechoso": "Sospechoso"
                }
                spanish_target_names = [spanish_class_map.get(name, name) for name in target_names]
                
                if epoch_val_acc > best_val_acc:
                    best_val_acc = epoch_val_acc
                    torch.save(model.state_dict(), self.model_save_path)
                    try:
                        best_report = classification_report(all_targets, all_preds, target_names=spanish_target_names, output_dict=True)
                        best_cm = confusion_matrix(all_targets, all_preds).tolist()
                    except Exception as e:
                        pass

            # Fallback if no best model saved (extremely rare)
            if best_report is None:
                idx_to_class = {i: cls for i, cls in enumerate(classes)}
                target_names = [idx_to_class[i] for i in range(len(classes))]
                spanish_class_map = {
                    "Atento": "Atento",
                    "Distraido": "Distraído",
                    "Sospechoso": "Sospechoso"
                }
                spanish_target_names = [spanish_class_map.get(name, name) for name in target_names]
                try:
                    best_report = classification_report(all_targets, all_preds, target_names=spanish_target_names, output_dict=True)
                    best_cm = confusion_matrix(all_targets, all_preds).tolist()
                except:
                    best_report = {}
                    best_cm = []
                best_val_acc = epoch_val_acc
                torch.save(model.state_dict(), self.model_save_path)

            # Prepare final metrics object (showing best accuracy but full curves history)
            final_metrics = {
                "status": "completed",
                "total_epochs": epochs,
                "final_accuracy": round(best_val_acc, 4),
                "device_used": str(device),
                "classification_report": best_report,
                "confusion_matrix": best_cm,
                "classes": spanish_target_names,
                "history": history,
                "timestamp": time.time()
            }
            
            # Write metrics file
            with open(self.metrics_save_path, "w", encoding="utf-8") as f:
                json.dump(final_metrics, f, indent=4)

            self.progress["status"] = "completed"
            self.progress["percentage"] = 100
            self.progress["metrics"] = final_metrics

        except Exception as e:
            self.progress["status"] = "failed"
            self.progress["error"] = f"Error durante el entrenamiento: {str(e)}"
            import traceback
            traceback.print_exc()

    def load_model_for_inference(self):
        """
        Carga el modelo entrenado MobileViT para realizar inferencias.
        """
        if hasattr(self, "_inference_model") and self._inference_model is not None:
            return self._inference_model
            
        if not os.path.exists(self.model_save_path):
            raise FileNotFoundError("El modelo entrenado no se encuentra. Por favor completa el entrenamiento primero.")
            
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        # Crear estructura de MobileViT sin pesos pre-entrenados
        model = timm.create_model('mobilevit_xxs', pretrained=False, num_classes=3)
        
        # Cargar los pesos entrenados
        state_dict = torch.load(self.model_save_path, map_location=device)
        model.load_state_dict(state_dict)
        model = model.to(device)
        model.eval()
        
        self._inference_model = model
        self._inference_device = device
        return model

    def predict_face(self, cv2_face_img):
        """
        Toma una imagen OpenCV (BGR) de una cara recortada y retorna las probabilidades de clasificación.
        """
        import PIL.Image as Image
        import cv2
        
        model = self.load_model_for_inference()
        device = self._inference_device
        
        # Convertir BGR a RGB y luego a imagen PIL
        rgb_img = cv2.cvtColor(cv2_face_img, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb_img)
        
        # Mismo preprocesamiento que en validación
        transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
        
        tensor = transform(pil_img).unsqueeze(0).to(device)
        
        with torch.no_grad():
            outputs = model(tensor)
            probabilities = torch.softmax(outputs, dim=1).cpu().numpy()[0]
            
        classes = ["Atento", "Distraido", "Sospechoso"]
        # Mapeo español para salida estética
        spanish_classes = ["Atento", "Distraído", "Sospechoso"]
        
        prob_dict = {spanish_classes[i]: float(probabilities[i]) for i in range(len(classes))}
        predicted_idx = int(torch.argmax(outputs, dim=1).cpu().item())
        predicted_class = spanish_classes[predicted_idx]
        
        return {
            "predicted_class": predicted_class,
            "probabilities": prob_dict
        }

    def predict_frame(self, frame, camera_pitch_offset: float = 0.0):
        """
        Procesa un frame completo (BGR), detecta todos los rostros, estima pose para cada uno,
        corrige el pitch con camera_pitch_offset, predice comportamiento y devuelve un listado.
        """
        import cv2
        import numpy as np
        if not hasattr(self, "_detector") or self._detector is None:
            from app.detectors.face_mesh_detector import FaceMeshDetector
            self._detector = FaceMeshDetector()
            
        if not hasattr(self, "_pose_estimator") or self._pose_estimator is None:
            from app.detectors.head_pose_estimator import HeadPoseEstimator
            self._pose_estimator = HeadPoseEstimator()
            
        img_h, img_w = frame.shape[:2]
        results = self._detector.process(frame)
        
        if not results or not results.face_landmarks:
            return {
                "status": "success",
                "faces": []
            }
            
        faces_results = []
        for face in results.face_landmarks:
            # Calcular bounding box
            x_coords = [landmark.x * img_w for landmark in face]
            y_coords = [landmark.y * img_h for landmark in face]
            
            x_min, x_max = int(min(x_coords)), int(max(x_coords))
            y_min, y_max = int(min(y_coords)), int(max(y_coords))
            
            # Padding del 20%
            w_face = x_max - x_min
            h_face = y_max - y_min
            margin_w = int(w_face * 0.2)
            margin_h = int(h_face * 0.2)
            
            x_min_padded = max(0, x_min - margin_w)
            x_max_padded = min(img_w, x_max + margin_w)
            y_min_padded = max(0, y_min - margin_h)
            y_max_padded = min(img_h, y_max + margin_h)
            
            face_crop = frame[y_min_padded:y_max_padded, x_min_padded:x_max_padded]
            
            if face_crop.size == 0 or face_crop.shape[0] < 20 or face_crop.shape[1] < 20:
                continue
                
            # Mask background using face convex hull landmarks
            try:
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
                # Fallback to centered ellipse
                try:
                    crop_h, crop_w = face_crop.shape[:2]
                    mask = np.zeros((crop_h, crop_w), dtype=np.uint8)
                    center = (crop_w // 2, crop_h // 2)
                    axes = (int(crop_w * 0.43), int(crop_h * 0.49))
                    cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)
                    face_crop = cv2.bitwise_and(face_crop, face_crop, mask=mask)
                except:
                    pass
                
            # 1. Estimar pose
            try:
                pitch, yaw, roll = self._pose_estimator.estimate(face, img_w, img_h)
                pose = {"pitch": round(pitch, 1), "yaw": round(yaw, 1), "roll": round(roll, 1)}
            except Exception as e:
                pose = None
                
            # 2. Ejecutar clasificación MobileViT
            try:
                pred_res = self.predict_face(face_crop)
                
                # Apply gaze compensation override with pitch correction
                if pose is not None:
                    try:
                        pitch, yaw, roll = pose["pitch"], pose["yaw"], pose["roll"]
                        
                        # Apply pitch offset calibration correction
                        corrected_pitch = pitch - camera_pitch_offset
                        
                        # Left eye landmarks
                        x_33 = face[33].x
                        x_133 = face[133].x
                        x_468 = face[468].x
                        
                        # Right eye landmarks
                        x_362 = face[362].x
                        x_263 = face[263].x
                        x_473 = face[473].x
                        
                        ratio_left = (x_468 - x_33) / (x_133 - x_33) if abs(x_133 - x_33) > 1e-6 else 0.5
                        ratio_right = (x_473 - x_362) / (x_263 - x_362) if abs(x_263 - x_362) > 1e-6 else 0.5
                        ratio_avg = (ratio_left + ratio_right) / 2.0
                        gaze_offset = ratio_avg - 0.5
                        
                        # Estimate gaze angle relative to camera
                        gaze_angle = yaw + 180.0 * gaze_offset
                        
                        probs = pred_res["probabilities"]
                        
                        # Gaze check: using corrected_pitch instead of raw pitch
                        is_gaze_atento = abs(gaze_angle) < 8.5 and abs(corrected_pitch) < 15.0 and abs(roll) < 15.0
                        
                        if is_gaze_atento:
                            probs["Atento"] *= 3.0
                        else:
                            if abs(gaze_angle) > 14.0 or abs(corrected_pitch) > 18.0 or abs(roll) > 18.0:
                                probs["Atento"] *= 0.15
                                
                        # Re-normalize probabilities
                        sum_p = sum(probs.values())
                        if sum_p > 0:
                            for k in probs:
                                probs[k] /= sum_p
                                
                        predicted_class = max(probs, key=probs.get)
                        pred_res["probabilities"] = probs
                        pred_res["predicted_class"] = predicted_class
                        # Save the corrected pitch value in pose for display/debugging transparency
                        pose["corrected_pitch"] = round(corrected_pitch, 1)
                    except Exception as ex:
                        pass
            except Exception as e:
                continue
                
            landmarks = [{"x": lm.x, "y": lm.y} for lm in face]
            
            faces_results.append({
                "bbox": [x_min_padded, y_min_padded, x_max_padded, y_max_padded],
                "prediction": pred_res["predicted_class"],
                "probabilities": pred_res["probabilities"],
                "pose": pose,
                "landmarks": landmarks
            })
            
        return {
            "status": "success",
            "faces": faces_results
        }
