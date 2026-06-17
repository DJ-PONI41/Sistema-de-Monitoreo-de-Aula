import os
import sys
import cv2
import numpy as np
import time

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.detectors.face_mesh_detector import FaceMeshDetector

def mask_dataset():
    detector = FaceMeshDetector()
    classes = ["Atento", "Distraido", "Sospechoso"]
    dataset_dir = "dataset"
    
    if not os.path.exists(dataset_dir):
        print(f"Error: {dataset_dir} directory not found.")
        sys.exit(1)
        
    start_time = time.time()
    total_processed = 0
    facemesh_count = 0
    fallback_count = 0
    
    print("Starting batch face masking process...")
    
    for cls in classes:
        cls_dir = os.path.join(dataset_dir, cls)
        if not os.path.exists(cls_dir):
            print(f"Warning: Class directory {cls_dir} does not exist. Skipping.")
            continue
            
        files = [f for f in os.listdir(cls_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
        print(f"Class '{cls}': Found {len(files)} images to mask.")
        
        for idx, filename in enumerate(files):
            filepath = os.path.join(cls_dir, filename)
            img = cv2.imread(filepath)
            if img is None:
                print(f"Error loading image: {filepath}. Skipping.")
                continue
                
            h, w, c = img.shape
            
            # 1. Run FaceMesh
            results = detector.process(img)
            
            if results and results.face_landmarks:
                # Get the first face detected
                face_landmarks = results.face_landmarks[0]
                
                # Convert landmarks to pixel coordinates on this image
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
                facemesh_count += 1
            else:
                # 2. Fallback: Elliptical Mask centered in the image
                mask = np.zeros((h, w), dtype=np.uint8)
                center = (w // 2, h // 2)
                axes = (int(w * 0.43), int(h * 0.49))
                # Draw filled white ellipse
                cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)
                
                # Apply mask
                masked_img = cv2.bitwise_and(img, img, mask=mask)
                fallback_count += 1
                
            # Overwrite image with masked version
            cv2.imwrite(filepath, masked_img)
            total_processed += 1
            
            if total_processed % 200 == 0:
                elapsed = time.time() - start_time
                print(f"Processed {total_processed} images... (FaceMesh: {facemesh_count}, Fallback: {fallback_count}, Elapsed: {elapsed:.1f}s)")
                
    elapsed = time.time() - start_time
    print("\nBatch masking completed successfully!")
    print(f"Total processed: {total_processed}")
    print(f"Masked via FaceMesh: {facemesh_count} ({facemesh_count/total_processed*100:.1f}%)")
    print(f"Masked via Fallback: {fallback_count} ({fallback_count/total_processed*100:.1f}%)")
    print(f"Total execution time: {elapsed:.2f} seconds")

if __name__ == "__main__":
    mask_dataset()
