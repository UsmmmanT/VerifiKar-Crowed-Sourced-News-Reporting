from pydantic import ConfigDict
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    """
    Loads environment variables from the .env file.
    """
    # --- Database Settings ---
    DATABASE_URL: str

    # --- JWT Security Settings ---
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # --- Cloudflare R2 Storage Settings ---
    R2_BUCKET_NAME: str
    R2_ENDPOINT_URL: str
    R2_ACCESS_KEY_ID: str
    R2_SECRET_ACCESS_KEY: str
    R2_PUBLIC_DOMAIN: str

    # --- ARQ Task Queue Settings ---
    REDIS_URL: str

    # --- NEW: Google Gemini API Key ---
    GOOGLE_API_KEY: str

    # --- Logging Configuration ---
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "dev"  # "dev" or "json"
    LOG_FILE: str | None = None

    # --- Database Query Logging ---
    ENABLE_SQL_ECHO: bool = False  # Set to True in dev to see all SQL queries
    SLOW_QUERY_THRESHOLD_MS: int = 1000  # Log queries slower than 1000ms (1 second)

    # --- Model Service Configuration ---
    MODEL_SERVICE_URL: str = "http://localhost:8001"
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL_NAME: str = "mistral:7b"

    # --- Firebase Configuration ---
    FIREBASE_PROJECT_ID: str = ""  # Optional: only needed if using Firebase Admin SDK
    FIREBASE_CREDENTIALS_PATH: str | None = None  # Path to service account JSON key


    # This tells pydantic-settings to load from a .env file
    model_config = ConfigDict(env_file=".env", extra="ignore")


# Create a single instance that the rest of the app can import
settings = Settings()