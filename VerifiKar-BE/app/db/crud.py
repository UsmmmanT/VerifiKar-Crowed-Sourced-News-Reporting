# ==============================
# Standard Library Imports
# ==============================
import datetime
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID
from collections import defaultdict

# ==============================
# Third-Party Imports
# ==============================
import numpy as np
from geoalchemy2.shape import to_shape
from geoalchemy2.types import Geometry
from sqlalchemy import func, text, update, delete, or_, literal_column
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload, joinedload


# ==============================
# Application Imports
# ==============================
from app.core.clustering_config import MATCHING_RADIUS_METERS, MATCHING_TIME_WINDOW_HOURS
from app.core.security import get_password_hash
from app.db.models import (
    Cluster,
    ClusterStatusEnum,
    MediaTypeEnum,
    ProcessedMedia,
    ProcessedMediaStatusEnum,
    ProcessedReport,
    RawMedia,
    RawReport,
    ReportStatusEnum,
    User,
    Post,
    PostMedia,
    PostReportContributor,
    PostInteraction, 
    InteractionEnum,
    UserPreference
)
from app.schemas import ReportLocation, UserCreate
from app.services.embeddings import get_embedding, extract_search_intent


# --- User CRUD ---

async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    query = select(User).where(User.email == email.lower())
    result = await db.execute(query)
    return result.scalar_one_or_none()

async def get_user_by_id(db: AsyncSession, user_id: str) -> User | None:
    try:
        uuid_obj = UUID(user_id)
        query = select(User).where(User.id == uuid_obj)
        result = await db.execute(query)
        return result.scalar_one_or_none()
    except ValueError:
        return None

async def create_user(db: AsyncSession, user_in: UserCreate) -> User:
    hashed_password = get_password_hash(user_in.password)
    db_user = User(
        email=user_in.email.lower(),
        hashed_password=hashed_password
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user

async def update_user_password(db: AsyncSession, user: User, new_password: str) -> User:
    """Update a user's password hash."""
    user.hashed_password = get_password_hash(new_password)
    await db.commit()
    await db.refresh(user)
    return user

# --- Report CRUD ---

async def create_raw_report(
    db: AsyncSession,
    raw_text: str,
    location: ReportLocation,
    user: User | None = None
) -> RawReport:
    point_wkt = f"SRID=4326;POINT({location.lon} {location.lat})"
    db_report = RawReport(
        raw_text=raw_text,
        location=point_wkt,
        user_id=user.id if user else None,
    )
    db.add(db_report)
    await db.commit()
    await db.refresh(db_report)
    return db_report

async def create_raw_media(
    db: AsyncSession,
    raw_report_id: UUID,
    media_url: str,
    media_type: MediaTypeEnum
) -> RawMedia:
    db_media = RawMedia(
        raw_report_id=raw_report_id,
        storage_url=media_url,
        media_type=media_type
    )
    db.add(db_media)
    await db.commit()
    await db.refresh(db_media)
    return db_media

async def get_raw_report(db: AsyncSession, report_id: UUID) -> RawReport | None:
    query = select(RawReport).where(RawReport.id == report_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()

async def get_raw_media_by_report_id(db: AsyncSession, report_id: UUID) -> List[RawMedia]:
    query = select(RawMedia).where(RawMedia.raw_report_id == report_id)
    result = await db.execute(query)
    return result.scalars().all()

async def update_raw_report_status(
    db: AsyncSession, 
    report_id: UUID, 
    status: ReportStatusEnum
) -> RawReport | None:
    report = await get_raw_report(db, report_id=report_id)
    if report:
        report.status = status
        await db.commit()
        await db.refresh(report)
    return report

async def create_processed_report(
    db: AsyncSession,
    raw_report_id: UUID,
    user_id: UUID | None,
    location_wkt: str,
    report_created_at: datetime.datetime,
    credibility_score: float,
    cleaned_text: str | None,
    event_category: str | None,
    text_embedding: List[float] | None,
    avg_spam_score: float,
    avg_ai_media_score: float,
    consistency_score: float
) -> ProcessedReport:
    processed_report = ProcessedReport(
        raw_report_id=raw_report_id,
        user_id=user_id,
        location=location_wkt,
        report_created_at=report_created_at,
        credibility_score=credibility_score,
        cleaned_text=cleaned_text,
        event_category=event_category,
        text_embedding=text_embedding,
        avg_spam_score=avg_spam_score,
        avg_ai_media_score=avg_ai_media_score,
        consistency_score=consistency_score
    )
    db.add(processed_report)
    await db.commit()
    await db.refresh(processed_report)
    return processed_report

async def create_processed_media(
    db: AsyncSession,
    processed_report_id: UUID,
    raw_media_id: UUID,
    media_type: MediaTypeEnum,
    embedding: List[float] | None,
    spam_score: float,
    ai_score: float,
    status: ProcessedMediaStatusEnum
) -> ProcessedMedia:
    processed_media = ProcessedMedia(
        processed_report_id=processed_report_id,
        raw_media_id=raw_media_id,
        media_type=media_type,
        embedding=embedding,
        spam_score=spam_score,
        ai_score=ai_score,
        status=status
    )
    db.add(processed_media)
    await db.commit()
    await db.refresh(processed_media)
    return processed_media

# --- CLUSTERING PIPELINE FUNCTIONS (FINAL VERSION) ---

async def get_processed_report(db: AsyncSession, report_id: UUID) -> ProcessedReport | None:
    query = select(ProcessedReport).where(ProcessedReport.id == report_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()

async def get_processed_media_by_report_id(db: AsyncSession, processed_report_id: UUID) -> List[ProcessedMedia]:
    query = select(ProcessedMedia).where(ProcessedMedia.processed_report_id == processed_report_id)
    result = await db.execute(query)
    return result.scalars().all()


# --- USER PREFERENCE CRUD ---

async def get_user_all_preferences(
    db: AsyncSession,
    user_id: UUID
) -> List[UserPreference]:
    query = (
        select(UserPreference)
        .where(UserPreference.user_id == user_id)
        .order_by(UserPreference.preference_score.desc())
    )
    result = await db.execute(query)
    return result.scalars().all()


async def get_user_top_preferences(
    db: AsyncSession,
    user_id: UUID,
    limit: int = 20
) -> List[UserPreference]:
    query = (
        select(UserPreference)
        .where(UserPreference.user_id == user_id)
        .order_by(UserPreference.preference_score.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    return result.scalars().all()


async def create_or_update_user_preference(
    db: AsyncSession,
    user_id: UUID,
    category: str | None = None,
    location: str | None = None,
    preference_score: float = 0.0,
    last_interaction_at: datetime.datetime | None = None,
) -> UserPreference:
    conditions = [UserPreference.user_id == user_id]
    conditions.append(UserPreference.category.is_(None) if category is None else UserPreference.category == category)
    conditions.append(UserPreference.location.is_(None) if location is None else UserPreference.location == location)

    query = select(UserPreference).where(*conditions)
    result = await db.execute(query)
    preference = result.scalar_one_or_none()

    if preference is None:
        preference = UserPreference(
            user_id=user_id,
            category=category,
            location=location,
            preference_score=preference_score,
            last_interaction_at=last_interaction_at,
        )
        db.add(preference)
        return preference

    preference.preference_score = preference_score
    if last_interaction_at is not None:
        preference.last_interaction_at = last_interaction_at
    return preference

async def get_active_clusters_for_matching(
    db: AsyncSession,
    location_geom: Geometry,
    timestamp: datetime.datetime
) -> List[Tuple[Cluster, float]]:
    """
    Finds active clusters within the matching radius and time window.
    Returns a list of tuples: (cluster_object, distance_in_meters)
    """
    time_cutoff = timestamp - datetime.timedelta(hours=MATCHING_TIME_WINDOW_HOURS)
    
    distance_func = func.ST_Distance(
        Cluster.avg_location,
        location_geom,
        True
    ).label('distance')

    query = select(Cluster, distance_func).where(
        Cluster.status == ClusterStatusEnum.active,
        Cluster.last_report_at > time_cutoff,
        func.ST_DWithin(
            Cluster.avg_location,
            location_geom,
            MATCHING_RADIUS_METERS,
            True
        )
    ).order_by(distance_func)
    
    result = await db.execute(query)
    return result.all()

async def get_all_reports_for_cluster(db: AsyncSession, cluster_id: UUID) -> List[ProcessedReport]:
    query = select(ProcessedReport).where(ProcessedReport.cluster_id == cluster_id)
    result = await db.execute(query)
    return result.scalars().all()

async def create_new_cluster(
    db: AsyncSession,
    report: ProcessedReport,
    media_results: List[Dict[str, Any]]
) -> Cluster:
    image_embs = [
        res['embedding'] for res in media_results 
        if res['embedding'] is not None and res['media_type'] == MediaTypeEnum.image
    ]
    video_embs = [
        res['embedding'] for res in media_results
        if res['embedding'] is not None and res['media_type'] == MediaTypeEnum.video
    ]

    image_centroid = np.mean(image_embs, axis=0) if image_embs else None
    video_centroid = np.mean(video_embs, axis=0) if video_embs else None

    new_cluster = Cluster(
        text_centroid=report.text_embedding,
        image_centroid=image_centroid.tolist() if image_centroid is not None else None,
        video_centroid=video_centroid.tolist() if video_centroid is not None else None,
        avg_location=report.location,
        cluster_radius_meters=100.0,
        report_count=1,
        status=ClusterStatusEnum.active,
        first_report_at=report.report_created_at,
        last_report_at=report.report_created_at,
        dominant_category=report.event_category,
        avg_credibility=report.credibility_score
    )
    
    db.add(new_cluster)
    await db.commit()
    await db.refresh(new_cluster)
    return new_cluster

async def update_processed_report_cluster_id(
    db: AsyncSession,
    report_id: UUID,
    cluster_id: UUID
):
    stmt = (
        update(ProcessedReport)
        .where(ProcessedReport.id == report_id)
        .values(cluster_id=cluster_id)
    )
    await db.execute(stmt)
    await db.commit()

async def assign_report_to_cluster(
    db: AsyncSession,
    cluster: Cluster,
    report: ProcessedReport,
    media_results: List[Dict[str, Any]]
):
    old_count = cluster.report_count
    new_count = old_count + 1
    
    if report.text_embedding is not None:
        old_text_emb = np.array(cluster.text_centroid) if cluster.text_centroid is not None else np.zeros(512)
        new_text_emb = np.array(report.text_embedding)
        cluster.text_centroid = ((old_text_emb * old_count) + new_text_emb) / new_count

    new_image_embs = [
        res['embedding'] for res in media_results 
        if res['embedding'] is not None and res['media_type'] == MediaTypeEnum.image
    ]
    new_video_embs = [
        res['embedding'] for res in media_results
        if res['embedding'] is not None and res['media_type'] == MediaTypeEnum.video
    ]
    
    if new_image_embs:
        old_image_emb = np.array(cluster.image_centroid) if cluster.image_centroid is not None else np.zeros(512)
        avg_new_image_emb = np.mean(new_image_embs, axis=0)
        cluster.image_centroid = ((old_image_emb * old_count) + avg_new_image_emb) / new_count

    if new_video_embs:
        old_video_emb = np.array(cluster.video_centroid) if cluster.video_centroid is not None else np.zeros(512)
        avg_new_video_emb = np.mean(new_video_embs, axis=0)
        cluster.video_centroid = ((old_video_emb * old_count) + avg_new_video_emb) / new_count
    
    old_cred = cluster.avg_credibility or 0.0
    cluster.avg_credibility = ((old_cred * old_count) + report.credibility_score) / new_count
    
    cluster.report_count = new_count
    cluster.last_report_at = report.report_created_at
    cluster.updated_at = func.now()
    
    all_reports_in_cluster = await get_all_reports_for_cluster(db, cluster.id)
    all_reports_in_cluster.append(report)
    
    points = [to_shape(r.location) for r in all_reports_in_cluster]
    avg_lon = np.mean([p.x for p in points])
    avg_lat = np.mean([p.y for p in points])
    cluster.avg_location = f"SRID=4326;POINT({avg_lon} {avg_lat})"
    
    max_dist = 0.0
    avg_point_wkt = f"POINT({avg_lon} {avg_lat})"
    for r in all_reports_in_cluster:
        dist_query = select(func.ST_Distance(
            func.ST_GeomFromText(avg_point_wkt, 4326),
            r.location,
            True
        ))
        distance = (await db.execute(dist_query)).scalar_one_or_none()
        if distance and distance > max_dist:
            max_dist = distance
    cluster.cluster_radius_meters = max_dist + 100 

    categories = [r.event_category for r in all_reports_in_cluster if r.event_category]
    if categories:
        cluster.dominant_category = max(set(categories), key=categories.count)
    
    await db.commit()
    await db.refresh(cluster)
    return cluster


async def refresh_cluster_area_name_if_stale(
    db: AsyncSession,
    cluster_id: UUID,
    stale_after_days: int = 7,
) -> str | None:
    cluster = await db.get(Cluster, cluster_id)
    if not cluster:
        return None

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    stale_cutoff = now_utc - datetime.timedelta(days=stale_after_days)
    if cluster.area_name and cluster.area_name_updated_at and cluster.area_name_updated_at >= stale_cutoff:
        return cluster.area_name

    area_sql = text(
        """
        SELECT b.name
        FROM clusters c
        JOIN planet_osm_polygon b
          ON ST_Contains(b.way, ST_Transform(c.avg_location::geometry, 3857))
        WHERE c.id = :cluster_id
          AND b.boundary = 'administrative'
          AND b.admin_level IN ('8', '9', '10')
          AND b.name IS NOT NULL
        ORDER BY b.admin_level DESC
        LIMIT 1
        """
    )

    try:
        result = await db.execute(area_sql, {"cluster_id": cluster_id})
        area_name = result.scalar_one_or_none()
    except ProgrammingError as exc:
        orig = getattr(exc, "orig", None)
        if getattr(orig, "sqlstate", None) == "42P01":
            return None
        if "planet_osm_polygon" in str(exc).lower():
            return None
        raise

    cluster.area_name = area_name
    cluster.area_name_updated_at = now_utc
    await db.commit()
    await db.refresh(cluster)
    return cluster.area_name


async def get_trending_locations(db: AsyncSession, limit: int = 10) -> List[Dict[str, Any]]:
    query = text(
        """
        SELECT
            b.name AS area_name,
            COUNT(c.id) AS cluster_count,
            SUM(c.report_count) AS total_reports,
            AVG(c.avg_credibility) AS avg_cred,
            MAX(c.last_report_at) AS latest_activity,
            ST_Y(ST_Centroid(ST_Collect(c.avg_location::geometry))) AS lat,
            ST_X(ST_Centroid(ST_Collect(c.avg_location::geometry))) AS lon,
            array_agg(DISTINCT c.dominant_category) AS categories
        FROM clusters c
        JOIN planet_osm_polygon b
            ON ST_Contains(
                b.way,
                ST_Transform(c.avg_location::geometry, 3857)
            )
        WHERE c.status = 'active'
          AND c.last_report_at > NOW() - INTERVAL '24 hours'
          AND b.boundary = 'administrative'
          AND b.admin_level IN ('8', '9', '10')
          AND b.name IS NOT NULL
        GROUP BY b.name
        ORDER BY (SUM(c.report_count) * AVG(c.avg_credibility)) DESC
        LIMIT :limit
        """
    )

    try:
        result = await db.execute(query, {"limit": limit})
        rows = result.mappings().all()
    except ProgrammingError as exc:
        orig = getattr(exc, "orig", None)
        if getattr(orig, "sqlstate", None) == "42P01":
            return []
        if "planet_osm_polygon" in str(exc).lower():
            return []
        raise

    return [
        {
            "area_name": row["area_name"],
            "cluster_count": int(row["cluster_count"] or 0),
            "total_reports": int(row["total_reports"] or 0),
            "avg_cred": float(row["avg_cred"] or 0.0),
            "latest_activity": row["latest_activity"],
            "lat": float(row["lat"] or 0.0),
            "lon": float(row["lon"] or 0.0),
            "categories": [c for c in (row["categories"] or []) if c],
        }
        for row in rows
    ]


async def get_active_cluster_ids_by_area_name(
    db: AsyncSession,
    area_name: str,
    max_days_old: int = 30,
) -> List[UUID]:
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=max_days_old)
    query = (
        select(Cluster.id)
        .where(
            Cluster.status == ClusterStatusEnum.active,
            Cluster.last_report_at >= cutoff,
            Cluster.area_name.is_not(None),
            Cluster.area_name.ilike(area_name),
        )
    )
    result = await db.execute(query)
    return result.scalars().all()

async def get_clusters_with_unprocessed_reports(db: AsyncSession) -> List[UUID]:
    query = (
        select(ProcessedReport.cluster_id)
        .join(Cluster, ProcessedReport.cluster_id == Cluster.id)
        .where(
            ProcessedReport.post_id == None,
            ProcessedReport.cluster_id != None,
            Cluster.status == ClusterStatusEnum.active
        )
        .distinct()
    )
    result = await db.execute(query)
    return result.scalars().all()

async def get_unprocessed_reports_for_cluster(
    db: AsyncSession, 
    cluster_id: UUID
) -> List[ProcessedReport]:
    query = (
        select(ProcessedReport)
        .where(
            ProcessedReport.cluster_id == cluster_id,
            ProcessedReport.post_id == None
        )
        .order_by(ProcessedReport.report_created_at)
    )
    result = await db.execute(query)
    return result.scalars().all()

async def get_active_clusters_for_aging(db: AsyncSession) -> List[Cluster]:
    query = (
        select(Cluster)
        .where(Cluster.status == ClusterStatusEnum.active)
        .order_by(Cluster.last_report_at)
    )
    result = await db.execute(query)
    return result.scalars().all()

async def mark_clusters_inactive(
    db: AsyncSession, 
    cluster_ids: List[UUID]
) -> int:
    if not cluster_ids:
        return 0
    
    stmt = (
        update(Cluster)
        .where(Cluster.id.in_(cluster_ids))
        .values(status=ClusterStatusEnum.inactive)
    )
    result = await db.execute(stmt)
    await db.commit()
    
    return result.rowcount

async def get_active_clusters_with_centroids(db: AsyncSession) -> List[Cluster]:
    query = (
        select(Cluster)
        .where(
            Cluster.status == ClusterStatusEnum.active,
            Cluster.text_centroid.isnot(None)
        )
        .order_by(Cluster.first_report_at)
    )
    result = await db.execute(query)
    return result.scalars().all()

async def get_nearby_clusters(
    db: AsyncSession,
    cluster: Cluster,
    max_distance_meters: float
) -> List[Tuple[Cluster, float]]:
    location_wkt = cluster.avg_location
    
    query = (
        select(
            Cluster,
            func.ST_Distance(
                func.ST_Transform(Cluster.avg_location, 3857),
                func.ST_Transform(location_wkt, 3857)
            ).label('distance')
        )
        .where(
            Cluster.status == ClusterStatusEnum.active,
            Cluster.id != cluster.id,
            Cluster.text_centroid.isnot(None),
            Cluster.dominant_category == cluster.dominant_category,
            func.ST_DWithin(
                func.ST_Transform(Cluster.avg_location, 3857),
                func.ST_Transform(location_wkt, 3857),
                max_distance_meters
            )
        )
    )
    
    result = await db.execute(query)
    return result.all()

async def get_spatial_cluster_groups(
    db: AsyncSession,
    eps_meters: float,
    category: str = None
) -> List[List[Cluster]]:
    category_filter = ""
    params = {"eps": eps_meters}
    
    if category:
        category_filter = "AND dominant_category = :category"
        params["category"] = category
    
    query = text(f"""
        WITH clustered AS (
            SELECT 
                id,
                ST_ClusterDBSCAN(
                    ST_Transform(avg_location, 3857),
                    eps := :eps,
                    minpoints := 1
                ) OVER () as group_id
            FROM clusters
            WHERE status = 'active'
              AND text_centroid IS NOT NULL
              {category_filter}
        )
        SELECT 
            c.id,
            COALESCE(cl.group_id, -1) as group_id
        FROM clusters c
        JOIN clustered cl ON c.id = cl.id
        ORDER BY cl.group_id, c.first_report_at
    """)
    
    result = await db.execute(query, params)
    
    groups = defaultdict(list)
    for row in result:
        cluster = await db.get(Cluster, row.id)
        if cluster:
            group_id = row.group_id if row.group_id >= 0 else f"isolated_{row.id}"
            groups[group_id].append(cluster)
    
    return list(groups.values())

async def merge_clusters(
    db: AsyncSession,
    winner: Cluster,
    loser: Cluster,
    similarity_score: float,
    distance_meters: float
):
    print(f"Merging cluster {loser.id} into {winner.id}...")
    
    stmt = (
        update(ProcessedReport)
        .where(ProcessedReport.cluster_id == loser.id)
        .values(cluster_id=winner.id)
    )
    result = await db.execute(stmt)
    reports_moved = result.rowcount
    print(f"  Moved {reports_moved} reports from loser to winner")
    
    all_reports = await get_all_reports_for_cluster(db, winner.id)
    total_count = len(all_reports)
    
    if total_count == 0:
        print("  Warning: No reports found after merge!")
        return
    
    print(f"  Recalculating winner cluster properties from {total_count} reports...")
    
    text_embeddings = [np.array(r.text_embedding) for r in all_reports if r.text_embedding is not None]
    if text_embeddings:
        winner.text_centroid = np.mean(text_embeddings, axis=0).tolist()
    
    from app.db.models import ProcessedMedia
    media_query = select(ProcessedMedia).where(
        ProcessedMedia.processed_report_id.in_([r.id for r in all_reports])
    )
    all_media = (await db.execute(media_query)).scalars().all()
    
    image_embeddings = [np.array(m.embedding) for m in all_media 
                       if m.embedding is not None and m.media_type == MediaTypeEnum.image]
    video_embeddings = [np.array(m.embedding) for m in all_media 
                       if m.embedding is not None and m.media_type == MediaTypeEnum.video]
    
    if image_embeddings:
        winner.image_centroid = np.mean(image_embeddings, axis=0).tolist()
    if video_embeddings:
        winner.video_centroid = np.mean(video_embeddings, axis=0).tolist()
    
    from geoalchemy2.shape import to_shape
    points = [to_shape(r.location) for r in all_reports]
    avg_lon = np.mean([p.x for p in points])
    avg_lat = np.mean([p.y for p in points])
    winner.avg_location = f"SRID=4326;POINT({avg_lon} {avg_lat})"
    
    max_dist = 0.0
    avg_point_wkt = f"POINT({avg_lon} {avg_lat})"
    for r in all_reports:
        dist_query = select(func.ST_Distance(
            func.ST_GeomFromText(avg_point_wkt, 4326),
            r.location,
            True
        ))
        distance = (await db.execute(dist_query)).scalar_one_or_none()
        if distance and distance > max_dist:
            max_dist = distance
    winner.cluster_radius_meters = max_dist + 100
    
    categories = [r.event_category for r in all_reports if r.event_category]
    if categories:
        winner.dominant_category = max(set(categories), key=categories.count)
    
    credibilities = [r.credibility_score for r in all_reports]
    winner.avg_credibility = float(np.mean(credibilities)) if credibilities else 0.0
    
    report_times = [r.report_created_at for r in all_reports]
    winner.first_report_at = min(report_times)
    winner.last_report_at = max(report_times)
    
    winner.report_count = total_count
    winner.updated_at = func.now()
    
    loser.status = ClusterStatusEnum.merged
    loser.merged_into_id = winner.id
    
    await db.commit()
    
    time_diff_hours = abs((winner.first_report_at - loser.first_report_at).total_seconds()) / 3600
    print(f"✓ Merge complete: similarity={similarity_score:.4f}, distance={distance_meters:.0f}m, time_diff={time_diff_hours:.1f}h")


# ========================================
# --- TASK 5: POST GENERATION CRUD ---
# ========================================

async def create_post(
    db: AsyncSession,
    cluster: Cluster,
    summary: str,
    event_category: str
) -> Post:
    post_location = cluster.avg_location
    
    new_post = Post(
        content=summary,
        location=post_location,
        event_category=event_category,
        cluster_id=cluster.id,
        parent_post_id=cluster.last_post_id
    )
    db.add(new_post)
    await db.commit()
    await db.refresh(new_post)
    return new_post

async def get_best_media_for_batch(
    db: AsyncSession,
    report_ids: List[UUID],
    limit: Optional[int] = None
) -> List[ProcessedMedia]:
    from sqlalchemy import case
    
    media_quality = (1 - ProcessedMedia.ai_score) * (1 - ProcessedMedia.spam_score)
    ranking_score = (ProcessedReport.credibility_score * 0.7) + (media_quality * 0.3)
    
    query = (
        select(ProcessedMedia)
        .join(ProcessedReport)
        .where(
            ProcessedMedia.processed_report_id.in_(report_ids),
            ProcessedMedia.ai_score < 0.7,
            ProcessedMedia.spam_score < 0.7,
            ProcessedMedia.embedding != None
        )
        .order_by(ranking_score.desc())
    )
    
    if limit is not None:
        query = query.limit(limit)
    
    result = await db.execute(query)
    return result.scalars().all()

async def link_media_to_post(
    db: AsyncSession,
    post_id: UUID,
    media_items: List[ProcessedMedia]
):
    links = []
    for i, media in enumerate(media_items):
        links.append(
            PostMedia(
                post_id=post_id,
                processed_media_id=media.id,
                display_order=i
            )
        )
    db.add_all(links)
    await db.commit()

async def link_reports_to_post(
    db: AsyncSession,
    post_id: UUID,
    reports: List[ProcessedReport]
):
    total_credibility = sum(r.credibility_score for r in reports)
    if total_credibility == 0:
        total_credibility = 1.0
        
    links = []
    for report in reports:
        contribution_score = report.credibility_score / total_credibility
        links.append(
            PostReportContributor(
                post_id=post_id,
                report_id=report.id,
                contribution_score=contribution_score
            )
        )
    db.add_all(links)
    await db.commit()

async def mark_reports_as_posted(
    db: AsyncSession,
    post_id: UUID,
    report_ids: List[UUID]
):
    stmt = (
        update(ProcessedReport)
        .where(ProcessedReport.id.in_(report_ids))
        .values(post_id=post_id)
    )
    await db.execute(stmt)
    await db.commit()

async def add_contributors_to_existing_post(
    db: AsyncSession,
    post_id: UUID,
    new_reports: List[ProcessedReport]
) -> Post:
    existing_contributors_query = (
        select(PostReportContributor)
        .where(PostReportContributor.post_id == post_id)
    )
    existing_contributors = (await db.execute(existing_contributors_query)).scalars().all()
    
    existing_report_ids = [c.report_id for c in existing_contributors]
    existing_reports_query = (
        select(ProcessedReport)
        .where(ProcessedReport.id.in_(existing_report_ids))
    )
    existing_reports = (await db.execute(existing_reports_query)).scalars().all()
    
    all_reports = list(existing_reports) + new_reports
    
    delete_stmt = (
        delete(PostReportContributor)
        .where(PostReportContributor.post_id == post_id)
    )
    await db.execute(delete_stmt)
    await db.commit()
    
    total_credibility = sum(r.credibility_score for r in all_reports)
    if total_credibility == 0:
        total_credibility = 1.0
    
    new_contributor_links = []
    for report in all_reports:
        contribution_score = report.credibility_score / total_credibility
        new_contributor_links.append(
            PostReportContributor(
                post_id=post_id,
                report_id=report.id,
                contribution_score=contribution_score
            )
        )
    db.add_all(new_contributor_links)
    await db.commit()
    
    new_credibility = float(np.mean([r.credibility_score for r in all_reports]))
    post_update_stmt = (
        update(Post)
        .where(Post.id == post_id)
        .values(credibility_score=new_credibility)
    )
    await db.execute(post_update_stmt)
    await db.commit()
    
    new_report_ids = [r.id for r in new_reports]
    await mark_reports_as_posted(db, post_id, new_report_ids)
    
    best_new_media = await get_best_media_for_batch(db, new_report_ids)
    if best_new_media:
        max_order_query = (
            select(func.max(PostMedia.display_order))
            .where(PostMedia.post_id == post_id)
        )
        max_order_result = await db.execute(max_order_query)
        max_order = max_order_result.scalar() or -1
        
        new_media_links = []
        for i, media in enumerate(best_new_media):
            existing_link_query = (
                select(PostMedia)
                .where(
                    PostMedia.post_id == post_id,
                    PostMedia.processed_media_id == media.id
                )
            )
            existing_link = (await db.execute(existing_link_query)).scalar_one_or_none()
            
            if not existing_link:
                new_media_links.append(
                    PostMedia(
                        post_id=post_id,
                        processed_media_id=media.id,
                        display_order=max_order + 1 + i
                    )
                )
        
        if new_media_links:
            db.add_all(new_media_links)
            await db.commit()
    
    post = await db.get(Post, post_id)
    await db.refresh(post)
    return post

async def update_cluster_last_post(
    db: AsyncSession,
    cluster_id: UUID,
    post_id: UUID
):
    stmt = (
        update(Cluster)
        .where(Cluster.id == cluster_id)
        .values(last_post_id=post_id, updated_at=func.now())
    )
    await db.execute(stmt)
    await db.commit()

# ---------------------------------------------------------------
# --- POSTS FEED API ---
# ---------------------------------------------------------------

async def get_feed_posts(
    db: AsyncSession,
    lat: float,
    lon: float,
    radius_km: float = 10,
    max_days_old: int = 7,
    category: str | None = None,
    search: str | None = None,
    global_search: bool = False,
    min_credibility: float | None = None,
    skip: int = 0,
    limit: int = 20
) -> List[Post]:
    """
    Two-query feed with full intent-aware semantic search.

    When a search term is provided, Groq llama3 extracts:
      - keywords   → used for embedding + full-text rank
      - time_days  → overrides max_days_old if stricter
      - category   → used as a case-insensitive soft filter
      - location   → geocoded to lat/lon via Nominatim, used as a
                     proximity boost in the relevance score

    Relevance formula (with embedding + location):
        0.30 * text_rank
      + 0.30 * semantic_similarity   (pgvector cosine)
      + 0.20 * location_proximity    (1 / (1 + dist_km))
      + 0.10 * credibility_score
      + 0.10 * recency_boost

    Relevance formula (embedding only, no location):
        0.35 * text_rank
      + 0.35 * semantic_similarity
      + 0.20 * credibility_score
      + 0.10 * recency_boost

    Fallback (no embedding):
        0.50 * text_rank
      + 0.30 * credibility_score
      + 0.20 * recency_boost
    """
    KARACHI_DEFAULT_LAT = 24.8607
    KARACHI_DEFAULT_LON = 67.0099
    is_default_location = (lat == KARACHI_DEFAULT_LAT and lon == KARACHI_DEFAULT_LON)

    user_location_wkt = f"SRID=4326;POINT({lon} {lat})"
    radius_meters = radius_km * 1000
    time_cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=max_days_old)

    distance_func = func.ST_Distance(
        Post.location,
        func.ST_GeomFromText(user_location_wkt, 4326),
        True
    ).label('distance')

    upvote_count_sub = (
        select(func.count(PostInteraction.id))
        .where(
            PostInteraction.post_id == Post.id,
            PostInteraction.interaction_type == InteractionEnum.upvote
        )
        .correlate_except(PostInteraction)
        .scalar_subquery()
        .label("upvotes")
    )
    downvote_count_sub = (
        select(func.count(PostInteraction.id))
        .where(
            PostInteraction.post_id == Post.id,
            PostInteraction.interaction_type == InteractionEnum.downvote
        )
        .correlate_except(PostInteraction)
        .scalar_subquery()
        .label("downvotes")
    )

    search_term = search.strip() if search else ""
    search_active = bool(search_term)

    # ----------------------------------------------------------------
    # SEMANTIC SEARCH: intent extraction via Groq
    # ----------------------------------------------------------------
    query_embedding = None
    semantic_time_filter = None
    intent_location_wkt = None
    intent_category = None

    if search_active:
        try:
            intent = await extract_search_intent(search_term)

            keywords = intent.get("keywords", [search_term])
            semantic_time_filter = intent.get("time_days", None)
            intent_category = intent.get("category", None)

            location_coords = intent.get("location_coords")
            if location_coords:
                intent_location_wkt = (
                    f"SRID=4326;POINT({location_coords['lon']} {location_coords['lat']})"
                )

            keyword_text = " ".join(keywords) if keywords else search_term
            query_embedding = await get_embedding(keyword_text)

        except Exception as e:
            print(f"Warning: Semantic search preparation failed: {e}")
            query_embedding = None
            semantic_time_filter = None
            intent_location_wkt = None
            intent_category = None
    # ----------------------------------------------------------------
    # END SEMANTIC SEARCH
    # ----------------------------------------------------------------

    # Base filters
    base_filters = [
        Post.status == 'active',
        Post.created_at >= time_cutoff,
    ]

    # Apply intent time filter (use whichever is stricter)
    if search_active and semantic_time_filter is not None:
        try:
            intent_time_cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
                days=int(semantic_time_filter)
            )
            if intent_time_cutoff > time_cutoff:
                base_filters[1] = Post.created_at >= intent_time_cutoff
        except Exception:
            pass

    if not global_search:
        base_filters.append(
            func.ST_DWithin(
                Post.location,
                func.ST_GeomFromText(user_location_wkt, 4326),
                radius_meters,
                True
            )
        )

    # Build relevance score expression (search mode only)
    if search_active:
        tsvector_expr = func.setweight(
            func.to_tsvector("english", func.coalesce(Post.content, "")),
            literal_column("'A'::\"char\""),
        ).op("||")(
            func.setweight(
                func.to_tsvector("english", func.coalesce(Post.event_category, "")),
                literal_column("'B'::\"char\""),
            )
        )
        tsquery_expr = func.plainto_tsquery("english", search_term)
        text_rank = func.ts_rank(tsvector_expr, tsquery_expr)
        recency_boost = (
            1.0 / (1.0 + func.extract("epoch", func.now() - Post.created_at) / 86400.0)
        )

        if query_embedding is not None and intent_location_wkt is not None:
            vector_literal = f"'[{','.join(str(x) for x in query_embedding)}]'::vector"
            semantic_sim = literal_column(
                f"(1.0 - (posts.embedding <-> {vector_literal}))"
            )
            location_distance_m = func.ST_Distance(
                Post.location,
                func.ST_GeomFromText(intent_location_wkt, 4326),
                True
            )
            location_proximity = 1.0 / (1.0 + location_distance_m / 1000.0)

            relevance_score = (
                (text_rank               * 0.30) +
                (semantic_sim            * 0.30) +
                (location_proximity      * 0.20) +
                (Post.credibility_score  * 0.10) +
                (recency_boost           * 0.10)
            ).label("relevance_score")

        elif query_embedding is not None:
            vector_literal = f"'[{','.join(str(x) for x in query_embedding)}]'::vector"
            semantic_sim = literal_column(
                f"(1.0 - (posts.embedding <-> {vector_literal}))"
            )
            relevance_score = (
                (text_rank               * 0.35) +
                (semantic_sim            * 0.35) +
                (Post.credibility_score  * 0.20) +
                (recency_boost           * 0.10)
            ).label("relevance_score")

        else:
            # Fallback: no embedding available
            relevance_score = (
                (text_rank               * 0.50) +
                (Post.credibility_score  * 0.30) +
                (recency_boost           * 0.20)
            ).label("relevance_score")

        query = select(
            Post,
            distance_func,
            upvote_count_sub,
            downvote_count_sub,
            relevance_score,
        ).where(*base_filters)

    else:
        query = select(Post, distance_func, upvote_count_sub, downvote_count_sub).where(*base_filters)

    # ── Category filter ──
    # explicit category param (from URL) takes priority over intent-extracted category.
    # When search is active, use case-insensitive LIKE so "fire" matches "Fire", "FIRE" etc.
    # When search is NOT active (browse by category), use exact match.
    if category:
        # Explicit filter from URL param — always apply, case-insensitive
        query = query.where(func.lower(Post.event_category) == category.lower())
    elif intent_category and search_active:
        # Intent-extracted category — already mapped to DB values in embeddings.py
        # Only apply filter if the mapped category exists in our known DB categories,
        # otherwise skip and let relevance score rank results.
        DB_CATEGORIES = ['accident', 'disaster', 'education', 'fire', 'other', 'protest', 'traffic', 'traffic accident']
        if intent_category.lower() in DB_CATEGORIES:
            query = query.where(
                func.lower(Post.event_category) == intent_category.lower()
            )
        # else: unknown category — skip filter, let semantic ranking surface results

    # ── Keyword fallback filter ──
    # Only when semantic search is completely unavailable (Ollama down).
    # Use OR so partial matches still show instead of returning nothing.
    if search_active and query_embedding is None:
        query = query.where(
            or_(
                tsvector_expr.op("@@")(tsquery_expr),
                func.lower(Post.content).contains(search_term.lower()),
                func.lower(Post.event_category).contains(search_term.lower()),
            )
        )

    if min_credibility:
        query = query.where(Post.credibility_score >= min_credibility)

    # ── Ordering ──
    if search_active:
        query = query.order_by(text("relevance_score DESC"))
    elif global_search:
        query = query.order_by(Post.created_at.desc())
    elif is_default_location:
        query = query.order_by(Post.created_at.desc())
    else:
        query = query.order_by(Post.created_at.desc(), distance_func)

    query = query.offset(skip).limit(limit)

    result = await db.execute(query)

    posts = []
    post_ids = []
    for row in result.all():
        if search_active:
            post, distance, upvotes, downvotes, _ = row
        else:
            post, distance, upvotes, downvotes = row
        post.upvotes = upvotes
        post.downvotes = downvotes
        posts.append(post)
        post_ids.append(post.id)

    # Query 2: Fetch media (top 3 per post via window function)
    if post_ids:
        media_query = text("""
            SELECT post_id, media_type, storage_url
            FROM (
                SELECT 
                    pm.post_id,
                    pmed.media_type,
                    rm.storage_url,
                    ROW_NUMBER() OVER (
                        PARTITION BY pm.post_id 
                        ORDER BY pm.display_order
                    ) as row_num
                FROM post_media pm
                JOIN processed_media pmed ON pm.processed_media_id = pmed.id
                JOIN raw_media rm ON pmed.raw_media_id = rm.id
                WHERE pm.post_id = ANY(:post_ids)
            ) ranked
            WHERE row_num <= 3
            ORDER BY post_id, row_num
        """)

        media_result = await db.execute(media_query, {"post_ids": post_ids})

        media_by_post = {}
        for row in media_result.all():
            post_id = row.post_id
            if post_id not in media_by_post:
                media_by_post[post_id] = []
            media_by_post[post_id].append({
                'media_type': row.media_type,
                'storage_url': row.storage_url
            })

        for post in posts:
            post.media_urls = media_by_post.get(post.id, [])

    return posts


async def get_post_with_details(db: AsyncSession, post_id: UUID) -> Post | None:
    upvote_count_sub = (
        select(func.count(PostInteraction.id))
        .where(
            PostInteraction.post_id == Post.id,
            PostInteraction.interaction_type == InteractionEnum.upvote
        )
        .correlate_except(PostInteraction)
        .scalar_subquery()
        .label("upvotes")
    )
    downvote_count_sub = (
        select(func.count(PostInteraction.id))
        .where(
            PostInteraction.post_id == Post.id,
            PostInteraction.interaction_type == InteractionEnum.downvote
        )
        .correlate_except(PostInteraction)
        .scalar_subquery()
        .label("downvotes")
    )

    query = (
        select(Post, upvote_count_sub, downvote_count_sub)
        .where(Post.id == post_id)
        .options(
            selectinload(Post.replies),
            selectinload(Post.parent_post),
            selectinload(Post.contributors)
                .joinedload(PostReportContributor.report)
        )
    )

    result = await db.execute(query)
    row = result.one_or_none()
    if not row:
        return None

    post, upvotes, downvotes = row
    post.upvotes = upvotes
    post.downvotes = downvotes

    post_ids_for_media = [post.id]
    if post.parent_post:
        post_ids_for_media.append(post.parent_post.id)
    if post.replies:
        post_ids_for_media.extend([reply.id for reply in post.replies])

    if post_ids_for_media:
        media_query = text("""
            SELECT 
                pm.post_id,
                pmed.media_type,
                rm.storage_url,
                pm.display_order
            FROM post_media pm
            JOIN processed_media pmed ON pm.processed_media_id = pmed.id
            JOIN raw_media rm ON pmed.raw_media_id = rm.id
            WHERE pm.post_id = ANY(:post_ids)
            ORDER BY pm.post_id, pm.display_order
        """)

        media_result = await db.execute(media_query, {"post_ids": post_ids_for_media})

        media_by_post = {}
        for row in media_result.all():
            p_id = row.post_id
            if p_id not in media_by_post:
                media_by_post[p_id] = []
            media_by_post[p_id].append({
                'media_type': row.media_type,
                'storage_url': row.storage_url
            })

        post.media_urls = media_by_post.get(post.id, [])
        if post.parent_post:
            post.parent_post.media_urls = media_by_post.get(post.parent_post.id, [])
        if post.replies:
            for reply in post.replies:
                reply.media_urls = media_by_post.get(reply.id, [])

    return post


# --- POST INTERACTION FUNCTIONS ---

async def get_user_post_interaction(
    db: AsyncSession,
    post_id: UUID,
    user_id: UUID
) -> PostInteraction | None:
    query = select(PostInteraction).where(
        PostInteraction.post_id == post_id,
        PostInteraction.user_id == user_id
    )
    result = await db.execute(query)
    return result.scalar_one_or_none()

async def create_or_update_post_interaction(
    db: AsyncSession,
    post_id: UUID,
    user_id: UUID,
    interaction_type: InteractionEnum
) -> tuple[PostInteraction | None, bool, InteractionEnum | None]:
    existing = await get_user_post_interaction(db, post_id, user_id)

    if existing:
        old_type = existing.interaction_type

        if existing.interaction_type == interaction_type:
            await db.delete(existing)
            await db.commit()
            return (None, False, old_type)
        else:
            existing.interaction_type = interaction_type
            await db.commit()
            await db.refresh(existing)
            return (existing, False, old_type)
    else:
        new_interaction = PostInteraction(
            post_id=post_id,
            user_id=user_id,
            interaction_type=interaction_type
        )
        db.add(new_interaction)
        await db.commit()
        await db.refresh(new_interaction)
        return (new_interaction, True, None)

async def get_post_interaction_counts(
    db: AsyncSession,
    post_id: UUID
) -> dict:
    query = select(
        PostInteraction.interaction_type,
        func.count(PostInteraction.id).label('count')
    ).where(
        PostInteraction.post_id == post_id
    ).group_by(
        PostInteraction.interaction_type
    )

    result = await db.execute(query)
    rows = result.all()

    counts = {'upvotes': 0, 'downvotes': 0, 'flags': 0}
    for row in rows:
        if row[0] == InteractionEnum.upvote:
            counts['upvotes'] = row[1]
        elif row[0] == InteractionEnum.downvote:
            counts['downvotes'] = row[1]
        elif row[0] == InteractionEnum.flag:
            counts['flags'] = row[1]

    return counts

async def get_post_contributors(
    db: AsyncSession,
    post_id: UUID
) -> List[PostReportContributor]:
    query = (
        select(PostReportContributor)
        .where(PostReportContributor.post_id == post_id)
        .options(joinedload(PostReportContributor.report))
    )
    result = await db.execute(query)
    return result.scalars().all()

async def update_user_reputation(
    db: AsyncSession,
    user_id: UUID,
    delta: float
):
    user = await get_user_by_id(db, str(user_id))
    if user:
        new_rep = user.reputation_score + delta
        user.reputation_score = max(0.0, min(1.0, new_rep))
        await db.commit()
        print(f"Updated user {user_id} reputation: {user.reputation_score:.4f} (delta: {delta:+.4f})")

async def get_users_by_ids(
    db: AsyncSession,
    user_ids: List[UUID]
) -> List[User]:
    query = select(User).where(User.id.in_(user_ids))
    result = await db.execute(query)
    return result.scalars().all()


async def get_user_submissions(
    db: AsyncSession,
    user_id: UUID,
    limit: int = 50,
) -> List[RawReport]:
    query = (
        select(RawReport)
        .where(
            RawReport.user_id == user_id,
            RawReport.is_deleted == False,
        )
        .order_by(RawReport.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    return result.scalars().all()


async def get_user_approved_posts(
    db: AsyncSession,
    user_id: UUID,
    limit: int = 50,
) -> List[Post]:
    query = (
        select(Post)
        .join(PostReportContributor, PostReportContributor.post_id == Post.id)
        .join(ProcessedReport, ProcessedReport.id == PostReportContributor.report_id)
        .join(RawReport, RawReport.id == ProcessedReport.raw_report_id)
        .where(
            or_(ProcessedReport.user_id == user_id, RawReport.user_id == user_id),
            Post.is_deleted == False,
            Post.status == 'active',
        )
        .order_by(Post.created_at.desc())
        .distinct()
        .limit(limit)
    )
    result = await db.execute(query)
    return result.scalars().all()

async def recalculate_post_credibility(
    db: AsyncSession,
    post_id: UUID
):
    post = await db.get(Post, post_id)
    if not post:
        return

    contributors = await get_post_contributors(db, post_id)
    user_ids = [c.report.user_id for c in contributors if c.report and c.report.user_id]

    if not user_ids:
        return

    users = await get_users_by_ids(db, user_ids)
    avg_reputation = float(np.mean([u.reputation_score for u in users])) if users else 0.5

    consistency_scores = [c.report.consistency_score for c in contributors
                         if c.report and c.report.consistency_score is not None]
    avg_consistency = float(np.mean(consistency_scores)) if consistency_scores else 0.5

    counts = await get_post_interaction_counts(db, post_id)
    total_votes = counts['upvotes'] + counts['downvotes']

    if total_votes > 0:
        vote_ratio = counts['upvotes'] / total_votes
    else:
        vote_ratio = 0.5

    new_credibility = (
        avg_reputation * 0.4 +
        vote_ratio * 0.3 +
        avg_consistency * 0.3
    )

    total_interactions = total_votes + counts['flags']
    if total_interactions > 0:
        flag_ratio = counts['flags'] / total_interactions
        flag_penalty = min(0.3, flag_ratio * 0.5)
        new_credibility *= (1.0 - flag_penalty)

    post.credibility_score = max(0.0, min(1.0, new_credibility))
    await db.commit()
    print(f"Updated post {post_id} credibility: {post.credibility_score:.4f}")