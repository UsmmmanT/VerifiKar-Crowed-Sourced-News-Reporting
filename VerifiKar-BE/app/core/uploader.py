import boto3
import uuid
import os
from mimetypes import guess_type
from botocore.exceptions import ClientError

from app.core.config import settings

# 1. Initialize the S3 client for Cloudflare R2
s3_client = boto3.client(
    service_name='s3',
    endpoint_url=settings.R2_ENDPOINT_URL,
    aws_access_key_id=settings.R2_ACCESS_KEY_ID,
    aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
    region_name='auto',  # R2 specific
)

def upload_file_from_path(
    temp_file_path: str, 
    original_filename: str, 
    folder: str = "reports"
) -> str | None:
    """
    Uploads a file from a local path to your Cloudflare R2 bucket.

    :param temp_file_path: The full local path to the file (e.g., 'temp_uploads/uuid-image.jpg')
    :param original_filename: The original name of the file (e.g., 'image.jpg')
    :param folder: The sub-folder in the bucket (e.g., 'reports', 'profiles').
    :return: The public URL of the uploaded file, or None if upload failed.
    """
    try:
        # 1. Generate a unique object key
        file_extension = original_filename.split('.')[-1] if '.' in original_filename else 'tmp'
        unique_filename = f"{uuid.uuid4()}.{file_extension}"
        object_key = f"{folder}/{unique_filename}"

        # 2. Guess the file's content type
        content_type, _ = guess_type(original_filename)
        if content_type is None:
            content_type = "application/octet-stream"

        # 3. Upload the file *from its path*
        # This is a blocking (synchronous) function,
        # which is why we run it in a thread from our task.
        s3_client.upload_file(
            Filename=temp_file_path,
            Bucket=settings.R2_BUCKET_NAME,
            Key=object_key,
            ExtraArgs={
                'ContentType': content_type
            }
        )

        # 4. Construct the public URL
        public_url = f"https://{settings.R2_PUBLIC_DOMAIN}/{object_key}"

        return public_url

    except ClientError as e:
        print(f"Error uploading to R2: {e}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred during upload: {e}")
        return None