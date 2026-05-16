from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import List, Optional
from uuid import UUID
import datetime 
import json
import logging
from math import radians, sin, cos, sqrt, atan2
from collections import Counter

from app import schemas
from app.db import crud
from app.db.models import Post, InteractionEnum, User
from app.db.session import get_db_session
from geoalchemy2.shape import to_shape
from app.core.dependencies import get_optional_current_user, get_current_user, get_redis
from app.core.trending import (
    LOCATIONS_CACHE_KEY,
    TOPICS_CACHE_KEY,
    TRENDING_CACHE_TTL_SECONDS,
    build_trending_location_items,
    get_trending_topics,
)
from app.services.recommendation_service import get_recommendations
from app.services.notification_triggers import (
    trigger_trending_category_notification,
    trigger_high_engagement_notification,
)



router = APIRouter()

logger = logging.getLogger(__name__)

CATEGORY_META = {
    "fire": {"label": "Fire", "dot": "#D85A30", "emoji": "🔥", "colors": ["#F0997B", "#D85A30"], "subtitle": "High activity"},
    "traffic": {"label": "Traffic", "dot": "#BA7517", "emoji": "🚦", "colors": ["#FAC775", "#BA7517"], "subtitle": "Surge now"},
    "accident": {"label": "Accident", "dot": "#185FA5", "emoji": "🚗", "colors": ["#85B7EB", "#185FA5"], "subtitle": "Multiple zones"},
    "crime": {"label": "Crime", "dot": "#534AB7", "emoji": "🚔", "colors": ["#AFA9EC", "#534AB7"], "subtitle": "Verified"},
    "rescue": {"label": "Rescue", "dot": "#0F6E56", "emoji": "🚑", "colors": ["#5DCAA5", "#0F6E56"], "subtitle": "Urgent"},
    "protest": {"label": "Protest", "dot": "#993556", "emoji": "📢", "colors": ["#ED93B1", "#993556"], "subtitle": "Ongoing"},
    "disaster": {"label": "Disaster", "dot": "#A32D2D", "emoji": "🌊", "colors": ["#F7C1C1", "#A32D2D"], "subtitle": "Monitoring"},
    "infra": {"label": "Infra", "dot": "#3B6D11", "emoji": "🏗️", "colors": ["#C0DD97", "#3B6D11"], "subtitle": "Road damage"},
    "outage": {"label": "Outage", "dot": "#5F5E5A", "emoji": "⚡", "colors": ["#D3D1C7", "#5F5E5A"], "subtitle": "Service impact"},
    "weather": {"label": "Weather", "dot": "#378ADD", "emoji": "⛈️", "colors": ["#B5D4F4", "#378ADD"], "subtitle": "Storm alert"},
    "all": {"label": "All", "dot": "#FFFFFF"},
}

DISCOVER_CHIP_KEYS = ["all", "fire", "traffic", "accident", "crime", "rescue", "protest", "disaster", "infra", "outage"]

LOCATION_AREAS = [
    {"name": "Saddar", "lat": 24.8615, "lon": 67.0099, "emoji": "🏙️", "colors": ["#AFA9EC", "#3C3489"]},
    {"name": "Clifton", "lat": 24.8138, "lon": 67.0305, "emoji": "🌊", "colors": ["#9FE1CB", "#085041"]},
    {"name": "Gulshan-e-Iqbal", "lat": 24.9228, "lon": 67.0822, "emoji": "🏘️", "colors": ["#F5C4B3", "#993C1D"]},
    {"name": "Defence (DHA)", "lat": 24.8050, "lon": 67.0685, "emoji": "🏢", "colors": ["#F4C0D1", "#72243E"]},
    {"name": "Korangi", "lat": 24.8380, "lon": 67.1330, "emoji": "🏭", "colors": ["#B5D4F4", "#0C447C"]},
    {"name": "Malir", "lat": 24.9000, "lon": 67.2000, "emoji": "🌿", "colors": ["#FAC775", "#633806"]},
]


async def _read_cached_json(redis_client, cache_key: str):
    """Read JSON payload from Redis cache and decode into Python objects."""
    if not redis_client:
        return None
    cached = await redis_client.get(cache_key)
    if not cached:
        return None
    if isinstance(cached, bytes):
        cached = cached.decode("utf-8")
    return json.loads(cached)


async def _write_cached_json(redis_client, cache_key: str, payload):
    """Write JSON payload to Redis with configured trending TTL."""
    if not redis_client:
        return
    await redis_client.set(
        cache_key,
        json.dumps(payload),
        ex=TRENDING_CACHE_TTL_SECONDS,
    )


def _normalize_category(category: str | None) -> str:
    if not category:
        return "outage"
    val = category.lower()
    if "fire" in val:
        return "fire"
    if "traffic" in val:
        return "traffic"
    if "accident" in val or "crash" in val:
        return "accident"
    if "crime" in val or "robbery" in val or "theft" in val:
        return "crime"
    if "rescue" in val or "medical" in val or "aid" in val:
        return "rescue"
    if "protest" in val or "rally" in val:
        return "protest"
    if "flood" in val or "disaster" in val or "earthquake" in val:
        return "disaster"
    if "infra" in val or "road" in val or "construction" in val:
        return "infra"
    if "weather" in val or "rain" in val or "storm" in val:
        return "weather"
    if "outage" in val or "power" in val or "electric" in val:
        return "outage"
    return "outage"


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_km = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * earth_radius_km * atan2(sqrt(a), sqrt(1 - a))


def _nearest_area_name(lat: float, lon: float) -> str:
    nearest = LOCATION_AREAS[0]
    nearest_distance = _haversine_km(lat, lon, nearest["lat"], nearest["lon"])
    for area in LOCATION_AREAS[1:]:
        distance = _haversine_km(lat, lon, area["lat"], area["lon"])
        if distance < nearest_distance:
            nearest = area
            nearest_distance = distance
    return nearest["name"]


@router.get("/discover/overview", response_model=schemas.ApiResponse[schemas.DiscoverOverviewResponse])
async def get_discover_overview(
    request: Request,
    lat: float = Query(24.8607, ge=-90.0, le=90.0),
    lon: float = Query(67.0099, ge=-180.0, le=180.0),
    radius_km: float = Query(50.0, gt=0.0, le=80.0),
    max_days_old: int = Query(30, ge=1, le=60),
    db: AsyncSession = Depends(get_db_session),
):
    redis_client = getattr(request.app.state, "redis", None)

    topics = await _read_cached_json(redis_client, TOPICS_CACHE_KEY)
    if topics is None:
        topics = await get_trending_topics(db, limit=10)
        await _write_cached_json(redis_client, TOPICS_CACHE_KEY, topics)

    locations = await _read_cached_json(redis_client, LOCATIONS_CACHE_KEY)
    if locations is None:
        try:
            trending_location_rows = await crud.get_trending_locations(db, limit=10)
            locations = build_trending_location_items(trending_location_rows)
            await _write_cached_json(redis_client, LOCATIONS_CACHE_KEY, locations)
        except Exception:
            locations = []

    posts = await crud.get_feed_posts(
        db,
        lat=lat,
        lon=lon,
        radius_km=radius_km,
        max_days_old=max_days_old,
        category=None,
        search=None,
        global_search=False,
        min_credibility=None,
        skip=0,
        limit=160,
    )

    if not posts:
        posts = await crud.get_feed_posts(
            db,
            lat=lat,
            lon=lon,
            radius_km=radius_km,
            max_days_old=max_days_old,
            category=None,
            search=None,
            global_search=True,
            min_credibility=None,
            skip=0,
            limit=160,
        )

    normalized_posts = []
    for post in posts:
        key = _normalize_category(post.event_category)
        shape = to_shape(post.location)
        normalized_posts.append(
            {
                "post": post,
                "category_key": key,
                "lat": shape.y,
                "lon": shape.x,
            }
        )

    events = []
    now = datetime.datetime.now(datetime.timezone.utc)
    for item in normalized_posts[:8]:
        post = item["post"]
        key = item["category_key"]
        meta = CATEGORY_META.get(key, CATEGORY_META["outage"])
        age_hours = max(0.1, (now - post.created_at).total_seconds() / 3600)
        if age_hours <= 12:
            event_status = "Live now"
            status_bg = "#FCEBEB"
            status_color = "#791F1F"
        elif age_hours <= 48:
            event_status = "Upcoming"
            status_bg = "#E6F1FB"
            status_color = "#0C447C"
        else:
            event_status = "Tomorrow"
            status_bg = "#FAEEDA"
            status_color = "#633806"

        nearest_area = LOCATION_AREAS[0]
        nearest_distance = _haversine_km(
            nearest_area["lat"],
            nearest_area["lon"],
            item["lat"],
            item["lon"],
        )
        for area in LOCATION_AREAS[1:]:
            distance = _haversine_km(area["lat"], area["lon"], item["lat"], item["lon"])
            if distance < nearest_distance:
                nearest_distance = distance
                nearest_area = area

        attendee_count = int(getattr(post, "upvotes", 0) + getattr(post, "downvotes", 0) + (post.credibility_score * 100))
        local_time = post.created_at.astimezone(datetime.timezone.utc)
        events.append(
            {
                "category": meta["label"],
                "label": f"{meta['label']} Update",
                "day": local_time.strftime("%d"),
                "month": local_time.strftime("%b"),
                "title": post.content[:90] + ("..." if len(post.content) > 90 else ""),
                "location": nearest_area["name"],
                "attending": f"{max(10, attendee_count)} attending",
                "status": event_status,
                "status_bg": status_bg,
                "status_color": status_color,
                "emoji": meta["emoji"],
                "colors": meta["colors"],
            }
        )

    if len(events) < 4:
        fallback_keys = ["fire", "traffic", "rescue", "disaster"]
        for key in fallback_keys:
            if len(events) >= 4:
                break
            meta = CATEGORY_META[key]
            events.append(
                {
                    "category": meta["label"],
                    "label": f"{meta['label']} Briefing",
                    "day": now.strftime("%d"),
                    "month": now.strftime("%b"),
                    "title": f"Community {meta['label'].lower()} update in progress",
                    "location": LOCATION_AREAS[len(events) % len(LOCATION_AREAS)]["name"],
                    "attending": f"{120 + (len(events) * 37)} attending",
                    "status": "Upcoming",
                    "status_bg": "#E6F1FB",
                    "status_color": "#0C447C",
                    "emoji": meta["emoji"],
                    "colors": meta["colors"],
                }
            )

    chips = [
        {
            "key": key,
            "label": CATEGORY_META[key]["label"],
            "dot": CATEGORY_META[key]["dot"],
        }
        for key in DISCOVER_CHIP_KEYS
    ]

    return {
        "success": True,
        "details": {
            "filter_chips": chips,
            "topics": topics,
            "locations": locations,
            "events": events,
        },
    }


@router.get("/discover/section-posts", response_model=schemas.ApiResponse[schemas.DiscoverSectionPostsResponse])
async def get_discover_section_posts(
    section_type: str = Query(..., pattern="^(topic|location|event)$"),
    key: str = Query(..., min_length=1, max_length=100),
    lat: float = Query(24.8607, ge=-90.0, le=90.0),
    lon: float = Query(67.0099, ge=-180.0, le=180.0),
    radius_km: float = Query(50.0, gt=0.0, le=80.0),
    max_days_old: int = Query(30, ge=1, le=60),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db_session),
):
    posts = await crud.get_feed_posts(
        db,
        lat=lat,
        lon=lon,
        radius_km=radius_km,
        max_days_old=max_days_old,
        category=None,
        search=None,
        global_search=True,
        min_credibility=None,
        skip=0,
        limit=200,
    )

    normalized = []
    for post in posts:
        shape = to_shape(post.location)
        normalized.append(
            {
                "post": post,
                "category_key": _normalize_category(post.event_category),
                "lat": shape.y,
                "lon": shape.x,
            }
        )

    key_norm = key.strip().lower()
    selected = []

    if section_type == "topic":
        selected = [p for p in normalized if p["category_key"] == key_norm]

    elif section_type == "event":
        selected = [p for p in normalized if p["category_key"] == _normalize_category(key_norm)]

    elif section_type == "location":
        # Use spatial query to find clusters within the named area (same pattern as trending locations)
        try:
            # First, check total active clusters and log their coordinates
            debug_query = text("SELECT COUNT(*) FROM clusters WHERE status = 'active'")
            debug_result = await db.execute(debug_query)
            total_active = debug_result.scalar()
            logger.info(f"[Location Section] Total active clusters: {total_active}")
            
            # Log cluster coordinates to understand the coordinate system
            coord_query = text("""
                SELECT id, 
                       ST_X(avg_location) as x, 
                       ST_Y(avg_location) as y,
                       ST_X(ST_Transform(avg_location::geometry, 3857)) as x_3857,
                       ST_Y(ST_Transform(avg_location::geometry, 3857)) as y_3857
                FROM clusters 
                WHERE status = 'active'
                LIMIT 3
            """)
            coord_result = await db.execute(coord_query)
            for row in coord_result:
                logger.info(f"[Location Section] Cluster: id={row[0]}, x={row[1]}, y={row[2]}, x_3857={row[3]}, y_3857={row[4]}")
            
            # Check clusters for this area
            location_query = text("""
                SELECT DISTINCT c.id
                FROM clusters c
                JOIN planet_osm_polygon b
                    ON ST_Contains(b.way, ST_Transform(c.avg_location::geometry, 3857))
                WHERE c.status = 'active'
                  AND c.last_report_at > NOW() - INTERVAL '30 days'
                  AND b.boundary = 'administrative'
                  AND b.admin_level IN ('8', '9', '10')
                  AND b.name ILIKE :area_name
            """)
            
            result = await db.execute(
                location_query, 
                {"area_name": f"%{key.strip()}%"}
            )
            cluster_ids = result.scalars().all()
            logger.info(f"[Location Section] Found {len(cluster_ids)} clusters for area '{key}' (time window: 30 days)")
            
            # Log the query without time filter to debug
            debug_location_query = text("""
                SELECT DISTINCT c.id
                FROM clusters c
                JOIN planet_osm_polygon b
                    ON ST_Contains(b.way, ST_Transform(c.avg_location::geometry, 3857))
                WHERE c.status = 'active'
                  AND b.boundary = 'administrative'
                  AND b.admin_level IN ('8', '9', '10')
                  AND b.name ILIKE :area_name
            """)
            debug_result = await db.execute(
                debug_location_query,
                {"area_name": f"%{key.strip()}%"}
            )
            debug_cluster_ids = debug_result.scalars().all()
            logger.info(f"[Location Section] Without time filter: {len(debug_cluster_ids)} clusters for area '{key}'")
            
            # Log polygon boundaries for debugging
            poly_query = text("SELECT name, ST_AsText(way) FROM planet_osm_polygon WHERE name ILIKE :area_name")
            poly_result = await db.execute(poly_query, {"area_name": f"%{key.strip()}%"})
            for row in poly_result:
                logger.info(f"[Location Section] Polygon '{row[0]}': {row[1][:100]}...")
            
            cluster_id_set = set(cluster_ids)
            selected = [
                p
                for p in normalized
                if p["post"].cluster_id in cluster_id_set
            ]
        except Exception as e:
            # Fallback: if spatial query fails, try text-based area_name matching
            logger.warning(f"Spatial query failed for location '{key}': {e}", exc_info=True)
            cluster_ids = await crud.get_active_cluster_ids_by_area_name(
                db,
                area_name=f"%{key.strip()}%",
                max_days_old=max_days_old,
            )
            cluster_id_set = set(cluster_ids)
            selected = [
                p
                for p in normalized
                if p["post"].cluster_id in cluster_id_set
            ]

    selected.sort(key=lambda p: p["post"].created_at, reverse=True)
    selected = selected[:limit]

    return {
        "success": True,
        "details": {
            "posts": [
                {
                    "id": item["post"].id,
                    "content": item["post"].content,
                    "event_category": item["post"].event_category,
                    "credibility_score": item["post"].credibility_score,
                    "created_at": item["post"].created_at,
                    "area": _nearest_area_name(item["lat"], item["lon"]),
                    "distance_km": round(_haversine_km(lat, lon, item["lat"], item["lon"]), 1),
                    "upvotes": int(getattr(item["post"], "upvotes", 0) or 0),
                    "downvotes": int(getattr(item["post"], "downvotes", 0) or 0),
                }
                for item in selected
            ]
        },
    }


@router.get("/profile/overview", response_model=schemas.ApiResponse[schemas.ProfileOverviewResponse])
async def get_profile_overview(
    db: AsyncSession = Depends(get_db_session),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Get authenticated user's submissions and approved contributed posts."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "details": {"message": "Authentication required"},
            },
        )

    submissions = await crud.get_user_submissions(db, current_user.id)
    try:
        approved_posts = await crud.get_user_approved_posts(db, current_user.id)
    except Exception:
        approved_posts = []

    return {
        "success": True,
        "details": {
            "submissions": [
                {
                    "id": item.id,
                    "raw_text": item.raw_text,
                    "status": item.status.value if hasattr(item.status, 'value') else str(item.status),
                    "created_at": item.created_at,
                }
                for item in submissions
            ],
            "approved_posts": [
                {
                    "id": item.id,
                    "content": item.content,
                    "event_category": item.event_category,
                    "credibility_score": item.credibility_score,
                    "created_at": item.created_at,
                }
                for item in approved_posts
            ],
        },
    }

# --- NEW HELPER FUNCTION ---
# We use this to avoid repeating code
def _build_post_schema(post: Post) -> schemas.Post:
    """
    Helper to convert a DB Post object into a Pydantic Post schema.
    
    OPTIMIZED: Supports both full ORM relationships (for detail views) 
    and lean media_urls (for feed queries).
    """
    
    location_shape = to_shape(post.location)

    # Process Media - supports two patterns:
    # 1. Optimized feed: post.media_urls (list of dicts with media_type, storage_url)
    # 2. Detail views: post.media_items (full ORM relationships)
    media_list = []
    
    if hasattr(post, 'media_urls') and post.media_urls:
        # Optimized path: lean query already fetched URLs
        for idx, media in enumerate(post.media_urls):
            media_list.append(schemas.PostMedia(
                id=post.id,  # Fake ID using post ID (media IDs not needed for display)
                media_url=media['storage_url'],
                media_type=media['media_type']
            ))
    else:
        # Full ORM path: detail views with full relationships
        # Use inspect to check if media_items was loaded (avoid triggering lazy load)
        from sqlalchemy import inspect as sa_inspect
        insp = sa_inspect(post)
        
        # Only access media_items if it was eagerly loaded
        if 'media_items' in insp.unloaded:
            # Not loaded - this is expected for optimized feed queries
            pass
        else:
            # Already loaded - process it
            for media_link in post.media_items:
                # Check that the nested relationships loaded correctly
                if media_link.processed_media_item and media_link.processed_media_item.raw_media_item:
                    pm = media_link.processed_media_item
                    media_list.append(schemas.PostMedia(
                        id=pm.id,
                        media_url=pm.raw_media_item.storage_url,
                        media_type=pm.media_type
                    ))
            
    return schemas.Post(
        id=post.id,
        content=post.content,
        credibility_score=post.credibility_score,
        event_category=post.event_category,
        location_lat=location_shape.y,
        location_lon=location_shape.x,
        created_at=post.created_at,
        media_items=media_list,
        upvotes=getattr(post, 'upvotes', 0), # Use getattr to safely access the count
        downvotes=getattr(post, 'downvotes', 0)
    )


# --- UPDATED GET /feed ---
@router.get("/feed", response_model=schemas.ApiResponse[schemas.PostListResponse])
async def get_main_feed(
    lat: float = Query(24.8607, ge=-90.0, le=90.0, description="User's latitude [-90, 90]. Defaults to Karachi center."),
    lon: float = Query(67.0099, ge=-180.0, le=180.0, description="User's longitude [-180, 180]. Defaults to Karachi center."),
    radius_km: float = Query(50.0, gt=0.0, le=50.0, description="Search radius in kilometers [0.1, 50]. Defaults to 50km to cover all of Karachi."),
    max_days_old: int = Query(7, ge=1, le=30, description="Filter posts newer than X days [1, 30]. Default is 7."),
    category: str | None = Query(None, max_length=100, description="Filter by event category"),
    search: str | None = Query(None, max_length=100, description="Search text in post content/category"),
    global_search: bool = Query(False, description="If true, ignore location radius filter"),
    min_credibility: float | None = Query(None, ge=0.0, le=1.0, description="Minimum credibility score (0.0 to 1.0)"),
    skip: int = Query(0, ge=0, le=1000, description="Pagination skip [0, 1000]. Prevents excessive offset queries."),
    limit: int = Query(20, ge=1, le=100, description="Pagination limit [1, 100]. Max 100 posts per request."),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get a feed of active posts near a user's location, with optional filters.
    
    INPUT VALIDATION (Neon Free Tier Protection):
    - Lat/Lon: Valid coordinate ranges
    - Radius: Max 50km to prevent expensive spatial queries
    - Max Days: Limited to 30 days to reduce query scope
    - Skip: Max 1000 to prevent deep pagination issues
    - Limit: Max 100 posts to control response size
    """
    db_posts = await crud.get_feed_posts(
        db, 
        lat=lat, 
        lon=lon, 
        radius_km=radius_km, 
        max_days_old=max_days_old,
        category=category,
        search=search,
        global_search=global_search,
        min_credibility=min_credibility,
        skip=skip, 
        limit=limit
    )
    
    # Build post schemas
    posts = [_build_post_schema(post) for post in db_posts]
    
    # Wrap in ApiResponse format
    return {
        "success": True,
        "details": {
            "posts": posts
        }
    }


# === GET /posts/recommendations (MUST be before /posts/{post_id} for correct routing) ===
@router.get("/posts/recommendations", response_model=schemas.ApiResponse[schemas.RecommendationsResponse])
async def get_user_recommendations(
    limit: int = Query(20, ge=1, le=100),
    category: Optional[str] = Query(None),
    user_location_lat: Optional[float] = Query(None, ge=-90, le=90),
    user_location_lon: Optional[float] = Query(None, ge=-180, le=180),
    exclude_interacted: bool = Query(True),
    hours_lookback: int = Query(24, ge=1, le=720),
    db: AsyncSession = Depends(get_db_session),
    current_user: User | None = Depends(get_optional_current_user),
    redis: Optional[object] = Depends(get_redis),
):
    """
    Get personalized post recommendations for the current user.
    
    **Features:**
    - Recommendation scoring combines: user preferences, trending, credibility, recency, engagement
    - Filters by category (optional) and location (optional)
    - Caches results in Redis for 5 minutes
    - Works without authentication (anonymous users get trending posts)
    
    **Query Parameters:**
    - limit: Number of recommendations to return (1-100, default 20)
    - category: Optional category filter (e.g., "Fire", "Accident")
    - user_location_lat, user_location_lon: User's location for distance filtering
    - exclude_interacted: Whether to exclude posts user has already voted on (default: true)
    - hours_lookback: Time window for trending posts in hours (1-720, default 24)
    
    **Response:**
    Returns list of posts ranked by recommendation score with reason for recommendation.
    """
    try:
        logger.info(f"[Recommendations] Request from user: {current_user.id if current_user else 'anonymous'}")
        logger.info(f"[Recommendations] Params - limit: {limit}, category: {category}, hours: {hours_lookback}")
        logger.info(f"[Recommendations] Location - lat: {user_location_lat}, lon: {user_location_lon}")
        
        # Use user's location if provided, otherwise use default Karachi
        user_location = None
        if user_location_lat is not None and user_location_lon is not None:
            # Convert to WKT string format that get_recommendations expects
            user_location = f"SRID=4326;POINT({user_location_lon} {user_location_lat})"
            logger.info(f"[Recommendations] User location WKT: {user_location}")
        
        # Get recommendations from service
        recommendations = await get_recommendations(
            db=db,
            user_id=current_user.id if current_user else None,
            limit=limit,
            user_location=user_location,
            category_filter=category,
            exclude_interacted=exclude_interacted if current_user else False,
            hours_lookback=hours_lookback,
        )
        
        logger.info(f"[Recommendations] Returned {len(recommendations)} recommendations")
        
        # Convert to response schema
        recommended_posts = [
            schemas.RecommendedPost(
                id=rec["post_id"],
                content=rec.get("content", ""),
                event_category=rec.get("category"),
                credibility_score=rec.get("credibility_score", 0.0),
                location_lat=rec.get("location_lat", 24.8607),
                location_lon=rec.get("location_lon", 67.0099),
                created_at=rec.get("created_at", datetime.datetime.now(datetime.timezone.utc)),
                upvotes=rec.get("upvotes", 0),
                downvotes=rec.get("downvotes", 0),
                recommendation_score=rec.get("score", 0.0),
                reason=rec.get("reason", ""),
            )
            for rec in recommendations
        ]
        
        return {
            "success": True,
            "details": schemas.RecommendationsResponse(
                recommendations=recommended_posts,
                total_count=len(recommended_posts),
            )
        }
    
    except Exception as e:
        logger.error(f"Error getting recommendations for user {current_user.id if current_user else 'anonymous'}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "details": {"message": f"Failed to get recommendations: {str(e)}"}
            }
        )


# --- UPDATED GET /posts/{post_id} ---
@router.get("/posts/{post_id}", response_model=schemas.ApiResponse[schemas.PostDetailsResponse])
async def get_post_details(
    post_id: UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get a single post by its ID, including all replies,
    media, and contributor info.
    """
    db_post = await crud.get_post_with_details(db, post_id=post_id)
    if not db_post:
        raise HTTPException(
            status_code=404, 
            detail={
                "success": False,
                "details": {"message": "Post not found"}
            }
        )

    # 1. Build the main post using our helper
    main_post_schema = _build_post_schema(db_post)

    # 2. Process Contributors
    contrib_list = []
    if db_post.contributors:
        for c in db_post.contributors:
            if c.report:
                contrib_list.append(schemas.PostContributor(
                    user_id=c.report.user_id,
                    contribution_score=c.contribution_score
                ))

    # 3. Process Replies
    reply_list = [_build_post_schema(reply) for reply in db_post.replies] if db_post.replies else []
    
    # 4. Process Parent Post
    parent_post_schema = None
    if db_post.parent_post:
        parent_post_schema = _build_post_schema(db_post.parent_post)

    # 5. Build the final response
    post_details = schemas.PostWithDetails(
        **main_post_schema.model_dump(),
        contributors=contrib_list,
        replies=reply_list,
        parent_post=parent_post_schema
    )
    
    # Wrap in ApiResponse format
    return {
        "success": True,
        "details": {
            "post": post_details
        }
    }


@router.post(
    "/posts/{post_id}/comments",
    response_model=schemas.ApiResponse[schemas.PostCommentResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_post_comment(
    post_id: UUID,
    payload: schemas.PostCommentCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Create a reply(comment) under a post thread."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "details": {"message": "Authentication required to comment"},
            },
        )

    parent_post = await db.get(Post, post_id)
    if not parent_post or parent_post.is_deleted:
        raise HTTPException(
            status_code=404,
            detail={
                "success": False,
                "details": {"message": "Post not found"},
            },
        )

    content = payload.content.strip()
    if not content:
        raise HTTPException(
            status_code=422,
            detail={
                "success": False,
                "details": {"message": "Comment cannot be empty"},
            },
        )

    reply = Post(
        content=content,
        credibility_score=0.5,
        location=parent_post.location,
        event_category=parent_post.event_category,
        cluster_id=parent_post.cluster_id,
        parent_post_id=parent_post.id,
    )
    db.add(reply)
    await db.commit()
    await db.refresh(reply)

    # Keep response shape aligned with feed/detail post schema expectations.
    reply.media_urls = []
    reply.upvotes = 0
    reply.downvotes = 0

    return {
        "success": True,
        "details": {
            "message": "Comment added successfully",
            "reply": _build_post_schema(reply),
        },
    }


@router.post("/posts/{post_id}/interact", response_model=schemas.ApiResponse[schemas.PostInteractionResponse])
async def interact_with_post(
    post_id: UUID,
    interaction_data: schemas.PostInteractionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: User | None = Depends(get_optional_current_user)
):
    """
    Allows a user to upvote, downvote, or flag a post.
    
    **Authentication Required:** Yes
    
    **Behavior:**
    - Clicking the same button twice removes the interaction (toggle off)
    - Changing vote (upvote → downvote) updates the interaction
    - Flags are independent and don't replace votes
    """
    
    # 1. Authentication check
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "details": {"message": "Authentication required to interact with posts"}
            }
        )
    
    # 2. Verify post exists
    db_post = await db.get(Post, post_id)
    if not db_post:
        raise HTTPException(
            status_code=404, 
            detail={
                "success": False,
                "details": {"message": "Post not found"}
            }
        )
    
    # 3. Create or update interaction
    interaction, is_new, old_type = await crud.create_or_update_post_interaction(
        db=db,
        post_id=post_id,
        user_id=current_user.id,
        interaction_type=interaction_data.interaction_type
    )
    
    # 4. Get updated counts
    counts = await crud.get_post_interaction_counts(db, post_id)
    
    # 5. Enqueue reputation update task (async, doesn't block)
    try:
        redis_pool = request.app.state.redis
        await redis_pool.enqueue_job(
            'task_6_update_reputation',
            str(post_id),
            interaction_data.interaction_type.value,
            is_new,
            old_type.value if old_type else None
        )
    except Exception as e:
        print(f"Warning: Failed to enqueue reputation update task: {e}")
    
    # 6. Trigger notifications if needed (trending category or high engagement)
    try:
        if is_new and interaction_data.interaction_type.value == "upvote":
            # Only trigger for new upvotes to avoid multiple triggers
            # Check if trending
            await trigger_trending_category_notification(db, db_post)
            # Check if high engagement
            await trigger_high_engagement_notification(db, db_post)
    except Exception as e:
        logger.warning(f"Failed to trigger notifications for post {post_id}: {e}")
    
    # 7. Build response message
    if interaction is None:
        message = f"Removed your {old_type.value}"
    elif is_new:
        message = f"Added {interaction_data.interaction_type.value}"
    else:
        message = f"Changed from {old_type.value} to {interaction_data.interaction_type.value}"
    
    # Wrap in ApiResponse format
    return {
        "success": True,
        "details": {
            "message": message,
            "new_upvotes": counts['upvotes'],
            "new_downvotes": counts['downvotes'],
            "new_flags": counts['flags']
        }
    }


@router.get("/notifications", response_model=schemas.ApiResponse[schemas.NotificationsResponse])
async def get_user_notifications(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    status_filter: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    """
    Get notification history for the current user.
    
    **Authentication Required:** Yes
    
    **Features:**
    - Returns recent notifications with pagination
    - Can filter by status (sent, failed, delivered, etc.)
    - Shows related post and cluster information
    
    **Query Parameters:**
    - limit: Number of notifications to return (1-100, default 50)
    - offset: Pagination offset (default 0)
    - status_filter: Optional status to filter by (e.g., "sent", "failed")
    
    **Response:**
    Returns list of notification log entries with total count.
    """
    try:
        # Get notification logs for user
        notification_logs = await crud.get_user_notification_logs(
            db=db,
            user_id=current_user.id,
            limit=limit,
            offset=offset,
            status=status_filter,
        )
        
        # Convert to response schema
        notification_items = [
            schemas.NotificationLogItem(
                id=log.id,
                notification_type=log.notification_type,
                title=log.title,
                body=log.body,
                status=log.status,
                sent_at=log.sent_at,
                created_at=log.created_at,
                post_id=log.post_id,
                cluster_id=log.cluster_id,
            )
            for log in notification_logs
        ]
        
        # Get total count for pagination
        total_count = await crud.count_user_notification_logs(
            db=db,
            user_id=current_user.id,
            status=status_filter,
        )
        
        return {
            "success": True,
            "details": schemas.NotificationsResponse(
                notifications=notification_items,
                total_count=total_count,
            )
        }
    
    except Exception as e:
        logger.error(f"Error getting notifications for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "details": {"message": f"Failed to get notifications: {str(e)}"}
            }
        )


@router.post("/admin/seed-osm-polygons", response_model=schemas.ApiResponse[dict])
async def seed_osm_polygons(
    db: AsyncSession = Depends(get_db_session),
):
    """
    Smart seeding endpoint: Creates precise, non-overlapping polygon boundaries 
    based on ACTUAL cluster data from the database.
    
    **Process:**
    1. Queries all active clusters with their coordinates
    2. Groups by area_name
    3. Calculates tight bounding boxes with buffer zones
    4. Creates only 3 focused areas: Malir, Gulshan-e-Iqbal, FAST/University Area
    
    **WARNING:** This endpoint DELETES all existing seed data and rebuilds from scratch.
    """
    try:
        # Step 1: Clear existing seeded data
        await db.execute(text("DELETE FROM planet_osm_polygon WHERE osm_id <= 100"))
        await db.commit()
        logger.info("🗑️ Cleared existing seed data")
        
        # Step 2: Get all active clusters with their coordinates
        clusters_query = text("""
            SELECT 
                id,
                area_name,
                ST_X(ST_Transform(avg_location::geometry, 3857)) as x_3857,
                ST_Y(ST_Transform(avg_location::geometry, 3857)) as y_3857,
                ST_X(avg_location::geometry) as lon_4326,
                ST_Y(avg_location::geometry) as lat_4326
            FROM clusters
            WHERE status = 'active'::clusterstatusenum
            ORDER BY area_name, x_3857
        """)
        
        result = await db.execute(clusters_query)
        clusters = result.fetchall()
        
        logger.info(f"📍 Found {len(clusters)} active clusters")
        
        # Step 3: Group clusters by area_name and calculate bounding boxes
        area_clusters = {}
        for cluster in clusters:
            cluster_id, area_name, x_3857, y_3857, lon_4326, lat_4326 = cluster
            
            if area_name not in area_clusters:
                area_clusters[area_name] = []
            
            area_clusters[area_name].append({
                'id': str(cluster_id),
                'x_3857': x_3857,
                'y_3857': y_3857,
                'lon': lon_4326,
                'lat': lat_4326,
            })
            
            logger.info(f"  → {area_name}: x_3857={x_3857:.0f}, y_3857={y_3857:.0f}, lat={lat_4326:.4f}, lon={lon_4326:.4f}")
        
        # Step 4: Create precise polygons for each area
        areas_to_seed = []
        
        for area_name, clusters_in_area in area_clusters.items():
            if area_name not in ["Saddar", "Malir", "Gulshan-e-Iqbal"]:
                logger.info(f"⏭️  Skipping {area_name} (not in target list)")
                continue
            
            # Calculate bounding box with buffer
            x_coords = [c['x_3857'] for c in clusters_in_area]
            y_coords = [c['y_3857'] for c in clusters_in_area]
            
            min_x = min(x_coords)
            max_x = max(x_coords)
            min_y = min(y_coords)
            max_y = max(y_coords)
            
            # Add 15km buffer (in Web Mercator units ≈ 1500 units)
            buffer = 15000
            
            min_x_buffered = min_x - buffer
            max_x_buffered = max_x + buffer
            min_y_buffered = min_y - buffer
            max_y_buffered = max_y + buffer
            
            polygon_wkt = f"POLYGON(({min_x_buffered} {min_y_buffered}, {max_x_buffered} {min_y_buffered}, {max_x_buffered} {max_y_buffered}, {min_x_buffered} {max_y_buffered}, {min_x_buffered} {min_y_buffered}))"
            
            logger.info(f"""
📦 {area_name}:
   Clusters: {len(clusters_in_area)}
   X range (raw): {min_x:.0f} → {max_x:.0f}
   Y range (raw): {min_y:.0f} → {max_y:.0f}
   X range (buffered): {min_x_buffered:.0f} → {max_x_buffered:.0f}
   Y range (buffered): {min_y_buffered:.0f} → {max_y_buffered:.0f}
            """)
            
            areas_to_seed.append((len(areas_to_seed) + 1, area_name, polygon_wkt))
        
        # Step 5: Insert into planet_osm_polygon
        inserted_count = 0
        for osm_id, name, polygon_wkt in areas_to_seed:
            insert_query = text("""
                INSERT INTO planet_osm_polygon (osm_id, name, boundary, admin_level, way, tags, created_at)
                VALUES (:osm_id, :name, 'administrative', '8', 
                        ST_GeomFromText(:polygon_wkt, 3857), '{"area_type": "karachi_district"}', NOW())
                ON CONFLICT (osm_id) DO UPDATE SET 
                    name = EXCLUDED.name,
                    way = EXCLUDED.way,
                    tags = EXCLUDED.tags
            """)
            
            await db.execute(
                insert_query,
                {
                    "osm_id": osm_id,
                    "name": name,
                    "polygon_wkt": polygon_wkt,
                },
            )
            await db.commit()
            inserted_count += 1
            logger.info(f"✅ Inserted: {name}")
        
        # Step 6: Verify
        verify_query = text("SELECT COUNT(*) as total FROM planet_osm_polygon WHERE osm_id <= 100")
        result = await db.execute(verify_query)
        total_count = result.scalar()
        
        return {
            "success": True,
            "details": {
                "message": f"Smart OSM polygon seeding complete",
                "inserted": inserted_count,
                "total_areas": total_count,
                "areas_seeded": [name for _, name, _ in areas_to_seed],
                "total_clusters_analyzed": len(clusters),
                "status": "ready" if total_count > 0 else "incomplete"
            }
        }
    
    except Exception as e:
        logger.error(f"Error seeding OSM polygons: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "details": {"message": f"Failed to seed OSM polygons: {str(e)}"}
            }
        )


