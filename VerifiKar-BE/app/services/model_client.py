"""
Client for communicating with the Model Service.

This replaces direct model loading in workers with HTTP requests to the model service.
Includes retry logic, circuit breaker, and graceful degradation.
"""

import asyncio
import logging
from typing import Optional
import numpy as np
import httpx
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log
)

from app.core.config import settings

logger = logging.getLogger(__name__)

# Model service configuration
MODEL_SERVICE_URL = settings.MODEL_SERVICE_URL
MODEL_SERVICE_TIMEOUT = 30.0  # seconds

# Circuit breaker state
_circuit_breaker_failures = 0
_circuit_breaker_threshold = 3
_circuit_breaker_open = False
_circuit_breaker_reset_time = None

# ============================================================================
# Circuit Breaker Logic
# ============================================================================

def _record_success():
    """Record successful request and reset circuit breaker."""
    global _circuit_breaker_failures, _circuit_breaker_open
    _circuit_breaker_failures = 0
    _circuit_breaker_open = False

def _record_failure():
    """Record failed request and open circuit breaker if threshold reached."""
    global _circuit_breaker_failures, _circuit_breaker_open, _circuit_breaker_reset_time
    _circuit_breaker_failures += 1
    
    if _circuit_breaker_failures >= _circuit_breaker_threshold:
        _circuit_breaker_open = True
        _circuit_breaker_reset_time = asyncio.get_event_loop().time() + 60  # Reset after 60s
        logger.error(f"Circuit breaker OPEN after {_circuit_breaker_failures} failures. "
                    f"Will retry in 60 seconds.")

def _is_circuit_open() -> bool:
    """Check if circuit breaker is open."""
    global _circuit_breaker_open, _circuit_breaker_reset_time, _circuit_breaker_failures
    
    if not _circuit_breaker_open:
        return False
    
    # Check if it's time to reset
    if _circuit_breaker_reset_time and asyncio.get_event_loop().time() >= _circuit_breaker_reset_time:
        logger.info("Circuit breaker reset - attempting to reconnect to model service")
        _circuit_breaker_open = False
        _circuit_breaker_reset_time = None
        _circuit_breaker_failures = 0  # CRITICAL FIX: Reset failure count on circuit reset
        return False
    
    return True

# ============================================================================
# HTTP Client with Retry
# ============================================================================

@retry(
    retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=5),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True
)
async def _make_request(endpoint: str, json_data: dict) -> dict:
    """Make HTTP request to model service with retry logic."""
    if _is_circuit_open():
        logger.warning("Circuit breaker is OPEN - skipping request to model service")
        raise ConnectionError("Circuit breaker is open")
    
    async with httpx.AsyncClient(timeout=MODEL_SERVICE_TIMEOUT) as client:
        response = await client.post(
            f"{MODEL_SERVICE_URL}{endpoint}",
            json=json_data
        )
        response.raise_for_status()
        return response.json()

# ============================================================================
# Public API (mirrors original ml_models interface)
# ============================================================================

async def embed_text(text: str) -> Optional[np.ndarray]:
    """
    Generate CLIP text embedding via model service.
    
    Args:
        text: Text to embed
    
    Returns:
        512-dimensional numpy array or None on failure
    """
    if not text or not text.strip():
        return None
    
    try:
        response = await _make_request("/embed/text", {"text": text})
        _record_success()
        return np.array(response["embedding"], dtype=np.float32)
    except Exception as e:
        logger.error(f"Failed to embed text: {e}")
        _record_failure()
        return None

async def embed_image_url(url: str) -> Optional[np.ndarray]:
    """
    Download image from URL and generate CLIP embedding via model service.
    
    Args:
        url: Image URL
    
    Returns:
        512-dimensional numpy array or None on failure
    """
    try:
        response = await _make_request("/embed/image", {"url": url})
        _record_success()
        return np.array(response["embedding"], dtype=np.float32)
    except Exception as e:
        logger.error(f"Failed to embed image {url}: {e}")
        _record_failure()
        return None

async def embed_video_url(
    url: str,
    frame_interval: int = 30,
    max_frames: int = 12
) -> Optional[np.ndarray]:
    """
    Download video, extract frames, and generate average CLIP embedding via model service.
    
    Args:
        url: Video URL
        frame_interval: Sample 1 frame every N frames
        max_frames: Maximum frames to process
    
    Returns:
        512-dimensional numpy array (averaged across frames) or None on failure
    """
    try:
        response = await _make_request("/embed/video", {
            "url": url,
            "frame_interval": frame_interval,
            "max_frames": max_frames
        })
        _record_success()
        return np.array(response["embedding"], dtype=np.float32)
    except Exception as e:
        logger.error(f"Failed to embed video {url}: {e}")
        _record_failure()
        return None

async def check_image_url(url: str) -> float:
    """
    Check if image is AI-generated via model service.
    
    Args:
        url: Image URL
    
    Returns:
        AI probability score (0.0-1.0), or 0.0 on failure
    """
    try:
        response = await _make_request("/check/ai-image", {"url": url})
        _record_success()
        return response["ai_score"]
    except Exception as e:
        logger.error(f"Failed to check image {url}: {e}")
        _record_failure()
        return 0.0

async def check_video_url(
    url: str,
    frame_interval: int = 30,
    max_frames: int = 10
) -> float:
    """
    Check if video is AI-generated by analyzing multiple frames via model service.
    
    Args:
        url: Video URL
        frame_interval: Sample 1 frame every N frames
        max_frames: Maximum frames to check
    
    Returns:
        Average AI probability score (0.0-1.0), or 0.0 on failure
    """
    try:
        response = await _make_request("/check/ai-video", {
            "url": url,
            "frame_interval": frame_interval,
            "max_frames": max_frames
        })
        _record_success()
        return response["ai_score"]
    except Exception as e:
        logger.error(f"Failed to check video {url}: {e}")
        _record_failure()
        return 0.0

async def health_check() -> dict:
    """
    Check model service health.
    
    Returns:
        Health status dict or error dict
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{MODEL_SERVICE_URL}/health")
            response.raise_for_status()
            return response.json()
    except Exception as e:
        logger.error(f"Model service health check failed: {e}")
        return {"status": "unhealthy", "error": str(e)}
