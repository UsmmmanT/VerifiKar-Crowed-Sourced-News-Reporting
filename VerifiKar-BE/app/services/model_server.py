"""
Model Serving Microservice for VerifiKar

Provides centralized model serving for CLIP embeddings and AI-generated content detection.
This prevents model duplication across multiple ARQ workers.

Run as separate service:
    uvicorn app.services.model_server:app --host 0.0.0.0 --port 8001
"""

import asyncio
import os
import tempfile
from typing import List, Optional
import logging

import cv2
import torch
import clip
import numpy as np
import requests
from PIL import Image
from io import BytesIO
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from transformers import AutoImageProcessor, AutoModelForImageClassification
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================================
# FastAPI App
# ============================================================================

app = FastAPI(
    title="VerifiKar Model Service",
    description="Centralized ML model serving for embeddings and AI detection",
    version="1.0.0"
)

# ============================================================================
# Global Model Loading (runs once when service starts)
# ============================================================================

logger.info("Loading CLIP model (ViT-B/32)...")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
try:
    CLIP_MODEL, CLIP_PREPROCESS = clip.load("ViT-B/32", device=DEVICE)
    CLIP_MODEL.eval()
    logger.info(f"✓ CLIP model loaded on {DEVICE}")
except Exception as e:
    logger.critical(f"Failed to load CLIP model: {e}", exc_info=True)
    CLIP_MODEL = None
    CLIP_PREPROCESS = None

logger.info("Loading AI-vs-Human detection model...")
MODEL_NAME = "Ateeqq/ai-vs-human-image-detector"
try:
    AI_CHECK_PROCESSOR = AutoImageProcessor.from_pretrained(MODEL_NAME)
    AI_CHECK_MODEL = AutoModelForImageClassification.from_pretrained(MODEL_NAME)
    logger.info("✓ AI-vs-Human model loaded")
    
    # Determine AI label index
    labels = {v.lower(): k for k, v in AI_CHECK_MODEL.config.id2label.items()}
    AI_LABEL_IDX = labels.get("ai-generated", 0)
    if AI_LABEL_IDX == 0 and "ai-generated" not in labels:
        AI_LABEL_IDX = next((labels[key] for key in labels if "ai" in key or "fake" in key), 0)
except Exception as e:
    logger.critical(f"Failed to load AI Check model: {e}", exc_info=True)
    AI_CHECK_PROCESSOR = None
    AI_CHECK_MODEL = None
    AI_LABEL_IDX = 0

# ============================================================================
# Request/Response Models
# ============================================================================

class TextEmbedRequest(BaseModel):
    text: str = Field(..., description="Text to embed", min_length=1, max_length=10000)

class ImageEmbedRequest(BaseModel):
    url: str = Field(..., description="Image URL to download and embed")

class VideoEmbedRequest(BaseModel):
    url: str = Field(..., description="Video URL to download and embed")
    frame_interval: int = Field(30, description="Sample 1 frame every N frames", ge=1, le=100)
    max_frames: int = Field(12, description="Maximum frames to process", ge=1, le=50)

class AICheckImageRequest(BaseModel):
    url: str = Field(..., description="Image URL to check")

class AICheckVideoRequest(BaseModel):
    url: str = Field(..., description="Video URL to check")
    frame_interval: int = Field(30, description="Sample 1 frame every N frames", ge=1, le=100)
    max_frames: int = Field(10, description="Maximum frames to check", ge=1, le=50)

class EmbeddingResponse(BaseModel):
    embedding: List[float] = Field(..., description="512-dimensional embedding vector")
    dimensions: int = Field(512, description="Number of dimensions")

class AICheckResponse(BaseModel):
    ai_score: float = Field(..., description="Probability of AI-generated content (0.0-1.0)", ge=0.0, le=1.0)

class HealthResponse(BaseModel):
    status: str
    clip_loaded: bool
    ai_check_loaded: bool
    device: str

# ============================================================================
# Helper Functions (with retry logic)
# ============================================================================

@retry(
    retry=retry_if_exception_type((requests.RequestException, IOError)),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True
)
def _download_image(url: str) -> Image.Image:
    """Download image from URL with retry logic."""
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    return Image.open(BytesIO(response.content)).convert("RGB")

@retry(
    retry=retry_if_exception_type((requests.RequestException, IOError)),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True
)
def _download_video(url: str) -> str:
    """Download video from URL and save to temp file with retry logic."""
    response = requests.get(url, stream=True, timeout=20)
    response.raise_for_status()
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    for chunk in response.iter_content(chunk_size=8192):
        temp_file.write(chunk)
    temp_file.close()
    return temp_file.name

def _run_clip_text(text: str) -> np.ndarray:
    """Run CLIP text encoder synchronously."""
    if not CLIP_MODEL:
        raise HTTPException(status_code=503, detail="CLIP model not loaded")
    
    tokens = clip.tokenize([text]).to(DEVICE)
    with torch.no_grad():
        features = CLIP_MODEL.encode_text(tokens)
        features /= features.norm(dim=-1, keepdim=True)
    return features[0].cpu().numpy()

def _run_clip_image(image: Image.Image) -> np.ndarray:
    """Run CLIP image encoder synchronously."""
    if not CLIP_MODEL:
        raise HTTPException(status_code=503, detail="CLIP model not loaded")
    
    img_tensor = CLIP_PREPROCESS(image).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        features = CLIP_MODEL.encode_image(img_tensor)
        features /= features.norm(dim=-1, keepdim=True)
    return features[0].cpu().numpy()

def _run_ai_check(image: Image.Image) -> float:
    """Run AI detection model synchronously."""
    if not AI_CHECK_MODEL or not AI_CHECK_PROCESSOR:
        raise HTTPException(status_code=503, detail="AI Check model not loaded")
    
    inputs = AI_CHECK_PROCESSOR(images=image, return_tensors="pt")
    with torch.no_grad():
        outputs = AI_CHECK_MODEL(**inputs)
        probs = torch.nn.functional.softmax(outputs.logits, dim=-1)[0]
    return probs[AI_LABEL_IDX].item()

# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        clip_loaded=CLIP_MODEL is not None,
        ai_check_loaded=AI_CHECK_MODEL is not None,
        device=DEVICE
    )

@app.post("/embed/text", response_model=EmbeddingResponse)
async def embed_text(request: TextEmbedRequest):
    """
    Generate CLIP text embedding.
    
    Returns 512-dimensional normalized embedding vector.
    """
    try:
        embedding = await asyncio.to_thread(_run_clip_text, request.text)
        return EmbeddingResponse(
            embedding=embedding.tolist(),
            dimensions=len(embedding)
        )
    except Exception as e:
        logger.error(f"Text embedding failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Embedding failed: {str(e)}")

@app.post("/embed/image", response_model=EmbeddingResponse)
async def embed_image(request: ImageEmbedRequest):
    """
    Download image from URL and generate CLIP embedding.
    
    Returns 512-dimensional normalized embedding vector.
    """
    try:
        # Download image
        image = await asyncio.to_thread(_download_image, request.url)
        
        # Generate embedding
        embedding = await asyncio.to_thread(_run_clip_image, image)
        
        return EmbeddingResponse(
            embedding=embedding.tolist(),
            dimensions=len(embedding)
        )
    except requests.RequestException as e:
        logger.error(f"Failed to download image {request.url}: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to download image: {str(e)}")
    except Exception as e:
        logger.error(f"Image embedding failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Embedding failed: {str(e)}")

@app.post("/embed/video", response_model=EmbeddingResponse)
async def embed_video(request: VideoEmbedRequest):
    """
    Download video, extract frames, and generate average CLIP embedding.
    
    Returns 512-dimensional normalized embedding vector (averaged across frames).
    """
    temp_path = None
    try:
        # Download video
        temp_path = await asyncio.to_thread(_download_video, request.url)
        
        # Extract and embed frames
        def _process_video():
            cap = cv2.VideoCapture(temp_path)
            frame_embeddings = []
            count = 0
            
            while len(frame_embeddings) < request.max_frames:
                ret, frame = cap.read()
                if not ret:
                    break
                
                if count % request.frame_interval == 0:
                    # Convert BGR to RGB and create PIL image
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    pil_image = Image.fromarray(frame_rgb)
                    
                    # Generate embedding for this frame
                    embedding = _run_clip_image(pil_image)
                    frame_embeddings.append(embedding)
                
                count += 1
            
            cap.release()
            
            if not frame_embeddings:
                raise ValueError("No frames extracted from video")
            
            # Average all frame embeddings
            video_embedding = np.mean(frame_embeddings, axis=0)
            # Normalize
            video_embedding = video_embedding / np.linalg.norm(video_embedding)
            
            return video_embedding
        
        embedding = await asyncio.to_thread(_process_video)
        
        return EmbeddingResponse(
            embedding=embedding.tolist(),
            dimensions=len(embedding)
        )
        
    except requests.RequestException as e:
        logger.error(f"Failed to download video {request.url}: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to download video: {str(e)}")
    except Exception as e:
        logger.error(f"Video embedding failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Embedding failed: {str(e)}")
    finally:
        # Cleanup temp file
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                logger.warning(f"Failed to delete temp file {temp_path}: {e}")

@app.post("/check/ai-image", response_model=AICheckResponse)
async def check_ai_image(request: AICheckImageRequest):
    """
    Check if image is AI-generated.
    
    Returns probability score (0.0 = human, 1.0 = AI).
    """
    try:
        # Download image
        image = await asyncio.to_thread(_download_image, request.url)
        
        # Run AI detection
        ai_score = await asyncio.to_thread(_run_ai_check, image)
        
        return AICheckResponse(ai_score=ai_score)
        
    except requests.RequestException as e:
        logger.error(f"Failed to download image {request.url}: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to download image: {str(e)}")
    except Exception as e:
        logger.error(f"AI check failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"AI check failed: {str(e)}")

@app.post("/check/ai-video", response_model=AICheckResponse)
async def check_ai_video(request: AICheckVideoRequest):
    """
    Check if video is AI-generated by analyzing multiple frames.
    
    Returns average probability score across all frames (0.0 = human, 1.0 = AI).
    """
    temp_path = None
    try:
        # Download video
        temp_path = await asyncio.to_thread(_download_video, request.url)
        
        # Extract frames and check each
        def _process_video():
            cap = cv2.VideoCapture(temp_path)
            ai_scores = []
            count = 0
            
            while len(ai_scores) < request.max_frames:
                ret, frame = cap.read()
                if not ret:
                    break
                
                if count % request.frame_interval == 0:
                    # Convert BGR to RGB and create PIL image
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    pil_image = Image.fromarray(frame_rgb)
                    
                    # Run AI check on this frame
                    score = _run_ai_check(pil_image)
                    ai_scores.append(score)
                
                count += 1
            
            cap.release()
            
            if not ai_scores:
                raise ValueError("No frames extracted from video")
            
            # Return average score
            return float(np.mean(ai_scores))
        
        avg_score = await asyncio.to_thread(_process_video)
        
        return AICheckResponse(ai_score=avg_score)
        
    except requests.RequestException as e:
        logger.error(f"Failed to download video {request.url}: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to download video: {str(e)}")
    except Exception as e:
        logger.error(f"Video AI check failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"AI check failed: {str(e)}")
    finally:
        # Cleanup temp file
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                logger.warning(f"Failed to delete temp file {temp_path}: {e}")

# ============================================================================
# Startup/Shutdown Events
# ============================================================================

@app.on_event("startup")
async def startup_event():
    logger.info("Model service started")
    logger.info(f"CLIP loaded: {CLIP_MODEL is not None}")
    logger.info(f"AI Check loaded: {AI_CHECK_MODEL is not None}")
    logger.info(f"Device: {DEVICE}")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Model service shutting down")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
