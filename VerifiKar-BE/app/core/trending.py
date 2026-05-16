"""Trending algorithms for Discover overview.

One-time OSM administrative boundaries import (Pakistan):

    wget https://download.geofabrik.de/asia/pakistan-latest.osm.pbf
    osm2pgsql -d YOUR_DB_NAME -U YOUR_DB_USER --host localhost --port 5432 pakistan-latest.osm.pbf
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Cluster, ClusterStatusEnum

TOPICS_CACHE_KEY = "trending:topics"
LOCATIONS_CACHE_KEY = "trending:locations"
TRENDING_CACHE_TTL_SECONDS = 300

CATEGORY_META = {
    "fire": {"label": "Fire", "subtitle": "High activity", "emoji": "🔥", "colors": ["#F0997B", "#D85A30"]},
    "traffic": {"label": "Traffic", "subtitle": "Surge now", "emoji": "🚦", "colors": ["#FAC775", "#BA7517"]},
    "accident": {"label": "Accident", "subtitle": "Multiple zones", "emoji": "🚗", "colors": ["#85B7EB", "#185FA5"]},
    "crime": {"label": "Crime", "subtitle": "Verified", "emoji": "🚔", "colors": ["#AFA9EC", "#534AB7"]},
    "rescue": {"label": "Rescue", "subtitle": "Urgent", "emoji": "🚑", "colors": ["#5DCAA5", "#0F6E56"]},
    "protest": {"label": "Protest", "subtitle": "Ongoing", "emoji": "📢", "colors": ["#ED93B1", "#993556"]},
    "disaster": {"label": "Disaster", "subtitle": "Monitoring", "emoji": "🌊", "colors": ["#F7C1C1", "#A32D2D"]},
    "infra": {"label": "Infra", "subtitle": "Road damage", "emoji": "🏗️", "colors": ["#C0DD97", "#3B6D11"]},
    "outage": {"label": "Outage", "subtitle": "Service impact", "emoji": "⚡", "colors": ["#D3D1C7", "#5F5E5A"]},
    "weather": {"label": "Weather", "subtitle": "Storm alert", "emoji": "⛈️", "colors": ["#B5D4F4", "#378ADD"]},
}


def normalize_category_key(category: str | None) -> str:
    """Normalize category text into a stable key used by Discover UI metadata."""
    if not category:
        return "outage"

    value = category.lower()
    if "fire" in value:
        return "fire"
    if "traffic" in value:
        return "traffic"
    if "accident" in value or "crash" in value:
        return "accident"
    if "crime" in value or "robbery" in value or "theft" in value:
        return "crime"
    if "rescue" in value or "medical" in value or "aid" in value:
        return "rescue"
    if "protest" in value or "rally" in value:
        return "protest"
    if "flood" in value or "disaster" in value or "earthquake" in value:
        return "disaster"
    if "infra" in value or "road" in value or "construction" in value:
        return "infra"
    if "weather" in value or "rain" in value or "storm" in value:
        return "weather"
    if "outage" in value or "power" in value or "electric" in value:
        return "outage"
    return "outage"


def hot_score(report_count: int, avg_credibility: float, first_report_at: datetime) -> float:
    """Compute Reddit-style hot score for category ranking."""
    order = math.log10(max(report_count * avg_credibility, 1))
    epoch = datetime(1970, 1, 1, tzinfo=first_report_at.tzinfo) if first_report_at.tzinfo else datetime(1970, 1, 1)
    seconds_since_epoch = (first_report_at - epoch).total_seconds()
    return round(order + seconds_since_epoch / 45000, 7)


async def get_trending_topics(db: AsyncSession, limit: int = 10) -> list[dict]:
    """Return top trending categories from active clusters in the last 30 days.

    Steps:
    1. Pull active clusters from the last 30 days.
    2. Aggregate by normalized dominant category.
    3. Compute hot_score using summed reports, avg credibility, and earliest first_report_at.
    4. Return top categories formatted for Discover topics UI.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)

    query = (
        select(
            Cluster.dominant_category,
            func.sum(Cluster.report_count).label("total_reports"),
            func.avg(Cluster.avg_credibility).label("avg_credibility"),
            func.min(Cluster.first_report_at).label("earliest_first_report_at"),
        )
        .where(
            Cluster.status == ClusterStatusEnum.active,
            Cluster.last_report_at > cutoff,
            Cluster.dominant_category.is_not(None),
        )
        .group_by(Cluster.dominant_category)
    )

    result = await db.execute(query)

    ranked: list[dict] = []
    for row in result.all():
        category_key = normalize_category_key(row.dominant_category)
        meta = CATEGORY_META.get(category_key, CATEGORY_META["outage"])
        total_reports = int(row.total_reports or 0)
        avg_credibility = float(row.avg_credibility or 0.0)
        first_report_at = row.earliest_first_report_at
        if first_report_at is None:
            continue

        score = hot_score(total_reports, avg_credibility, first_report_at)
        ranked.append(
            {
                "score": score,
                "item": {
                    "key": category_key,
                    "name": meta["label"],
                    "subtitle": meta["subtitle"],
                    "reports": total_reports,
                    "emoji": meta["emoji"],
                    "colors": meta["colors"],
                },
            }
        )

    ranked.sort(key=lambda entry: entry["score"], reverse=True)
    return [entry["item"] for entry in ranked[:limit]]


def location_emoji_and_colors(categories: list[str], area_name: str) -> tuple[str, list[str], str]:
    """Map location categories to UI emoji/color/tag metadata."""
    normalized = [normalize_category_key(category) for category in categories if category]
    if not normalized:
        return "📍", ["#B5D4F4", "#0C447C"], "No active categories"

    first_key = normalized[0]
    first_meta = CATEGORY_META.get(first_key, CATEGORY_META["outage"])
    labels = [CATEGORY_META.get(key, CATEGORY_META["outage"])["label"] for key in normalized[:2]]
    tags = " · ".join(labels) if labels else "No active categories"
    return first_meta["emoji"], first_meta["colors"], tags


def build_trending_location_items(rows: list[dict]) -> list[dict]:
    """Convert raw SQL location rows into Discover location card schema."""
    items: list[dict] = []
    for row in rows:
        area_name = row.get("area_name") or "Unknown Area"
        categories = row.get("categories") or []
        emoji, colors, tags = location_emoji_and_colors(categories, area_name)
        items.append(
            {
                "name": area_name,
                "top_label": area_name.split(" (")[0],
                "emoji": emoji,
                "posts": int(row.get("total_reports") or 0),
                "tags": tags,
                "colors": colors,
            }
        )
    return items
