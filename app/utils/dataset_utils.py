import os
import cv2
import numpy as np
import random

def setup_dataset_dirs(base_path="dataset"):
    """
    Creates the dataset directories for each class if they do not exist.
    """
    classes = ["Atento", "Distraido", "Sospechoso"]
    for cls in classes:
        os.makedirs(os.path.join(base_path, cls), exist_ok=True)
    return base_path

def rotate_image(image, angle):
    """
    Rotates an image by a given angle around its center.
    """
    h, w = image.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    # Perform the rotation, filling borders with black or border replication
    rotated = cv2.warpAffine(image, matrix, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    return rotated

def adjust_brightness(image, factor):
    """
    Adjusts the brightness of an image using the HSV color space.
    """
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    
    # Apply factor and clip to uint8 limits [0, 255]
    v = np.clip(v.astype(np.float32) * factor, 0, 255).astype(np.uint8)
    
    final_hsv = cv2.merge((h, s, v))
    return cv2.cvtColor(final_hsv, cv2.COLOR_HSV2BGR)

def adjust_contrast(image, factor):
    """
    Adjusts the contrast of an image.
    """
    # y = alpha * x + beta
    # we adjust alpha (contrast) and keep beta (brightness) as 0
    adjusted = cv2.convertScaleAbs(image, alpha=factor, beta=0)
    return adjusted

def add_noise(image):
    """
    Adds random Gaussian noise to the image to simulate lower quality/sensor noise.
    """
    row, col, ch = image.shape
    mean = 0
    var = 15
    sigma = var ** 0.5
    gauss = np.random.normal(mean, sigma, (row, col, ch))
    gauss = gauss.reshape(row, col, ch)
    noisy = image.astype(np.float32) + gauss
    return np.clip(noisy, 0, 255).astype(np.uint8)

def apply_augmentations(image, settings=None):
    """
    Applies a set of selected image transformations to the face crop image.
    Returns a dictionary of {suffix: augmented_image}.
    """
    if settings is None:
        settings = {
            "flip": True,
            "brightness": True,
            "contrast": True,
            "rotation": True,
            "blur_noise": True
        }
        
    augmented_images = {}
    
    # 1. Horizontal Flip
    if settings.get("flip", False):
        flipped = cv2.flip(image, 1)
        augmented_images["_flip"] = flipped
        
    # 2. Brightness adjustment (Brighter & Darker)
    if settings.get("brightness", False):
        brighter = adjust_brightness(image, 1.25)
        darker = adjust_brightness(image, 0.75)
        augmented_images["_bright"] = brighter
        augmented_images["_dark"] = darker
        
    # 3. Contrast adjustment (High & Low)
    if settings.get("contrast", False):
        high_contrast = adjust_contrast(image, 1.3)
        low_contrast = adjust_contrast(image, 0.7)
        augmented_images["_hicontrast"] = high_contrast
        augmented_images["_locontrast"] = low_contrast
        
    # 4. Rotation (Clockwise & Counter-Clockwise)
    if settings.get("rotation", False):
        rot_cw = rotate_image(image, 12)
        rot_ccw = rotate_image(image, -12)
        augmented_images["_rotcw"] = rot_cw
        augmented_images["_rotccw"] = rot_ccw
        
    # 5. Blur & Noise
    if settings.get("blur_noise", False):
        blurred = cv2.GaussianBlur(image, (5, 5), 0)
        noisy = add_noise(image)
        augmented_images["_blur"] = blurred
        augmented_images["_noise"] = noisy
        
    # Combos (Flip + Brightness/Contrast/Rotation) to enrich even further!
    if settings.get("flip", False) and settings.get("rotation", False):
        # Apply rotation to flipped image
        flipped_img = cv2.flip(image, 1)
        rot_cw_flip = rotate_image(flipped_img, 12)
        augmented_images["_flip_rotcw"] = rot_cw_flip
        
    return augmented_images
