from app.detectors.face_mesh_detector import FaceMeshDetector
from app.detectors.head_pose_estimator import HeadPoseEstimator
from app.services.camera_service import CameraService

import cv2

class VisionService:

    def __init__(self):
        self.camera = CameraService()
        self.face_detector = FaceMeshDetector()
        self.pose_estimator = HeadPoseEstimator()

    def start(self):
        while True:
            success, frame = self.camera.read()

            if not success:
                break

            results = self.face_detector.process(frame)
            img_h, img_w = frame.shape[:2]

            # landmarks y head pose
            if results.face_landmarks:
                for face in results.face_landmarks:

                    # head pose
                    x, y, z = self.pose_estimator.estimate(face, img_w, img_h)

                    # draw landmarks
                    for landmark in face:
                        px = int(landmark.x * img_w)
                        py = int(landmark.y * img_h)
                        cv2.circle(frame, (px, py), 1, (0, 255, 0), -1)

                    # draw angles en pantalla
                    cv2.putText(frame, f"Pitch: {x:.1f}", (20, 30),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
                    cv2.putText(frame, f"Yaw:   {y:.1f}", (20, 60),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
                    cv2.putText(frame, f"Roll:  {z:.1f}", (20, 90),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

            cv2.imshow("VisionProctor", frame)

            if cv2.waitKey(1) == 27:
                break

        self.camera.release()
        return {"status": "Detection finished"}

if __name__ == "__main__":
    vision = VisionService()
    vision.start()