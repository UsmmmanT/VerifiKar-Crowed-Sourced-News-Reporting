import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import polyline from "@mapbox/polyline";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

import { API_BASE_URL, OSM_TILES_URL } from "../../config";
import { useTheme } from "../../styles/ThemeContext";

const ROUTE_PROXIMITY_METERS = 1500;
const ON_ROUTE_METERS = 100;
const OSM_SEARCH_LIMIT = 6;
const FEED_FETCH_TIMEOUT_MS = 8000;

const DEFAULT_REGION = {
  latitude: 24.8607,
  longitude: 67.0011,
  zoom: 12,
};

function haversineDistanceMeters(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toLocalXYMeters(coord, referenceLatitude) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000;
  const refLatRad = toRad(referenceLatitude);
  return {
    x: R * toRad(coord.longitude) * Math.cos(refLatRad),
    y: R * toRad(coord.latitude),
  };
}

function pointToSegmentDistanceMeters(point, a, b) {
  const refLat = point.latitude;
  const p = toLocalXYMeters(point, refLat);
  const p1 = toLocalXYMeters(a, refLat);
  const p2 = toLocalXYMeters(b, refLat);

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    const distX = p.x - p1.x;
    const distY = p.y - p1.y;
    return Math.sqrt(distX * distX + distY * distY);
  }

  let t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const projX = p1.x + t * dx;
  const projY = p1.y + t * dy;
  const distX = p.x - projX;
  const distY = p.y - projY;

  return Math.sqrt(distX * distX + distY * distY);
}

function getPointToRouteMinDistanceMeters(point, routePoints) {
  if (!Array.isArray(routePoints) || routePoints.length === 0) return Infinity;
  if (routePoints.length === 1)
    return haversineDistanceMeters(point, routePoints[0]);

  let min = Infinity;
  for (let i = 0; i < routePoints.length - 1; i += 1) {
    const d = pointToSegmentDistanceMeters(
      point,
      routePoints[i],
      routePoints[i + 1],
    );
    if (d < min) min = d;
  }
  return min;
}

function parsePostCoordinate(post) {
  const geoCoordinates = post?.location?.coordinates;
  if (Array.isArray(geoCoordinates) && geoCoordinates.length >= 2) {
    const lng = Number(geoCoordinates[0]);
    const lat = Number(geoCoordinates[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }
  }

  const possible = [
    post?.location,
    post?.coordinates,
    post?.geo,
    { lat: post?.lat, lng: post?.lng },
    { lat: post?.latitude, lng: post?.longitude },
    { lat: post?.location_lat, lng: post?.location_lng },
    { lat: post?.location_lat, lng: post?.location_lon },
    { lat: post?.location_lat, lng: post?.location_long },
    { lat: post?.location_latitude, lng: post?.location_longitude },
    { lat: post?.location_latitude, lng: post?.location_lon },
    { lat: post?.details?.lat, lng: post?.details?.lng },
    { lat: post?.details?.lat, lng: post?.details?.lon },
  ];

  for (const obj of possible) {
    if (!obj) continue;
    const lat = Number(obj.lat ?? obj.latitude);
    const lng = Number(obj.lng ?? obj.lon ?? obj.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }
  }

  return null;
}

function parsePostMedia(post) {
  const media = post?.media;
  if (!Array.isArray(media) || media.length === 0) return "";
  const first = media[0];
  if (typeof first === "string") return first;
  return first?.url || first?.media_url || first?.storage_url || "";
}

function formatDistanceText(meters) {
  if (!Number.isFinite(meters)) return "-";
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

function formatDurationText(seconds) {
  if (!Number.isFinite(seconds)) return "-";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} hr ${m} min`;
}

function classifyTier(distanceMeters) {
  if (distanceMeters < ON_ROUTE_METERS) return "on_route";
  return "near_route";
}

function getLeafletHtml(tileUrl) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html, body, #map {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: #f5f7fb;
      }

      .route-pin-wrapper {
        position: relative;
        width: 48px;
        height: 58px;
        filter: drop-shadow(0 3px 6px rgba(0,0,0,0.28));
      }

      .route-pin-circle {
        width: 48px;
        height: 48px;
        border-radius: 24px;
        overflow: hidden;
        box-sizing: border-box;
        border: 4px solid var(--tier-color);
        background: #fff;
        position: relative;
      }

      .route-pin-inner-ring {
        position: absolute;
        inset: 2px;
        border-radius: 22px;
        border: 2px solid #fff;
        overflow: hidden;
      }

      .route-pin-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .route-pin-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        background: #6b7280;
        font-size: 11px;
        font-weight: 700;
      }

      .route-pin-tip {
        position: absolute;
        left: 50%;
        bottom: 0;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 7px solid transparent;
        border-right: 7px solid transparent;
        border-top: 10px solid var(--tier-color);
      }

      .leaflet-legend {
        position: absolute;
        left: 10px;
        bottom: 10px;
        z-index: 1000;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 10px;
        padding: 8px 10px;
        font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        box-shadow: 0 3px 12px rgba(0,0,0,0.18);
      }

      .leaflet-legend-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
      }

      .leaflet-legend-dot {
        width: 10px;
        height: 10px;
        border-radius: 5px;
      }

      .endpoint-pin {
        width: 22px;
        height: 22px;
        border-radius: 11px;
        border: 3px solid #fff;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
      }

      .endpoint-origin { background: #16a34a; }
      .endpoint-destination { background: #ff3b30; }

      .dot-on-route { background: #ff3b30; }
      .dot-near-route { background: #f39c12; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      const map = L.map('map', { zoomControl: true }).setView([${DEFAULT_REGION.latitude}, ${DEFAULT_REGION.longitude}], ${DEFAULT_REGION.zoom});

      L.tileLayer('${tileUrl}', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      let routeLayer = null;
      let originMarker = null;
      let destinationMarker = null;
      let postLayers = [];

      const originIcon = L.divIcon({
        className: '',
        html: '<div class="endpoint-pin endpoint-origin"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      const destinationIcon = L.divIcon({
        className: '',
        html: '<div class="endpoint-pin endpoint-destination"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      function clearRouteArtifacts() {
        if (routeLayer) {
          map.removeLayer(routeLayer);
          routeLayer = null;
        }
        if (originMarker) {
          map.removeLayer(originMarker);
          originMarker = null;
        }
        if (destinationMarker) {
          map.removeLayer(destinationMarker);
          destinationMarker = null;
        }
        postLayers.forEach((layer) => map.removeLayer(layer));
        postLayers = [];
      }

      function escapeHtml(str) {
        return String(str || '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');
      }

      function createPostIcon(post) {
        const tierColor = post.pinTier === 'on_route' ? '#ff3b30' : '#f39c12';
        const title = escapeHtml(post.title || post.category || 'Post');
        const imageUrl = post.imageUrl ? escapeHtml(post.imageUrl) : '';
        const fallbackLabel = escapeHtml((post.category || 'Post').slice(0, 1));

        const imageInner = imageUrl
          ? '<img class="route-pin-image" src="' + imageUrl + '" alt="' + title + '" />'
          : '<div class="route-pin-fallback">' + fallbackLabel + '</div>';

        const html =
          '<div class="route-pin-wrapper" style="--tier-color:' + tierColor + '" title="' + title + '">' +
            '<div class="route-pin-circle">' +
              '<div class="route-pin-inner-ring">' +
                imageInner +
              '</div>' +
            '</div>' +
            '<div class="route-pin-tip"></div>' +
          '</div>';

        return L.divIcon({
          className: '',
          html,
          iconSize: [48, 58],
          iconAnchor: [24, 58],
          popupAnchor: [0, -50],
        });
      }

      function drawRoute(payload) {
        clearRouteArtifacts();

        const coords = payload?.coords || [];
        const hasRoute = coords.length > 0;

        if (payload?.origin) {
          originMarker = L.marker([payload.origin.latitude, payload.origin.longitude], {
            icon: originIcon,
          }).addTo(map);
        }

        if (payload?.destination) {
          destinationMarker = L.marker([payload.destination.latitude, payload.destination.longitude], {
            icon: destinationIcon,
          }).addTo(map);
        }

        if (hasRoute) {
          const latlngs = coords.map((p) => [p.latitude, p.longitude]);
          routeLayer = L.polyline(latlngs, {
            color: '#2563eb',
            weight: 5,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(map);
        }

        const posts = payload?.posts || [];
        posts.forEach((post) => {
          if (!post?.coordinate) return;

          const marker = L.marker([post.coordinate.latitude, post.coordinate.longitude], {
            icon: createPostIcon(post),
          }).addTo(map);

          marker.on('click', () => {
            window.ReactNativeWebView.postMessage(
              JSON.stringify({ type: 'POST_TAPPED', postId: post.id })
            );
          });

          postLayers.push(marker);
        });

        if (hasRoute && routeLayer) {
          map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });
        } else if (payload?.origin && payload?.destination) {
          const bounds = L.latLngBounds(
            [payload.origin.latitude, payload.origin.longitude],
            [payload.destination.latitude, payload.destination.longitude]
          );
          map.fitBounds(bounds, { padding: [60, 60] });
        } else if (payload?.origin) {
          map.setView([payload.origin.latitude, payload.origin.longitude], 14);
        } else if (payload?.destination) {
          map.setView([payload.destination.latitude, payload.destination.longitude], 14);
        }
      }

      function receiveMessage(raw) {
        try {
          const data = JSON.parse(raw);
          if (data?.type === 'DRAW_ROUTE') {
            drawRoute(data.payload);
          }
        } catch (_) {}
      }

      map.on('click', (e) => {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({
            type: 'MAP_TAPPED',
            latitude: e.latlng.lat,
            longitude: e.latlng.lng,
          })
        );
      });

      document.addEventListener('message', (event) => receiveMessage(event.data));
      window.addEventListener('message', (event) => receiveMessage(event.data));

      window.__DRAW_ROUTE_FROM_RN = function (payloadJson) {
        receiveMessage(payloadJson);
      };

      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_READY' }));
      }
    </script>
  </body>
</html>`;
}

export default function RoutingScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const webViewRef = useRef(null);
  const pendingRoutePayloadRef = useRef(null);

  const { colors } = useTheme();

  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [originText, setOriginText] = useState("");
  const [destinationText, setDestinationText] = useState("");
  const [originSuggestions, setOriginSuggestions] = useState([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [isRouting, setIsRouting] = useState(false);
  const [isUsingLocation, setIsUsingLocation] = useState(false);
  const [activeSelectionField, setActiveSelectionField] = useState("origin");
  const [isSearchCollapsed, setIsSearchCollapsed] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);

  const leafletHtml = useMemo(() => getLeafletHtml(OSM_TILES_URL), []);

  useEffect(() => {
    const target = route?.params?.destination;
    if (!target) return;

    const latitude = Number(target.latitude);
    const longitude = Number(target.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    setDestination({
      latitude,
      longitude,
      address: target.address || "Pinned destination",
    });
    setDestinationText(target.address || "Pinned destination");
    setDestinationSuggestions([]);
  }, [route?.params?.destination]);

  // Focus map on selected origin location
  useEffect(() => {
    if (!origin || !isMapReady || !webViewRef.current) return;

    const zoomScript = `
      if (map) {
        map.setView([${origin.latitude}, ${origin.longitude}], 14);
      }
      true;
    `;
    webViewRef.current.injectJavaScript(zoomScript);
  }, [origin, isMapReady]);

  const searchPlaces = async (text, field) => {
    const query = text.trim();
    if (query.length < 2) {
      if (field === "origin") setOriginSuggestions([]);
      if (field === "destination") setDestinationSuggestions([]);
      return;
    }

    if (field === "origin" && origin && originText === origin.address) {
      setOriginSuggestions([]);
      return;
    }

    if (
      field === "destination" &&
      destination &&
      destinationText === destination.address
    ) {
      setDestinationSuggestions([]);
      return;
    }

    try {
      const normalizeResults = (rows) => {
        return (rows || [])
          .map((item, index) => ({
            id:
              item.place_id ||
              item.osm_id ||
              `${item.lat}-${item.lon}-${index}`,
            title: item.display_name || item.name || "Unknown place",
            latitude: Number(item.lat),
            longitude: Number(item.lon),
          }))
          .filter(
            (item) =>
              Number.isFinite(item.latitude) && Number.isFinite(item.longitude),
          );
      };

      let results = [];

      // 1) Nominatim (OSM) primary
      const nominatimUrl =
        `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}` +
        `&limit=${OSM_SEARCH_LIMIT}&addressdetails=1`;
      const response = await fetch(nominatimUrl, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "en",
          "User-Agent": "VerifiKarFE/1.0 (Routing)",
        },
      });
      const json = await response.json().catch(() => []);
      results = normalizeResults(json);

      // 2) Photon fallback (also OSM-backed)
      if (results.length === 0) {
        const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${OSM_SEARCH_LIMIT}`;
        const photonRes = await fetch(photonUrl, {
          headers: {
            Accept: "application/json",
            "User-Agent": "VerifiKarFE/1.0 (Routing)",
          },
        });
        const photonJson = await photonRes.json().catch(() => ({}));
        const features = photonJson?.features || [];
        results = features
          .map((feature, index) => {
            const [lon, lat] = feature?.geometry?.coordinates || [];
            const p = feature?.properties || {};
            const labelParts = [
              p.name,
              p.street,
              p.city,
              p.state,
              p.country,
            ].filter(Boolean);
            return {
              id: p.osm_id || `${lat}-${lon}-${index}`,
              title: labelParts.join(", ") || "Unknown place",
              latitude: Number(lat),
              longitude: Number(lon),
            };
          })
          .filter(
            (item) =>
              Number.isFinite(item.latitude) && Number.isFinite(item.longitude),
          );
      }

      if (field === "origin") setOriginSuggestions(results);
      if (field === "destination") setDestinationSuggestions(results);
    } catch (_error) {
      if (field === "origin") setOriginSuggestions([]);
      if (field === "destination") setDestinationSuggestions([]);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      searchPlaces(originText, "origin");
    }, 350);
    return () => clearTimeout(timer);
  }, [originText]);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchPlaces(destinationText, "destination");
    }, 350);
    return () => clearTimeout(timer);
  }, [destinationText]);

  const selectOrigin = (item) => {
    setOrigin({
      latitude: item.latitude,
      longitude: item.longitude,
      address: item.title,
    });
    setOriginText(item.title);
    setOriginSuggestions([]); // Explicitly hide suggestions
    setActiveSelectionField("destination"); // Auto-move to destination field
  };

  const selectDestination = (item) => {
    setDestination({
      latitude: item.latitude,
      longitude: item.longitude,
      address: item.title,
    });
    setDestinationText(item.title);
    setDestinationSuggestions([]); // Explicitly hide suggestions
  };

  const handleUseMyLocation = async () => {
    try {
      setIsUsingLocation(true);
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert(
          "Location required",
          "Please allow location permission to use your current position.",
        );
        return;
      }

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      try {
        // Try to get current position with high accuracy and timeout
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
          timeInterval: 1000,
          distanceInterval: 0,
        });

        clearTimeout(timeoutId);

        const coord = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        };

        setOrigin({ ...coord, address: "My location" });
        setOriginText("My location");
        setOriginSuggestions([]); // Hide suggestions
        setActiveSelectionField("destination"); // Move focus to destination
      } catch (accuracyError) {
        // If high accuracy times out, fallback to balanced accuracy
        clearTimeout(timeoutId);
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 500,
          distanceInterval: 0,
        });

        const coord = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        };

        setOrigin({ ...coord, address: "My location" });
        setOriginText("My location");
        setOriginSuggestions([]); // Hide suggestions
        setActiveSelectionField("destination"); // Move focus to destination
      }
    } catch (_error) {
      Alert.alert("Location error", "Unable to fetch your current location. Please try again.");
    } finally {
      setIsUsingLocation(false);
    }
  };

  const handleSwap = () => {
    const nextOrigin = destination;
    const nextDestination = origin;
    const nextOriginText = destinationText;
    const nextDestinationText = originText;

    setOrigin(nextOrigin);
    setDestination(nextDestination);
    setOriginText(nextOriginText);
    setDestinationText(nextDestinationText);
    setOriginSuggestions([]);
    setDestinationSuggestions([]);
  };

  const fetchPublishedPosts = async (start, end) => {
    const token = await AsyncStorage.getItem("authToken");
    const baseHeaders = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const center = {
      latitude: (start.latitude + end.latitude) / 2,
      longitude: (start.longitude + end.longitude) / 2,
    };
    const radiusFromEndpointsKm =
      Math.max(
        haversineDistanceMeters(center, start),
        haversineDistanceMeters(center, end),
      ) / 1000;
    const radiusKm = Math.min(
      50,
      Math.max(10, Math.ceil(radiusFromEndpointsKm + 10)),
    );

    const feedParams = new URLSearchParams();
    feedParams.append("lat", center.latitude.toString());
    feedParams.append("lon", center.longitude.toString());
    feedParams.append("radius_km", radiusKm.toString());
    feedParams.append("max_days_old", "30");
    feedParams.append("min_credibility", "0");
    feedParams.append("skip", "0");
    feedParams.append("limit", "100");

    const endpoint = `${API_BASE_URL}/feed?${feedParams.toString()}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        FEED_FETCH_TIMEOUT_MS,
      );
      const response = await fetch(endpoint, {
        method: "GET",
        headers: baseHeaders,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const json = await response.json().catch(() => null);
      if (!response.ok) return [];

      const candidates =
        json?.details?.posts || json?.posts || json?.details || json || [];
      return Array.isArray(candidates) ? candidates : [];
    } catch (_error) {
      return [];
    }
  };

  const getRouteWithOsrm = async (start, end) => {
    const osrmUrl =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${start.longitude},${start.latitude};${end.longitude},${end.latitude}` +
      `?overview=full&geometries=polyline`;

    const response = await fetch(osrmUrl);
    const data = await response.json();

    if (data?.code !== "Ok" || !data?.routes?.length) {
      throw new Error(data?.message || "OSRM could not build route.");
    }

    const route = data.routes[0];
    const decodedPoints = polyline.decode(route.geometry).map(([lat, lng]) => ({
      latitude: lat,
      longitude: lng,
    }));

    const points = [
      { latitude: start.latitude, longitude: start.longitude },
      ...decodedPoints,
      { latitude: end.latitude, longitude: end.longitude },
    ];

    return {
      points,
      distanceText: formatDistanceText(route.distance),
      durationText: formatDurationText(route.duration),
    };
  };

  const filterPostsNearRoute = (posts, routePoints) => {
    return posts
      .map((post) => {
        const coordinate = parsePostCoordinate(post);
        if (!coordinate) return null;

        const minDistance = getPointToRouteMinDistanceMeters(
          coordinate,
          routePoints,
        );
        if (minDistance > ROUTE_PROXIMITY_METERS) {
          return null;
        }

        return {
          id: post.id,
          title: post.title || post.content || "Post",
          category: post.category || post.event_category || "General",
          imageUrl: parsePostMedia(post),
          distanceToRoute: minDistance,
          pinTier: classifyTier(minDistance),
          coordinate,
        };
      })
      .filter(Boolean);
  };

  const injectRoutePayload = (payload) => {
    const message = JSON.stringify({ type: "DRAW_ROUTE", payload });
    const script = `window.__DRAW_ROUTE_FROM_RN && window.__DRAW_ROUTE_FROM_RN(${JSON.stringify(message)}); true;`;
    webViewRef.current?.injectJavaScript(script);
  };

  const postRouteToWebView = (payload) => {
    pendingRoutePayloadRef.current = payload;
    if (!isMapReady || !webViewRef.current) return;
    injectRoutePayload(payload);
  };

  const clearRouteDisplay = (nextOrigin = origin, nextDestination = destination) => {
    setRouteInfo(null);
    postRouteToWebView({
      coords: [],
      origin: nextOrigin || null,
      destination: nextDestination || null,
      posts: [],
    });
  };

  const handleGetRoute = async () => {
    if (!origin || !destination) {
      Alert.alert(
        "Incomplete route",
        "Select both start and destination first.",
      );
      return;
    }

    try {
      setIsRouting(true);
      setRouteInfo(null);

      const route = await getRouteWithOsrm(origin, destination);

      if (!route?.points?.length) {
        Alert.alert("No route found", "Try different points and try again.");
        return;
      }

      setRouteInfo({
        distanceText: route.distanceText,
        durationText: route.durationText,
      });

      postRouteToWebView({
        coords: route.points,
        origin,
        destination,
        posts: [],
      });

      setIsSearchCollapsed(true);
      setIsRouting(false);

      // Fetch and render nearby report pins in background so route drawing is never blocked.
      void (async () => {
        const allPosts = await fetchPublishedPosts(origin, destination);

        const nearbyPosts = filterPostsNearRoute(allPosts, route.points);

        postRouteToWebView({
          coords: route.points,
          origin,
          destination,
          posts: nearbyPosts,
        });
      })();
    } catch (_error) {
      Alert.alert("Routing failed", "Unable to build route right now.");
      setIsRouting(false);
    }
  };

  const handleWebViewMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data?.type === "MAP_READY") {
        setIsMapReady(true);
        if (pendingRoutePayloadRef.current) {
          injectRoutePayload(pendingRoutePayloadRef.current);
        }
        return;
      }

      if (data?.type === "POST_TAPPED" && data?.postId) {
        navigation.navigate("PostDetail", { postId: data.postId });
        return;
      }

      if (data?.type === "MAP_TAPPED") {
        const latitude = Number(data.latitude);
        const longitude = Number(data.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

        if (activeSelectionField === "origin" || !origin) {
          setOrigin({ latitude, longitude, address: "Pinned start" });
          setOriginText("Pinned start");
          setOriginSuggestions([]);
          setActiveSelectionField("destination");
        } else {
          setDestination({
            latitude,
            longitude,
            address: "Pinned destination",
          });
          setDestinationText("Pinned destination");
          setDestinationSuggestions([]);
        }
      }
    } catch (_error) {
      // Ignore malformed bridge payloads.
    }
  };

  useEffect(() => {
    if (!origin && !destination) {
      clearRouteDisplay(null, null);
      return;
    }

    if (!origin || !destination) {
      clearRouteDisplay(origin, destination);
    }
  }, [origin, destination]);

  const renderSuggestionItem = (item, onSelect) => (
    <TouchableOpacity
      key={item.id}
      style={[styles.suggestionItem, { borderBottomColor: colors.lightGray }]}
      onPress={() => onSelect(item)}
    >
      <Ionicons
        name="location-outline"
        size={16}
        color={colors.gray}
        style={styles.suggestionIcon}
      />
      <Text
        style={[styles.suggestionText, { color: colors.text }]}
        numberOfLines={2}
      >
        {item.title}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: leafletHtml }}
        onMessage={handleWebViewMessage}
        onLoadStart={() => setIsMapReady(false)}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        style={StyleSheet.absoluteFillObject}
      />

      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.lightGray,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.headerIconBtn}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Route Planner
        </Text>
        <View style={styles.headerRightSpace} />
      </View>

      <View style={styles.floatingCardWrap}>
        {isSearchCollapsed ? (
          <TouchableOpacity
            style={[
              styles.navigateCompactButton,
              { backgroundColor: colors.primary, shadowColor: colors.text },
            ]}
            onPress={() => setIsSearchCollapsed(false)}
            activeOpacity={0.9}
          >
            <Ionicons name="navigate" size={16} color="#fff" />
            <Text style={styles.navigateCompactButtonText}>Navigate</Text>
          </TouchableOpacity>
        ) : (
          <View
            style={[
              styles.searchCard,
              { backgroundColor: colors.surface, shadowColor: colors.text },
            ]}
          >
            <View
              style={[
                styles.inputRow,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.lightGray,
                },
              ]}
            >
              <Ionicons name="ellipse" size={12} color="#16A34A" />
              <TextInput
                value={originText}
                onChangeText={(text) => {
                  setOriginText(text);
                  if (text.trim().length === 0) {
                    setOriginSuggestions([]);
                    setOrigin(null);
                  } else if (!origin || text !== origin.address) {
                    setOrigin(null); // Clear selected origin if text changes
                  }
                }}
                onFocus={() => setActiveSelectionField("origin")}
                placeholder="Starting point"
                placeholderTextColor={colors.gray}
                style={[styles.inputText, { color: colors.text }]}
              />
              {isUsingLocation ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <TouchableOpacity
                  onPress={handleUseMyLocation}
                  style={styles.locationButton}
                >
                  <Ionicons name="locate" size={14} color={colors.primary} />
                  <Text
                    style={[
                      styles.locationButtonText,
                      { color: colors.primary },
                    ]}
                  >
                    Use my location
                  </Text>
                </TouchableOpacity>
              )}
              {originText ? (
                <TouchableOpacity
                  onPress={() => {
                    setOriginText("");
                    setOrigin(null);
                    setOriginSuggestions([]);
                  }}
                  style={styles.clearButton}
                >
                  <Ionicons name="close-circle" size={16} color={colors.gray} />
                </TouchableOpacity>
              ) : null}
            </View>

            {originSuggestions.length > 0 ? (
              <View
                style={[
                  styles.suggestionsList,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.lightGray,
                  },
                ]}
              >
                <FlatList
                  data={originSuggestions}
                  keyExtractor={(item) => String(item.id)}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) =>
                    renderSuggestionItem(item, selectOrigin)
                  }
                />
              </View>
            ) : null}

            <Pressable
              style={[
                styles.swapButton,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.lightGray,
                },
              ]}
              onPress={handleSwap}
            >
              <Ionicons name="swap-vertical" size={17} color={colors.text} />
            </Pressable>

            <View
              style={[
                styles.inputRow,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.lightGray,
                },
              ]}
            >
              <Ionicons name="location" size={14} color="#DC2626" />
              <TextInput
                value={destinationText}
                onChangeText={(text) => {
                  setDestinationText(text);
                  if (text.trim().length === 0) {
                    setDestinationSuggestions([]);
                    setDestination(null);
                  } else if (!destination || text !== destination.address) {
                    setDestination(null); // Clear selected destination if text changes
                  }
                }}
                onFocus={() => setActiveSelectionField("destination")}
                placeholder="Destination"
                placeholderTextColor={colors.gray}
                style={[styles.inputText, { color: colors.text }]}
              />
              {destinationText ? (
                <TouchableOpacity
                  onPress={() => {
                    setDestinationText("");
                    setDestination(null);
                    setDestinationSuggestions([]);
                  }}
                  style={styles.clearButton}
                >
                  <Ionicons name="close-circle" size={16} color={colors.gray} />
                </TouchableOpacity>
              ) : null}
            </View>

            {destinationSuggestions.length > 0 ? (
              <View
                style={[
                  styles.suggestionsList,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.lightGray,
                  },
                ]}
              >
                <FlatList
                  data={destinationSuggestions}
                  keyExtractor={(item) => String(item.id)}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) =>
                    renderSuggestionItem(item, selectDestination)
                  }
                />
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.routeButton,
                {
                  backgroundColor:
                    !origin || !destination || isRouting
                      ? colors.gray
                      : colors.primary,
                },
              ]}
              onPress={handleGetRoute}
              disabled={!origin || !destination || isRouting}
            >
              {isRouting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.routeButtonText}>Get route</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {routeInfo ? (
        <View style={styles.infoStripWrap}>
          <View
            style={[
              styles.infoStrip,
              { backgroundColor: colors.surface, shadowColor: colors.text },
            ]}
          >
            <Ionicons name="navigate" size={14} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.text }]}>
              {routeInfo.distanceText} · {routeInfo.durationText}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    position: "absolute",
    top: Platform.OS === "ios" ? 8 : 6,
    left: 12,
    right: 12,
    height: 44,
    borderBottomWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
    zIndex: 30,
  },
  headerIconBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  headerRightSpace: {
    width: 32,
    height: 32,
  },
  floatingCardWrap: {
    position: "absolute",
    top: Platform.OS === "ios" ? 58 : 54,
    left: 12,
    right: 12,
    alignItems: "center",
    zIndex: 20,
    elevation: 12,
  },
  searchCard: {
    position: "relative",
    overflow: "visible",
    width: "88%",
    maxWidth: 380,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    shadowOpacity: 0.15,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  navigateCompactButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  navigateCompactButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  inputRow: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
  },
  inputText: {
    flex: 1,
    height: 44,
    fontSize: 15,
    fontWeight: "500",
  },
  locationButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  locationButtonText: {
    fontSize: 12,
    fontWeight: "600",
  },
  clearButton: {
    padding: 2,
  },
  suggestionsList: {
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 4,
    marginBottom: 8,
    maxHeight: 180,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  suggestionIcon: {
    marginRight: 8,
  },
  suggestionText: {
    fontSize: 14,
    flex: 1,
  },
  swapButton: {
    alignSelf: "flex-end",
    width: 30,
    height: 30,
    borderWidth: 1,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
    marginTop: 8,
  },
  routeButton: {
    marginTop: 4,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  routeButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    textTransform: "none",
  },
  infoStripWrap: {
    position: "absolute",
    bottom: 94,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  infoStrip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  infoText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
