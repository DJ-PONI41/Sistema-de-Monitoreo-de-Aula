import cv2
import numpy as np

class HeadPoseEstimator:

    def estimate(self, face_landmarks, img_w, img_h):
        # Puntos clave del rostro (nose, chin, eyes, mouth corners)
        key_points = [1, 152, 263, 33, 287, 57]

        image_points = np.array([
            [face_landmarks[i].x * img_w, face_landmarks[i].y * img_h]
            for i in key_points
        ], dtype=np.float64)

        model_points = np.array([
            [0.0, 0.0, 0.0],
            [0.0, -330.0, -65.0],
            [-225.0, 170.0, -135.0],
            [225.0, 170.0, -135.0],
            [-150.0, -150.0, -125.0],
            [150.0, -150.0, -125.0]
        ])

        focal_length = img_w
        center = (img_w / 2, img_h / 2)
        camera_matrix = np.array([
            [focal_length, 0, center[0]],
            [0, focal_length, center[1]],
            [0, 0, 1]
        ], dtype=np.float64)

        dist_coeffs = np.zeros((4, 1))

        _, rotation_vec, _ = cv2.solvePnP(
            model_points, image_points, camera_matrix, dist_coeffs
        )

        rotation_mat, _ = cv2.Rodrigues(rotation_vec)
        angles, _, _, _, _, _ = cv2.RQDecomp3x3(rotation_mat)

        x = angles[0]  # pitch
        y = angles[1]  # yaw
        z = angles[2]  # roll

        return x, y, z