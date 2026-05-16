from fastapi import APIRouter
from app.api import auth, reports, posts # <-- 1. IMPORT 'posts'

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(reports.router, prefix="/reports", tags=["Reports"])
api_router.include_router(posts.router, prefix="", tags=["Posts"]) # <-- FIX: Use an empty string