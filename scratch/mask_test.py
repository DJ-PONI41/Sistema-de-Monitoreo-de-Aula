import os
import sys
import cv2
import numpy as np

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.detectors.face_mesh_detector import FaceMeshDetector

detector = FaceMeshDetector()

# Test on a file from dataset/Atento
folder = "dataset/Atento"
if not os.path.exists(folder):
    print("Dataset folder not found")
    exit(1)

files = [f for f in os.listdir(folder) if f.lower().endswith(('.jpg', '.png'))]
if not files:
    print("No images found in Atento folder")
    exit(1)

sample_path = os.path.join(folder, files[0])
print(f"Loading sample: {sample_path}")
img = cv2.imread(sample_path)
h, w, c = img.shape

# Run FaceMesh
results = detector.process(img)

if not results.face_landmarks:
    print("No face detected in sample image!")
    # Let's try to find one that has a face
    for f in files[1:20]:
        sample_path = os.path.join(folder, f)
        img = cv2.imread(sample_path)
        h, w, c = img.shape
        results = detector.process(img)
        if results.face_landmarks:
            print(f"Face detected in alternative sample: {sample_path}")
            break
    else:
        print("Could not find any face in the first 20 images.")
        exit(1)

face_landmarks = results.face_landmarks[0]

# Convert landmarks to pixel coordinates
points = []
for lm in face_landmarks:
    points.append([int(lm.x * w), int(lm.y * h)])
points = np.array(points, dtype=np.int32)

# Compute convex hull
hull = cv2.convexHull(points)

# Create mask
mask = np.zeros((h, w), dtype=np.uint8)
cv2.fillConvexPoly(mask, hull, 255)

# Apply mask
masked_img = cv2.bitwise_and(img, img, mask=mask)

os.makedirs("scratch", exist_ok=True)
cv2.imwrite("scratch/masked_sample.jpg", masked_img)
print("Saved masked sample to scratch/masked_sample.jpg")
