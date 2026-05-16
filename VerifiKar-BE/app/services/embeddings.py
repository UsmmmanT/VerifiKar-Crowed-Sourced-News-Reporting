import json
import logging
import os
import time
from typing import Any

import httpx
from groq import AsyncGroq

logger = logging.getLogger(__name__)

_INTENT_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_EMBEDDING_CACHE: dict[str, tuple[float, list[float]]] = {}
_CACHE_TTL_SECONDS = 120


def _get_cached(cache: dict, key: str):
    cached = cache.get(key)
    if not cached:
        return None
    expires_at, value = cached
    if time.time() > expires_at:
        cache.pop(key, None)
        return None
    return value


def _set_cached(cache: dict, key: str, value):
    cache[key] = (time.time() + _CACHE_TTL_SECONDS, value)


async def get_embedding(text: str) -> list[float] | None:
    """Fetch an embedding vector for the provided text via Ollama nomic-embed-text."""
    payload = {"model": "nomic-embed-text", "prompt": text}
    cache_key = text.strip().lower()
    cached = _get_cached(_EMBEDDING_CACHE, cache_key)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "http://localhost:11434/api/embeddings",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            embedding = data.get("embedding")
            if embedding is not None:
                _set_cached(_EMBEDDING_CACHE, cache_key, embedding)
            return embedding
    except Exception as exc:
        logger.error("Embedding request failed: %s", exc)
        return None


async def geocode_location(location_name: str) -> dict[str, float] | None:
    """
    Convert a location name to lat/lng using Nominatim (OpenStreetMap).
    Free, no API key required. Returns {"lat": float, "lon": float} or None.
    """
    if not location_name:
        return None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": location_name,
                    "format": "json",
                    "limit": 1,
                    "countrycodes": "pk",
                },
                headers={"User-Agent": "VerifiKar/1.0"},
            )
            response.raise_for_status()
            results = response.json()
            if results:
                return {
                    "lat": float(results[0]["lat"]),
                    "lon": float(results[0]["lon"]),
                }
    except Exception as exc:
        logger.warning("Geocoding failed for '%s': %s", location_name, exc)

    return None


async def extract_search_intent(query: str) -> dict[str, Any]:
    """
    Extract structured search intent from a natural language query using
    Groq (llama-3.1-8b-instant) — free tier, ~100ms.

    Returns a dict with:
        keywords       : list[str]
        category       : str | None  — mapped to DB category values
        time_days      : int | None
        location       : str | None
        location_coords: {lat, lon} | None
    """
    system_prompt = (
        "You are a search intent parser for a local news/incident reporting app in Karachi, Pakistan. "
        "Extract structured information from the user's search query.\n\n"
        "Return ONLY a valid JSON object — no explanation, no markdown, no extra text.\n\n"
        "JSON fields:\n"
        "  keywords      : array of strings — the core search terms, max 5, "
        "exclude stop words and time/location phrases\n"
        "  category      : string or null — the event type if mentioned "
        "(e.g. fire, flood, accident, crime, protest, power outage, gas leak, robbery)\n"
        "  time_days     : integer or null — how many days back to search "
        "(e.g. 'last 14 days' → 14, 'past week' → 7, 'today' → 1, 'last month' → 30)\n"
        "  location      : string or null — the specific place name mentioned in the query, "
        "exactly as written (e.g. 'Gulistan-e-Jauhar', 'North Nazimabad', 'DHA Phase 6')\n\n"
        "Examples:\n"
        "  'fire in gulistan e jauhar for last 14 days' → "
        '{"keywords":["fire"],"category":"fire","time_days":14,"location":"Gulistan-e-Jauhar"}\n'
        "  'road accident near clifton bridge' → "
        '{"keywords":["road","accident","clifton bridge"],"category":"accident","time_days":null,"location":"Clifton Bridge"}\n'
        "  'robbery incidents this week DHA' → "
        '{"keywords":["robbery"],"category":"crime","time_days":7,"location":"DHA"}\n'
        "  'flooding karachi past 3 days' → "
        '{"keywords":["flooding","karachi"],"category":"flood","time_days":3,"location":"Karachi"}\n'
    )

    try:
        cache_key = query.strip().lower()
        cached = _get_cached(_INTENT_CACHE, cache_key)
        if cached is not None:
            return cached

        groq_client = AsyncGroq(api_key=os.environ["GROQ_API_KEY"])

        response = await groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": query},
            ],
            temperature=0,
            max_tokens=200,
        )

        content = response.choices[0].message.content.strip()

        # Strip markdown fences if present
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]

        intent = json.loads(content.strip())

        # Geocode the extracted location name (if any)
        location_name = intent.get("location")
        if location_name:
            coords = await geocode_location(location_name)
            intent["location_coords"] = coords
        else:
            intent["location_coords"] = None

        # Ensure all expected keys are present (safe defaults)
        intent.setdefault("keywords", [query])
        intent.setdefault("category", None)
        intent.setdefault("time_days", None)
        intent.setdefault("location", None)

        # Map Groq-extracted categories to actual DB categories
        # DB has: Accident, Disaster, Education, Fire, Other, Protest, Traffic, Traffic Accident
        CATEGORY_MAP = {
            "flood":            "Disaster",
            "flooding":         "Disaster",
            "earthquake":       "Disaster",
            "storm":            "Disaster",
            "natural disaster": "Disaster",
            "cyclone":          "Disaster",
            "landslide":        "Disaster",
            "fire":             "Fire",
            "wildfire":         "Fire",
            "blaze":            "Fire",
            "accident":         "Accident",
            "car accident":     "Accident",
            "road accident":    "Accident",
            "crash":            "Accident",
            "collision":        "Accident",
            "traffic":          "Traffic",
            "traffic jam":      "Traffic",
            "congestion":       "Traffic",
            "traffic accident": "Traffic Accident",
            "protest":          "Protest",
            "demonstration":    "Protest",
            "rally":            "Protest",
            "robbery":          "Other",
            "crime":            "Other",
            "power outage":     "Other",
            "gas leak":         "Other",
            "education":        "Education",
        }
        raw_category = intent.get("category")
        if raw_category:
            intent["category"] = CATEGORY_MAP.get(raw_category.lower(), raw_category)

        logger.info(
            "Intent extracted for '%s': keywords=%s category=%s time_days=%s location=%s coords=%s",
            query,
            intent["keywords"],
            intent["category"],
            intent["time_days"],
            intent["location"],
            intent["location_coords"],
        )
        _set_cached(_INTENT_CACHE, cache_key, intent)
        return intent

    except Exception as exc:
        logger.error("Intent extraction failed for '%s': %s", query, exc)
        return {
            "keywords": [query],
            "category": None,
            "time_days": None,
            "location": None,
            "location_coords": None,
        }