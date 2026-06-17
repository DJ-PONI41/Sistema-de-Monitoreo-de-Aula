import cv2

def draw_text(frame, text, position):

    cv2.putText(
        frame,
        text,
        position,
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0,255,0),
        2
    )