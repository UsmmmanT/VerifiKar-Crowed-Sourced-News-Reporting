import json
import uuid
import aiofiles # New library for async file saving
import os
from typing import List, Annotated
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
    UploadFile,
    File,
    Form,
    Request, # We must import Request
)
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import ValidationError
from arq.connections import ArqRedis # Import ArqRedis
from slowapi import Limiter
from slowapi.util import get_remote_address

# Internal module imports
from app.db.session import get_db_session
from app.db import crud
from app.db.models import User, MediaTypeEnum
from app.schemas import ReportLocation, RawReportCreateResponse, ApiResponse
# We no longer import the uploader here, the task will do it
# from app.core.uploader import upload_file_to_r2
from app.core.dependencies import get_current_user

# --- 1. IMPORT THE *FIRST* TASK IN THE CHAIN ---
from app.tasks.tasks import task_1_preprocess

router = APIRouter()

# Initialize rate limiter for this router
limiter = Limiter(key_func=get_remote_address)

# Define a temporary directory to store files before processing
# We'll create it if it doesn't exist
TEMP_FILE_DIR = "temp_uploads"
os.makedirs(TEMP_FILE_DIR, exist_ok=True)


async def save_temp_file(file: UploadFile) -> str | None:
    """
    Saves an UploadFile to a temporary local path.
    Returns the path.
    """
    try:
        # Create a unique filename
        temp_filename = f"{uuid.uuid4()}-{file.filename}"
        temp_file_path = os.path.join(TEMP_FILE_DIR, temp_filename)
        
        # Asynchronously write the file to disk
        async with aiofiles.open(temp_file_path, 'wb') as out_file:
            while content := await file.read(1024 * 1024):  # Read in 1MB chunks
                await out_file.write(content)
        return temp_file_path
    except Exception as e:
        print(f"Error saving temp file: {e}")
        return None
    finally:
        await file.close()


@router.post(
    "/submit",
    response_model=ApiResponse[RawReportCreateResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Submit a new incident report (Fast ARQ Version)"
)
@limiter.limit("200/hour")  # Temporarily increased for demo seeding (was 10/hour)
async def submit_report(
    request: Request, # Get the request object to access app state
    raw_text: Annotated[str, Form(max_length=2000, description="Report text [1-2000 chars]. Prevents abuse.")],
    location: Annotated[str, Form(max_length=100, description="JSON location string")],
    images: Annotated[List[UploadFile], File(max_length=5, description="Max 5 images per report")] = [],
    videos: Annotated[List[UploadFile], File(max_length=2, description="Max 2 videos per report")] = [],
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user)
):
    """
    Handle new incident report submission.
    This endpoint is FAST. It only saves the report and files
    to a temporary location, then enqueues the background job.
    
    INPUT VALIDATION (Resource Protection):
    - Text: Max 2000 chars to prevent large text embeddings
    - Images: Max 5 per report to limit storage/processing
    - Videos: Max 2 per report to limit bandwidth/processing
    - Rate: 10 reports/hour per IP (slowapi limiter)
    """
    
    # 1. Validate text length (early rejection saves processing)
    if not raw_text or len(raw_text.strip()) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "details": "Report text must be at least 10 characters."}
        )
    
    # 2. Get the ARQ Redis pool from the app state
    redis: ArqRedis = request.app.state.redis
    
    # 3. Validate location (Pydantic validators check lat/lon ranges)
    try:
        location_data = ReportLocation.model_validate_json(location)
    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "details": f"Invalid location: {str(e)}"}
        )

    # 4. Create the main RawReport
    try:
        db_report = await crud.create_raw_report(
            db=db,
            raw_text=raw_text,
            location=location_data,
            user=current_user
        )
    except Exception as e:
        print(f"Database error creating RawReport: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "details": "An error occurred while saving the report."}
        )

    # 4. Save media to temporary files
    # We will pass a simple dict of {media_type: temp_path} to the task
    media_files_to_process = []
    
    # Define file extensions for validation
    VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.3gp'}
    IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp'}

    for image_file in images:
        if image_file.size == 0: continue
        temp_path = await save_temp_file(image_file)
        if temp_path:
            # Validate file extension to catch misclassified files
            file_ext = os.path.splitext(temp_path)[1].lower()
            if file_ext in VIDEO_EXTENSIONS:
                print(f"WARNING: File {image_file.filename} sent as image but has video extension {file_ext}. Correcting to video.")
                media_files_to_process.append(
                    {"type": "video", "path": temp_path}
                )
            else:
                media_files_to_process.append(
                    {"type": "image", "path": temp_path}
                )

    for video_file in videos:
        if video_file.size == 0: continue
        temp_path = await save_temp_file(video_file)
        if temp_path:
            # Validate file extension to catch misclassified files
            file_ext = os.path.splitext(temp_path)[1].lower()
            if file_ext in IMAGE_EXTENSIONS:
                print(f"WARNING: File {video_file.filename} sent as video but has image extension {file_ext}. Correcting to image.")
                media_files_to_process.append(
                    {"type": "image", "path": temp_path}
                )
            else:
                media_files_to_process.append(
                    {"type": "video", "path": temp_path}
                )

    
    # 5. Enqueue the background task
    try:
        await redis.enqueue_job(
            'task_1_preprocess',    # The name of our first async def task
            str(db_report.id),      # Arg 1: The report ID
            media_files_to_process  # Arg 2: The list of files to upload
        )
    except Exception as e:
        print(f"CRITICAL: Failed to queue ARQ task for RawReport {db_report.id}: {e}")
        # Note: The report is in the DB but the task failed to queue.
        # We should have a cleanup job for this.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "details": "Report saved but processing failed to start."}
        )
    
    # 6. Return the success response (this should be very fast)
    return {
        "success": True,
        "details": {
            "message": "Report received and queued for processing.",
            "raw_report_id": db_report.id
        }
    }