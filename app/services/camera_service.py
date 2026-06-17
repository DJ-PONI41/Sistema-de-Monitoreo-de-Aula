import cv2

class CameraService:

    def __init__(self):

        self.cap = cv2.VideoCapture(0)

    def read(self):

        return self.cap.read()

    def release(self):

        self.cap.release()