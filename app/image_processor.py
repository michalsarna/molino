import io
import numpy as np
from PIL import Image


def process_image_to_heightmap(image_bytes: bytes, cols: int, rows: int = None) -> np.ndarray:
    """
    Convert a grayscale image to a normalized heightmap.
    Returns 2D float32 array: 0.0 = no cut (white), 1.0 = max cut (black).
    The frontend sends an already-adjusted grayscale image.
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("L")

    if rows is None:
        orig_w, orig_h = img.size
        rows = max(1, int(cols * orig_h / orig_w))

    img = img.resize((cols, rows), Image.LANCZOS)
    arr = np.array(img, dtype=np.float32) / 255.0
    # Invert: black pixel (0) → full cut depth (1.0), white (1) → no cut (0.0)
    return 1.0 - arr
