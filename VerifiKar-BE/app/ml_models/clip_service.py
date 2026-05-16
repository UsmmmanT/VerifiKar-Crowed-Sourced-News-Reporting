import asyncio
import os
import tempfile
import cv2
import torch
import clip  # This is the 'git+https://github.com/openai/CLIP.git' package
import requests
import numpy as np
from PIL import Image
from io import BytesIO
from typing import List
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log
)
import logging

logger = logging.getLogger(__name__)

# ---------------------------
# 1. LOAD MODELS ONCE
# ---------------------------
# This code runs ONE TIME when the Celery worker starts.
logger.info("Loading CLIP model (ViT-B/32)...")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
try:
    CLIP_MODEL, CLIP_PREPROCESS = clip.load("ViT-B/32", device=DEVICE)
    CLIP_MODEL.eval()
    logger.info(f"CLIP model loaded successfully on device: {DEVICE}")
except Exception as e:
    logger.critical(f"Failed to load CLIP model: {e}", exc_info=True)
    CLIP_MODEL = None
    CLIP_PREPROCESS = None

# ---------------------------
# 2. HELPER FUNCTIONS (SYNCHRONOUS)
# ---------------------------

@retry(
    retry=retry_if_exception_type((requests.RequestException, IOError)),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True
)
def _load_image_from_url(url: str) -> Image.Image | None:
    """
    Downloads an image from a URL and returns a PIL Image.
    Includes retry logic for network failures.
    """
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        # Open in-memory bytes buffer as a PIL Image
        return Image.open(BytesIO(response.content)).convert("RGB")
    except Exception as e:
        logger.error(f"Failed to download image {url} (after retries): {e}")
        return None

@retry(
    retry=retry_if_exception_type((Exception,)),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=5),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True
)
def _run_text_model(text: str) -> np.ndarray | None:
    """
    Synchronous, blocking function to run CLIP text embedding.
    Returns 512-dim embedding or None.
    Includes retry logic for model inference failures.
    """
    if not CLIP_MODEL:
        return None
    try:
        # Tokenize text and send to device
        tokens = clip.tokenize([text]).to(DEVICE)
        with torch.no_grad():
            # Run the model
            features = CLIP_MODEL.encode_text(tokens)
            # Normalize the features
            features /= features.norm(dim=-1, keepdim=True)
        # Return as a numpy array
        return features[0].cpu().numpy()
    except Exception as e:
        logger.error(f"Error embedding text (after retries): {e}")
        return None

@retry(
    retry=retry_if_exception_type((Exception,)),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=5),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True
)
def _run_image_model(image: Image.Image) -> np.ndarray | None:
    """
    Synchronous, blocking function to run CLIP image embedding.
    Returns 512-dim embedding or None.
    Includes retry logic for model inference failures.
    """
    if not CLIP_MODEL:
        return None
    try:
        # Preprocess the PIL image and send to device
        img_tensor = CLIP_PREPROCESS(image).unsqueeze(0).to(DEVICE)
        with torch.no_grad():
            # Run the model
            features = CLIP_MODEL.encode_image(img_tensor)
            # Normalize the features
            features /= features.norm(dim=-1, keepdim=True)
        # Return as a numpy array
        return features[0].cpu().numpy()
    except Exception as e:
        logger.error(f"Error embedding image (after retries): {e}")
        return None

@retry(
    retry=retry_if_exception_type((requests.RequestException, IOError)),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True
)
def _download_video(url: str) -> str | None:
    """
    Downloads a video from URL and saves to temp file.
    Returns temp file path or None.
    Includes retry logic for network failures.
    """
    try:
        response = requests.get(url, stream=True, timeout=20)
        response.raise_for_status()
        # Create a temp file to store the video
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        for chunk in response.iter_content(chunk_size=8192):
            temp_file.write(chunk)
        temp_file.close()
        return temp_file.name
    except Exception as e:
        logger.error(f"Failed to download video {url} (after retries): {e}")
        return None

# ---------------------------
# 3. PUBLIC ASYNC FUNCTIONS
# ---------------------------

async def embed_text(text: str) -> np.ndarray | None:
    """
    Asynchronously embed a string of text.
    Returns 512-dim embedding or None.
    """
    if not text or not text.strip():
        return None
    # Run the blocking model in a separate thread
    return await asyncio.to_thread(_run_text_model, text)

async def embed_image_url(url: str) -> np.ndarray | None:
    """
    Asynchronously download an image from a URL and embed it.
    Returns 512-dim embedding or None.
    """
    # 1. Download the image (blocking I/O)
    image = await asyncio.to_thread(_load_image_from_url, url)
    if image is None:
        return None
    
    # 2. Run the model (blocking CPU/GPU)
    return await asyncio.to_thread(_run_image_model, image)

async def embed_video_url(url: str, frame_interval: int = 30, max_frames: int = 12) -> np.ndarray | None:
    """
    Asynchronously download a video, sample frames, embed them,
    and return the average (CLIP4Clip-style) embedding.
    Returns 512-dim embedding or None.
    
    Now includes retry logic for download failures.
    """
    temp_file_path = None
    try:
        # 1. Download video with retry logic
        temp_file_path = await asyncio.to_thread(_download_video, url)
        if not temp_file_path:
            return None

        # 2. Extract frames and embed them in a thread
        def _extract_and_embed_frames() -> List[np.ndarray]:
            cap = cv2.VideoCapture(temp_file_path)
            frame_features = []
            count = 0
            while True:
                ret, frame = cap.read()
                # Stop if no frame or we hit our max
                if not ret or len(frame_features) >= max_frames:
                    break
                
                # Sample 1 frame every 'frame_interval'
                if count % frame_interval == 0:
                    # Convert frame from BGR (OpenCV) to RGB (PIL)
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    pil_image = Image.fromarray(frame_rgb)
                    
                    # Run the synchronous model embedding for this frame
                    embedding = _run_image_model(pil_image)
                    
                    if embedding is not None:
                        frame_features.append(embedding)
                count += 1
            cap.release()
            return frame_features

        frame_features = await asyncio.to_thread(_extract_and_embed_frames)
        if not frame_features:
            logger.warning(f"No frames embedded from video: {url}")
            return None

        # 3. Average the frame embeddings (CLIP4Clip style)
        video_feat = np.mean(frame_features, axis=0)
        # Normalize the final average vector
        video_feat = video_feat / np.linalg.norm(video_feat)
        
        return video_feat

    except Exception as e:
        logger.error(f"Error processing video {url}: {e}", exc_info=True)
        return None
    finally:
        # 4. Clean up the temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as e:
                logger.error(f"Failed to delete temp file {temp_file_path}: {e}")