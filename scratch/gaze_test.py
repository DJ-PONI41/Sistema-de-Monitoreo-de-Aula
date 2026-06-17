import os
import sys
import cv2
import numpy as np

sys.path.append('.')
from app.detectors.face_mesh_detector import FaceMeshDetector
from app.detectors.head_pose_estimator import HeadPoseEstimator

detector = FaceMeshDetector()
pose_estimator = HeadPoseEstimator()

classes = ["Atento", "Distraido", "Sospechoso"]

for cls in classes:
    folder = f"dataset/{cls}"
    if not os.path.exists(folder):
        continue
    files = [f for f in os.listdir(folder) if f.lower().endswith(('.jpg', '.png'))][:5]
    print(f"\n--- Class: {cls} ---")
    for f in files:
        filepath = os.path.join(folder, f)
        img = cv2.imread(filepath)
        h, w, c = img.shape
        res = detector.process(img)
        if res and res.face_landmarks:
            face = res.face_landmarks[0]
            try:
                pitch, yaw, roll = pose_estimator.estimate(face, w, h)
                
                # Left eye corners (33, 133) and iris center (468)
                x_33 = face[33].x
                x_133 = face[133].x
                x_468 = face[468].x
                
                # Right eye corners (362, 263) and iris center (473)
                x_362 = face[362].x
                x_263 = face[263].x
                x_473 = face[473].x
                
                ratio_left = (x_468 - x_33) / (x_133 - x_33) if abs(x_133 - x_33) > 1e-6 else 0.5
                ratio_right = (x_473 - x_362) / (x_263 - x_362) if abs(x_263 - x_362) > 1e-6 else 0.5
                ratio_avg = (ratio_left + ratio_right) / 2.0
                
                gaze_offset = ratio_avg - 0.5
                comp_score = yaw * gaze_offset
                
                print(f"File: {f[:30]} | Yaw: {yaw:5.1f} | L: {ratio_left:.2f} | R: {ratio_right:.2f} | Avg: {ratio_avg:.2f} | GazeOffset: {gaze_offset:+.2f} | CompScore: {comp_score:+.3f}")
            except Exception as e:
                print(f"Error on {f}: {e}")
