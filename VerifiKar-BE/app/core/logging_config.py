"""
Centralized logging configuration for VerifiKar backend.

Provides structured logging with JSON formatting for production
and human-readable format for development.
"""

import logging
import sys
from typing import Any
from datetime import datetime, timezone
import json


class JSONFormatter(logging.Formatter):
    """
    Custom JSON formatter for structured logging in production.
    Outputs logs as JSON objects for easy parsing by log aggregators.
    """
    
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }
        
        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
        
        # Add extra fields if present
        if hasattr(record, 'extra_fields'):
            log_data.update(record.extra_fields)
        
        return json.dumps(log_data)


class DevelopmentFormatter(logging.Formatter):
    """
    Human-readable formatter for development.
    Includes colors for better readability.
    """
    
    # ANSI color codes
    COLORS = {
        'DEBUG': '\033[36m',      # Cyan
        'INFO': '\033[32m',       # Green
        'WARNING': '\033[33m',    # Yellow
        'ERROR': '\033[31m',      # Red
        'CRITICAL': '\033[35m',   # Magenta
        'RESET': '\033[0m'
    }
    
    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, self.COLORS['RESET'])
        reset = self.COLORS['RESET']
        
        # Format: [TIMESTAMP] LEVEL - module.function:line - message
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        location = f"{record.module}.{record.funcName}:{record.lineno}"
        
        formatted = f"[{timestamp}] {color}{record.levelname:8}{reset} - {location:30} - {record.getMessage()}"
        
        # Add exception info if present
        if record.exc_info:
            formatted += "\n" + self.formatException(record.exc_info)
        
        return formatted


def setup_logging(
    level: str = "INFO",
    format_type: str = "json",
    log_file: str | None = None
) -> None:
    """
    Configure application-wide logging.
    
    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        format_type: Output format ("json" for production, "dev" for development)
        log_file: Optional file path to write logs to
    """
    
    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level.upper()))
    
    # Remove any existing handlers
    root_logger.handlers.clear()
    
    # Choose formatter based on environment
    if format_type == "json":
        formatter = JSONFormatter()
    else:
        formatter = DevelopmentFormatter()
    
    # Console handler (stdout)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # File handler (optional)
    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)
    
    # Set levels for third-party loggers to reduce noise
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("fastapi").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    
    root_logger.info("Logging configured", extra={
        'extra_fields': {
            'level': level,
            'format': format_type,
            'log_file': log_file
        }
    })


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance for a specific module.
    
    Args:
        name: Name of the logger (typically __name__)
    
    Returns:
        Configured logger instance
    """
    return logging.getLogger(name)


# Convenience function for adding extra context to logs
def log_with_context(logger: logging.Logger, level: str, message: str, **context: Any) -> None:
    """
    Log a message with additional context fields.
    
    Args:
        logger: Logger instance
        level: Log level (debug, info, warning, error, critical)
        message: Log message
        **context: Additional context fields to include
    """
    log_method = getattr(logger, level.lower())
    log_method(message, extra={'extra_fields': context})
