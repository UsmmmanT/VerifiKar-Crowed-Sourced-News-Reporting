import asyncio
import os
import tempfile
import cv2
import torch
import requests
import numpy as np
from PIL import Image
from io import BytesIO
from transformers import AutoImageProcessor, AutoModelForImageClassification
from typing import Tuple
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
# We silence the startup messages.
logger.info("Loading AI-vs-Human model...")
MODEL_NAME = "Ateeqq/ai-vs-human-image-detector"
try:
    AI_CHECK_PROCESSOR = AutoImageProcessor.from_pretrained(MODEL_NAME)
    AI_CHECK_MODEL = AutoModelForImageClassification.from_pretrained(MODEL_NAME)
    logger.info("AI-vs-Human model loaded successfully")
except Exception as e:
    logger.critical(f"Failed to load AI Check model: {e}", exc_info=True)
    AI_CHECK_PROCESSOR = None
    AI_CHECK_MODEL = None

# We need to know which label is "AI"
AI_LABEL_IDX = 0
if AI_CHECK_MODEL:
    labels = {v.lower(): k for k, v in AI_CHECK_MODEL.config.id2label.items()}
    if "ai-generated" in labels:
        AI_LABEL_IDX = labels["ai-generated"]
    else:
        # Fallback in case the label name changes
        AI_LABEL_IDX = next((labels[key] for key in labels if "ai" in key or "fake" in key), 0)


# ---------------------------
# 2. HELPER FUNCTIONS
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
        return Image.open(BytesIO(response.content)).convert("RGB")
    except Exception:
        return None

@retry(
    retry=retry_if_exception_type((Exception,)),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=5),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True
)
def _run_model_on_image(image: Image.Image) -> float:
    """
    Synchronous, blocking function to run the AI check model on a PIL image.
    Returns the "AI" probability score (0.0 to 1.0).
    Includes retry logic for model inference failures.
    """
    if not AI_CHECK_MODEL or not AI_CHECK_PROCESSOR:
        logger.warning("AI Check model not loaded, returning 0.0")
        return 0.0

    try:
        # Preprocess the image
        inputs = AI_CHECK_PROCESSOR(images=image, return_tensors="pt")

        # Get model predictions
        with torch.no_grad():
            outputs = AI_CHECK_MODEL(**inputs)
            probs = torch.nn.functional.softmax(outputs.logits, dim=-1)[0]
        
        # Get the probability of the "AI" class
        ai_prob = probs[AI_LABEL_IDX].item()
        return ai_prob
    
    except Exception as e:
        logger.error(f"Error during AI detection (after retries): {e}")
        return 0.0 # Return a safe score on failure

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

async def check_image_url(url: str) -> float:
    """
    Async wrapper to check a single image URL.
    Downloads the image and runs the model in a separate thread.
    Returns the "AI" probability score (0.0 to 1.0).
    """
    # 1. Download the image (this is I/O-bound, but we do it sync for simplicity)
    image = await asyncio.to_thread(_load_image_from_url, url)
    
    if image is None:
        logger.warning(f"Failed to download image: {url}")
        return 0.0

    # 2. Run the blocking model in a separate thread
    # This is the most important part.
    ai_score = await asyncio.to_thread(_run_model_on_image, image)
    
    return ai_score

async def check_video_url(url: str, frame_interval: int = 30, max_frames: int = 10) -> float:
    """
    Async wrapper to check a video URL.
    Downloads, extracts frames, and runs detection on each frame.
    Returns the *average* "AI" probability score (0.0 to 1.0).
    
    Now includes retry logic for download failures.
    """
    temp_file_path = None
    try:
        # 1. Download video with retry logic
        temp_file_path = await asyncio.to_thread(_download_video, url)
        if not temp_file_path:
            return 0.0

        # 2. Extract frames (blocking CPU/Disk I/O)
        def _extract_frames():
            cap = cv2.VideoCapture(temp_file_path)
            frames = []
            count = 0
            while True:
                ret, frame = cap.read()
                if not ret or len(frames) >= max_frames:
                    break
                if count % frame_interval == 0:
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    frames.append(Image.fromarray(frame_rgb))
                count += 1
            cap.release()
            return frames

        frames = await asyncio.to_thread(_extract_frames)
        if not frames:
            logger.warning(f"No frames extracted from video: {url}")
            return 0.0

        # 3. Run model on each frame in parallel threads
        tasks = []
        for frame in frames:
            tasks.append(asyncio.to_thread(_run_model_on_image, frame))
        
        scores = await asyncio.gather(*tasks)
        
        # 4. Return the average score
        return np.mean(scores) if scores else 0.0

    except Exception as e:
        logger.error(f"Error processing video {url}: {e}", exc_info=True)
        return 0.0
    finally:
        # 5. Clean up the temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as e:
                logger.error(f"Failed to delete temp file {temp_file_path}: {e}")