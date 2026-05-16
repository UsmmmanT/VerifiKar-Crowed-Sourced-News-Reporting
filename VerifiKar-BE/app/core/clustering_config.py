# --- Clustering Configuration ---

ASSIGNMENT_THRESHOLD = 0.65

# --- Fusion Score Weights (w_sem, w_med, w_geo, w_time) ---
WEIGHT_PROFILES = {
    "default": {"w_sem": 0.6, "w_med": 0.2, "w_geo": 0.1, "w_time": 0.1},
    
    "Fire": {"w_sem": 0.7, "w_med": 0.1, "w_geo": 0.1, "w_time": 0.1},
    "Accident": {"w_sem": 0.5, "w_med": 0.2, "w_geo": 0.2, "w_time": 0.1},
    
    # --- NEW TRAFFIC PROFILE ---
    # Location (w_geo) and Time (w_time) are most important.
    "Traffic": {"w_sem": 0.2, "w_med": 0.1, "w_geo": 0.5, "w_time": 0.2},
    
    "Crime": {"w_sem": 0.7, "w_med": 0.1, "w_geo": 0.1, "w_time": 0.1},
    "Protest": {"w_sem": 0.5, "w_med": 0.1, "w_geo": 0.2, "w_time": 0.2},
    "Disaster": {"w_sem": 0.4, "w_med": 0.2, "w_geo": 0.3, "w_time": 0.1},
    "Infrastructure": {"w_sem": 0.2, "w_med": 0.1, "w_geo": 0.6, "w_time": 0.1},
    "Outage": {"w_sem": 0.3, "w_med": 0.1, "w_geo": 0.5, "w_time": 0.1},
    "Health": {"w_sem": 0.6, "w_med": 0.1, "w_geo": 0.2, "w_time": 0.1},
    "Environment": {"w_sem": 0.5, "w_med": 0.2, "w_geo": 0.2, "w_time": 0.1},
    "Rescue": {"w_sem": 0.5, "w_med": 0.2, "w_geo": 0.2, "w_time": 0.1},
    "Weather": {"w_sem": 0.2, "w_med": 0.1, "w_geo": 0.4, "w_time": 0.3},
    "Politics": {"w_sem": 0.8, "w_med": 0.1, "w_geo": 0.0, "w_time": 0.1},
    "Social": {"w_sem": 0.8, "w_med": 0.1, "w_geo": 0.0, "w_time": 0.1},
    "Other": {"w_sem": 0.6, "w_med": 0.2, "w_geo": 0.1, "w_time": 0.1}
}

# --- Clustering Query Parameters ---
MATCHING_RADIUS_METERS = 2000
MATCHING_TIME_WINDOW_HOURS = 6

# --- Cluster Lifecycle Config ---
CLUSTER_TTLS_DAYS = {
    "default": 1.0,
    "Fire": 0.5,
    "Accident": 0.25,
    
    # --- NEW TRAFFIC TTL ---
    # A traffic jam is old news after 6 hours.
    "Traffic": 0.25, # 6 hours
    
    "Crime": 2.0,
    "Protest": 1.0,
    "Disaster": 5.0,
    "Infrastructure": 30.0,
    "Outage": 1.0,
    "Health": 7.0,
    "Environment": 7.0,
    "Rescue": 0.5,
    "Weather": 0.25,
    "Politics": 1.0,
    "Social": 2.0
}

# --- Post Generation Config ---
POST_THRESHOLDS = {
    "default": 0.15,
    
    # Urgent, fast-moving events. Post quickly.
    # A score of 2.5-3.0 means ~2-3 reports.
    "Fire": 0.15,
    "Accident": 0.15,
    "Crime": 0.15,
    "Rescue": 0.15, # Most urgent, post ASAP
    "Traffic": 0.15,
    
    # Slower-moving events. Wait for more confirmation.
    "Protest": 0.15,
    "Disaster": 0.15, # Needs significant confirmation
    "Outage": 0.15,
    "Health": 0.15,
    "Environment": 0.15,
    
    # Non-urgent. Wait for *lots* of reports.
    # A score of 10.0 might require 10+ reports.
    "Infrastructure": 0.15, 
    "Weather": 0.15,
    "Politics": 0.15,
    "Social": 0.15,
    "Other": 0.15
}


# --- NEW: MERGE-SPECIFIC CONFIG ---

# Similarity threshold for merging clusters (higher = more conservative)
# This is HIGHER than ASSIGNMENT_THRESHOLD because merging is irreversible
# and we want to be very confident that clusters are duplicates
MERGE_SIMILARITY_THRESHOLD = 0.75

# Time window for considering clusters as potential duplicates (in hours)
# This is LONGER than MATCHING_TIME_WINDOW_HOURS because we're looking
# retrospectively at clusters that may have been created at boundary times
MERGE_TIME_WINDOW_HOURS = 24

# Maximum distance for considering clusters as potential duplicates (in meters)
# This is LARGER than MATCHING_RADIUS_METERS to catch clusters created
# at geographic boundaries (e.g., one at 1999m, one at 2001m from event center)
MERGE_MAX_DISTANCE_METERS = 3000

# Allow cross-category merging (e.g., "Accident" + "Traffic" can merge)
# When True: Clusters with different categories CAN merge if similarity is high enough
# When False: Clusters must have same category to merge (strict separation)
# Example: An accident causing a traffic jam should merge even if categories differ
MERGE_ALLOW_CROSS_CATEGORY = True

# Why different from clustering config?
# - Clustering is real-time and strict (prevents false positives)
# - Merging is retrospective and catches boundary cases (fixes false negatives)
# - Clustering: conservative threshold, tight window, small radius
# - Merging: higher threshold, relaxed window, larger radius