import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    Easing,
    Modal,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { API_BASE_URL } from "../config";
import { useTheme } from "../styles/ThemeContext";

const SCREEN_HEIGHT = Dimensions.get("window").height;
const SHEET_HEIGHT = Math.round(SCREEN_HEIGHT * 0.85);

const FILTERS = [
  { key: "all", label: "All", dot: "#FFFFFF" },
  { key: "fire", label: "Fire", dot: "#D85A30" },
  { key: "traffic", label: "Traffic", dot: "#BA7517" },
  { key: "accident", label: "Accident", dot: "#185FA5" },
  { key: "crime", label: "Crime", dot: "#534AB7" },
  { key: "rescue", label: "Rescue", dot: "#0F6E56" },
  { key: "protest", label: "Protest", dot: "#993556" },
  { key: "disaster", label: "Disaster", dot: "#A32D2D" },
  { key: "infra", label: "Infra", dot: "#3B6D11" },
  { key: "outage", label: "Outage", dot: "#5F5E5A" },
];

const TOPICS = [
  {
    id: "t1",
    key: "fire",
    name: "Fire",
    subtitle: "High activity",
    reports: 42,
    emoji: "??",
    colors: ["#F0997B", "#D85A30"],
  },
  {
    id: "t2",
    key: "traffic",
    name: "Traffic",
    subtitle: "Surge now",
    reports: 89,
    emoji: "??",
    colors: ["#FAC775", "#BA7517"],
  },
  {
    id: "t3",
    key: "crime",
    name: "Crime",
    subtitle: "Verified",
    reports: 17,
    emoji: "??",
    colors: ["#AFA9EC", "#534AB7"],
  },
  {
    id: "t4",
    key: "accident",
    name: "Accident",
    subtitle: "Multiple zones",
    reports: 31,
    emoji: "??",
    colors: ["#85B7EB", "#185FA5"],
  },
  {
    id: "t5",
    key: "rescue",
    name: "Rescue",
    subtitle: "Urgent",
    reports: 8,
    emoji: "??",
    colors: ["#5DCAA5", "#0F6E56"],
  },
  {
    id: "t6",
    key: "weather",
    name: "Weather",
    subtitle: "Storm alert",
    reports: 55,
    emoji: "??",
    colors: ["#B5D4F4", "#378ADD"],
  },
  {
    id: "t7",
    key: "protest",
    name: "Protest",
    subtitle: "Ongoing",
    reports: 24,
    emoji: "??",
    colors: ["#ED93B1", "#993556"],
  },
  {
    id: "t8",
    key: "outage",
    name: "Outage",
    subtitle: "3 areas",
    reports: 13,
    emoji: "?",
    colors: ["#D3D1C7", "#5F5E5A"],
  },
  {
    id: "t9",
    key: "disaster",
    name: "Disaster",
    subtitle: "Monitoring",
    reports: 6,
    emoji: "??",
    colors: ["#F7C1C1", "#A32D2D"],
  },
  {
    id: "t10",
    key: "infra",
    name: "Infrastructure",
    subtitle: "Road damage",
    reports: 19,
    emoji: "???",
    colors: ["#C0DD97", "#3B6D11"],
  },
];

const LOCATIONS = [
  {
    id: "l1",
    name: "Saddar",
    topLabel: "Saddar",
    emoji: "???",
    posts: 34,
    tags: "Fire � Traffic",
    colors: ["#AFA9EC", "#3C3489"],
  },
  {
    id: "l2",
    name: "Clifton",
    topLabel: "Clifton",
    emoji: "??",
    posts: 28,
    tags: "Weather � Rescue",
    colors: ["#9FE1CB", "#085041"],
  },
  {
    id: "l3",
    name: "Gulshan-e-Iqbal",
    topLabel: "Gulshan",
    emoji: "???",
    posts: 21,
    tags: "Crime � Outage",
    colors: ["#F5C4B3", "#993C1D"],
  },
  {
    id: "l4",
    name: "Defence (DHA)",
    topLabel: "DHA",
    emoji: "??",
    posts: 18,
    tags: "Accident � Traffic",
    colors: ["#F4C0D1", "#72243E"],
  },
  {
    id: "l5",
    name: "Korangi",
    topLabel: "Korangi",
    emoji: "??",
    posts: 15,
    tags: "Fire � Infra",
    colors: ["#B5D4F4", "#0C447C"],
  },
  {
    id: "l6",
    name: "Malir",
    topLabel: "Malir",
    emoji: "??",
    posts: 11,
    tags: "Protest � Weather",
    colors: ["#FAC775", "#633806"],
  },
];

const EVENTS = [
  {
    id: "e1",
    emoji: "??",
    label: "Fire Safety Drill",
    category: "Fire & Safety",
    day: "14",
    month: "Apr",
    title: "City-wide fire safety awareness drill",
    location: "Karachi Expo Centre, Clifton",
    attending: "1.2k attending",
    status: "Upcoming",
    statusBg: "#E6F1FB",
    statusColor: "#0C447C",
    colors: ["#F0997B", "#993C1D"],
  },
  {
    id: "e2",
    emoji: "??",
    label: "Emergency Response",
    category: "Disaster",
    day: "12",
    month: "Apr",
    title: "Flood emergency coordination centre open",
    location: "Malir Town Hall, Malir",
    attending: "348 attending",
    status: "Live now",
    statusBg: "#FCEBEB",
    statusColor: "#791F1F",
    colors: ["#F7C1C1", "#A32D2D"],
  },
  {
    id: "e3",
    emoji: "??",
    label: "Road Safety Week",
    category: "Traffic",
    day: "16",
    month: "Apr",
    title: "National road safety awareness week � Karachi leg",
    location: "Shahrae Faisal, Saddar",
    attending: "520 attending",
    status: "Upcoming",
    statusBg: "#E6F1FB",
    statusColor: "#0C447C",
    colors: ["#85B7EB", "#0C447C"],
  },
  {
    id: "e4",
    emoji: "??",
    label: "First Aid Camp",
    category: "Rescue",
    day: "13",
    month: "Apr",
    title: "Free first aid and CPR training camp",
    location: "Aga Khan Hospital, Saddar",
    attending: "204 attending",
    status: "Tomorrow",
    statusBg: "#FAEEDA",
    statusColor: "#633806",
    colors: ["#5DCAA5", "#04342C"],
  },
];

const CATEGORY_POSTS = {
  fire: [
    {
      title: "Smoke rising from warehouse behind Lighthouse market",
      area: "Lighthouse",
      distanceKm: 1.4,
      timeAgo: "6 min ago",
      upvotes: 67,
      downvotes: 9,
      credibility: 92,
      emoji: "??",
    },
    {
      title: "Street stall fire spreading near Burns Road food lane",
      area: "Burns Road",
      distanceKm: 2.2,
      timeAgo: "11 min ago",
      upvotes: 54,
      downvotes: 6,
      credibility: 88,
      emoji: "??",
    },
    {
      title: "Electrical short-circuit sparked market fire in old Saddar block",
      area: "Saddar",
      distanceKm: 0.9,
      timeAgo: "18 min ago",
      upvotes: 39,
      downvotes: 8,
      credibility: 84,
      emoji: "??",
    },
  ],
  traffic: [
    {
      title: "M9 interchange completely gridlocked after lane merge",
      area: "M9 Link",
      distanceKm: 7.6,
      timeAgo: "4 min ago",
      upvotes: 78,
      downvotes: 14,
      credibility: 90,
      emoji: "??",
    },
    {
      title: "Signal failure causing long queues on Shahrae Faisal",
      area: "Shahrae Faisal",
      distanceKm: 3.1,
      timeAgo: "9 min ago",
      upvotes: 63,
      downvotes: 10,
      credibility: 86,
      emoji: "??",
    },
    {
      title: "Broken-down bus blocking fast lane on Korangi Road",
      area: "Korangi Road",
      distanceKm: 5.4,
      timeAgo: "16 min ago",
      upvotes: 42,
      downvotes: 12,
      credibility: 79,
      emoji: "??",
    },
  ],
  crime: [
    {
      title: "Snatching reported outside Dolmen Mall parking exit",
      area: "Clifton",
      distanceKm: 4.3,
      timeAgo: "7 min ago",
      upvotes: 58,
      downvotes: 7,
      credibility: 91,
      emoji: "??",
    },
    {
      title: "Unauthorized gathering observed near Gulshan commercial lane",
      area: "Gulshan",
      distanceKm: 6.0,
      timeAgo: "22 min ago",
      upvotes: 31,
      downvotes: 11,
      credibility: 73,
      emoji: "??",
    },
  ],
  accident: [
    {
      title: "Multi-vehicle collision slowing both sides of Superhighway",
      area: "Superhighway",
      distanceKm: 8.4,
      timeAgo: "13 min ago",
      upvotes: 69,
      downvotes: 8,
      credibility: 93,
      emoji: "??",
    },
    {
      title: "Motorcycle crash at Liaquatabad underpass with injuries",
      area: "Liaquatabad",
      distanceKm: 3.8,
      timeAgo: "19 min ago",
      upvotes: 47,
      downvotes: 9,
      credibility: 82,
      emoji: "??",
    },
    {
      title: "Minor fender-bender blocking Teen Talwar inner turn",
      area: "Teen Talwar",
      distanceKm: 4.9,
      timeAgo: "26 min ago",
      upvotes: 25,
      downvotes: 6,
      credibility: 71,
      emoji: "??",
    },
  ],
  rescue: [
    {
      title: "Rescue team called after person trapped in Dolmen Tower elevator",
      area: "Clifton",
      distanceKm: 4.0,
      timeAgo: "5 min ago",
      upvotes: 36,
      downvotes: 4,
      credibility: 89,
      emoji: "??",
    },
    {
      title: "Flood rescue boats deployed near Malir Nadi low bridge",
      area: "Malir",
      distanceKm: 10.2,
      timeAgo: "14 min ago",
      upvotes: 52,
      downvotes: 5,
      credibility: 94,
      emoji: "??",
    },
  ],
  weather: [
    {
      title: "Heavy rain intensity rising across North Karachi sectors",
      area: "North Karachi",
      distanceKm: 7.2,
      timeAgo: "3 min ago",
      upvotes: 61,
      downvotes: 13,
      credibility: 85,
      emoji: "??",
    },
    {
      title: "Flash flooding spotted around Nagan Chowrangi roundabout",
      area: "Nagan Chowrangi",
      distanceKm: 8.0,
      timeAgo: "12 min ago",
      upvotes: 57,
      downvotes: 8,
      credibility: 88,
      emoji: "??",
    },
    {
      title: "Fallen tree blocking one side of Sharea Pakistan",
      area: "Sharea Pakistan",
      distanceKm: 6.7,
      timeAgo: "20 min ago",
      upvotes: 33,
      downvotes: 9,
      credibility: 76,
      emoji: "??",
    },
  ],
  protest: [
    {
      title: "Workers rally gathering near Karachi Press Club gate",
      area: "Saddar",
      distanceKm: 1.6,
      timeAgo: "10 min ago",
      upvotes: 44,
      downvotes: 15,
      credibility: 68,
      emoji: "??",
    },
    {
      title: "Student march slowing traffic along University Road",
      area: "University Road",
      distanceKm: 5.8,
      timeAgo: "17 min ago",
      upvotes: 49,
      downvotes: 12,
      credibility: 74,
      emoji: "??",
    },
  ],
  outage: [
    {
      title: "12-hour load shedding started in Gulshan blocks 1-5",
      area: "Gulshan",
      distanceKm: 6.2,
      timeAgo: "9 min ago",
      upvotes: 53,
      downvotes: 10,
      credibility: 87,
      emoji: "?",
    },
    {
      title: "Transformer blast reported in Landhi Sector 2",
      area: "Landhi",
      distanceKm: 9.8,
      timeAgo: "21 min ago",
      upvotes: 41,
      downvotes: 9,
      credibility: 81,
      emoji: "?",
    },
  ],
  disaster: [
    {
      title: "Water level rising quickly in Malir River channel",
      area: "Malir River",
      distanceKm: 10.6,
      timeAgo: "15 min ago",
      upvotes: 46,
      downvotes: 6,
      credibility: 96,
      emoji: "??",
    },
  ],
  infra: [
    {
      title: "Deep pothole expanding on Shahrah-e-Quaideen lane",
      area: "PECHS",
      distanceKm: 4.4,
      timeAgo: "8 min ago",
      upvotes: 38,
      downvotes: 5,
      credibility: 83,
      emoji: "???",
    },
    {
      title: "Sewage overflow spreading along Tariq Road service lane",
      area: "Tariq Road",
      distanceKm: 3.7,
      timeAgo: "18 min ago",
      upvotes: 35,
      downvotes: 7,
      credibility: 78,
      emoji: "???",
    },
  ],
};

const LOCATION_POSTS = {
  saddar: [
    {
      title: "Market fire flare-up reported near Empress Market blocks",
      area: "Saddar",
      distanceKm: 0.8,
      timeAgo: "7 min ago",
      upvotes: 51,
      downvotes: 8,
      credibility: 90,
      emoji: "???",
    },
    {
      title: "Traffic gridlock forming near Bolton Market signal",
      area: "Saddar",
      distanceKm: 1.3,
      timeAgo: "14 min ago",
      upvotes: 43,
      downvotes: 10,
      credibility: 82,
      emoji: "???",
    },
    {
      title: "Street crime complaint logged near Hotel Metropole side road",
      area: "Saddar",
      distanceKm: 1.1,
      timeAgo: "23 min ago",
      upvotes: 27,
      downvotes: 12,
      credibility: 66,
      emoji: "???",
    },
  ],
  clifton: [
    {
      title: "High tide water entering Sea View service road",
      area: "Clifton",
      distanceKm: 4.2,
      timeAgo: "9 min ago",
      upvotes: 48,
      downvotes: 7,
      credibility: 91,
      emoji: "??",
    },
    {
      title: "Snatching report filed near Dolmen Mall entrance",
      area: "Clifton",
      distanceKm: 4.0,
      timeAgo: "16 min ago",
      upvotes: 36,
      downvotes: 8,
      credibility: 74,
      emoji: "??",
    },
    {
      title: "Traffic accident reported at Teen Talwar roundabout",
      area: "Clifton",
      distanceKm: 4.8,
      timeAgo: "25 min ago",
      upvotes: 30,
      downvotes: 9,
      credibility: 71,
      emoji: "??",
    },
  ],
  gulshan: [
    {
      title: "Power outage continues across Gulshan blocks 1 to 5",
      area: "Gulshan",
      distanceKm: 6.1,
      timeAgo: "11 min ago",
      upvotes: 45,
      downvotes: 9,
      credibility: 86,
      emoji: "???",
    },
    {
      title: "Suspicious activity reported near Johar Mor bus stop",
      area: "Gulshan",
      distanceKm: 6.3,
      timeAgo: "27 min ago",
      upvotes: 22,
      downvotes: 8,
      credibility: 64,
      emoji: "???",
    },
  ],
  dha: [
    {
      title: "Road accident blocking lane on Khayaban-e-Shahbaz",
      area: "DHA",
      distanceKm: 5.0,
      timeAgo: "13 min ago",
      upvotes: 40,
      downvotes: 7,
      credibility: 84,
      emoji: "??",
    },
    {
      title: "Traffic snarl building outside Zamzama Park stretch",
      area: "DHA",
      distanceKm: 5.4,
      timeAgo: "19 min ago",
      upvotes: 34,
      downvotes: 11,
      credibility: 72,
      emoji: "??",
    },
  ],
  korangi: [
    {
      title: "Factory fire plume visible from Korangi industrial zone",
      area: "Korangi",
      distanceKm: 9.0,
      timeAgo: "8 min ago",
      upvotes: 62,
      downvotes: 6,
      credibility: 93,
      emoji: "??",
    },
    {
      title: "Sewage pipeline burst causing roadside flooding",
      area: "Korangi",
      distanceKm: 9.5,
      timeAgo: "21 min ago",
      upvotes: 29,
      downvotes: 7,
      credibility: 77,
      emoji: "??",
    },
  ],
  malir: [
    {
      title: "Flash flooding seen near Malir Nadi crossing",
      area: "Malir",
      distanceKm: 10.4,
      timeAgo: "6 min ago",
      upvotes: 57,
      downvotes: 5,
      credibility: 95,
      emoji: "??",
    },
    {
      title: "Protest gathering outside local government office",
      area: "Malir",
      distanceKm: 10.1,
      timeAgo: "18 min ago",
      upvotes: 33,
      downvotes: 12,
      credibility: 69,
      emoji: "??",
    },
  ],
};

function GradientPanel({ colors, height, children }) {
  return (
    <View style={[{ height, backgroundColor: colors[0], overflow: "hidden" }]}>
      <View style={[styles.gradientOverlay, { backgroundColor: colors[1] }]} />
      {children}
    </View>
  );
}

function SectionHeader({ title, colors }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      <TouchableOpacity>
        <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
      </TouchableOpacity>
    </View>
  );
}

function normalizeLocationKey(name = "") {
  const val = name.toLowerCase();
  if (val.includes("gulshan")) return "gulshan";
  if (val.includes("defence") || val.includes("dha")) return "dha";
  if (val.includes("saddar")) return "saddar";
  if (val.includes("clifton")) return "clifton";
  if (val.includes("korangi")) return "korangi";
  if (val.includes("malir")) return "malir";
  return val.split(" ")[0];
}

function normalizeEventCategoryKey(category = "") {
  const val = category.toLowerCase();
  if (val.includes("fire")) return "fire";
  if (val.includes("traffic")) return "traffic";
  if (val.includes("crime")) return "crime";
  if (val.includes("accident")) return "accident";
  if (val.includes("rescue")) return "rescue";
  if (val.includes("protest")) return "protest";
  if (val.includes("disaster")) return "disaster";
  if (val.includes("infra")) return "infra";
  if (val.includes("weather")) return "weather";
  return "outage";
}

function iconForKey(key = "") {
  const k = key.toLowerCase();
  if (k.includes("fire")) return "flame";
  if (k.includes("traffic")) return "car-sport";
  if (k.includes("crime")) return "shield-outline";
  if (k.includes("accident")) return "warning-outline";
  if (k.includes("rescue")) return "medkit-outline";
  if (k.includes("weather")) return "rainy-outline";
  if (k.includes("protest")) return "megaphone-outline";
  if (k.includes("outage")) return "flash-outline";
  if (k.includes("disaster")) return "water-outline";
  if (k.includes("infra")) return "construct-outline";
  if (k.includes("saddar")) return "business-outline";
  if (k.includes("clifton")) return "boat-outline";
  if (k.includes("gulshan")) return "home-outline";
  if (k.includes("dha") || k.includes("defence")) return "business-outline";
  if (k.includes("korangi")) return "layers-outline";
  if (k.includes("malir")) return "leaf-outline";
  return "alert-circle-outline";
}

export default function DiscoverScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation();

  const [activeFilter, setActiveFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filterChips, setFilterChips] = useState(FILTERS);
  const [topics, setTopics] = useState(TOPICS);
  const [locations, setLocations] = useState(LOCATIONS);
  const [events, setEvents] = useState(EVENTS);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetPayload, setSheetPayload] = useState(null);
  const [isSheetLoading, setIsSheetLoading] = useState(false);
  const sheetTranslateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const searchDebounceRef = useRef(null);

  // New logic: debounce search input to avoid filtering on every keystroke.
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchTerm]);

  const loadDiscoverOverview = useCallback(async () => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/discover/overview?lat=24.8607&lon=67.0099&radius_km=50&max_days_old=30`,
      );
      const data = await response.json();
      if (!response.ok || !data?.success) return;

      setFilterChips(
        data?.details?.filter_chips?.length
          ? data.details.filter_chips
          : FILTERS,
      );
      setTopics(data?.details?.topics?.length ? data.details.topics : TOPICS);
      setLocations(
        data?.details?.locations?.length
          ? (() => {
              const seen = new Set();
              return data.details.locations
                .filter((item) => {
                  const key = (item.name || item.topLabel || "").toLowerCase();
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                })
                .map((item) => ({
                  ...item,
                  topLabel: item.topLabel || item.top_label || item.name,
                }));
            })()
          : LOCATIONS,
      );
      setEvents(
        data?.details?.events?.length
          ? data.details.events.map((event) => ({
              ...event,
              statusBg: event.statusBg || event.status_bg || "#E6F1FB",
              statusColor: event.statusColor || event.status_color || "#0C447C",
            }))
          : EVENTS,
      );
    } catch {
      // Fallback data remains.
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await loadDiscoverOverview();
      setIsLoading(false);
    };
    init();
  }, [loadDiscoverOverview]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadDiscoverOverview();
    setIsRefreshing(false);
  }, [loadDiscoverOverview]);

  const filteredTopics = useMemo(() => {
    const base =
      activeFilter === "all"
        ? topics
        : topics.filter(
            (item) => (item.key || "").toLowerCase() === activeFilter,
          );
    if (!debouncedSearchTerm.trim()) return base;
    const query = debouncedSearchTerm.toLowerCase();
    return base.filter(
      (item) =>
        (item.name || "").toLowerCase().includes(query) ||
        (item.subtitle || "").toLowerCase().includes(query),
    );
  }, [activeFilter, topics, debouncedSearchTerm]);

  const filteredLocations = useMemo(() => {
    if (!debouncedSearchTerm.trim()) return locations;
    const query = debouncedSearchTerm.toLowerCase();
    return locations.filter(
      (item) =>
        (item.name || "").toLowerCase().includes(query) ||
        (item.tags || "").toLowerCase().includes(query),
    );
  }, [locations, debouncedSearchTerm]);

  const filteredEvents = useMemo(() => {
    const byCategory =
      activeFilter === "all"
        ? events
        : events.filter((event) => {
            const c = (event.category || "").toLowerCase();
            return c.includes(activeFilter);
          });

    if (!debouncedSearchTerm.trim()) return byCategory;
    const query = debouncedSearchTerm.toLowerCase();
    return byCategory.filter(
      (event) =>
        (event.title || "").toLowerCase().includes(query) ||
        (event.location || "").toLowerCase().includes(query) ||
        (event.category || "").toLowerCase().includes(query),
    );
  }, [activeFilter, events, debouncedSearchTerm]);

  // New logic: show a single empty state when all three sections are empty.
  const showGlobalEmptyState =
    !isLoading &&
    filteredTopics.length === 0 &&
    filteredLocations.length === 0 &&
    filteredEvents.length === 0;

  const openBottomSheet = useCallback(
    (payload) => {
      setSheetPayload(payload);
      setSheetVisible(true);
      sheetTranslateY.setValue(SHEET_HEIGHT);
      Animated.timing(sheetTranslateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    },
    [sheetTranslateY],
  );

  const closeBottomSheet = useCallback(() => {
    Animated.timing(sheetTranslateY, {
      toValue: SHEET_HEIGHT,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setSheetVisible(false);
      setSheetPayload(null);
    });
  }, [sheetTranslateY]);

  const formatTimeAgo = useCallback((isoDate) => {
    if (!isoDate) return "just now";
    const then = new Date(isoDate).getTime();
    const now = Date.now();
    const diffMins = Math.max(1, Math.floor((now - then) / 60000));
    if (diffMins < 60) return `${diffMins} min ago`;
    const hours = Math.floor(diffMins / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return `${days} d ago`;
  }, []);

  const openSheetWithBackend = useCallback(
    async (sectionType, key, title, colorsForCard, iconName) => {
      openBottomSheet({
        title,
        subtitle: "Loading reports...",
        colors: colorsForCard,
        iconName,
        posts: [],
      });

      try {
        setIsSheetLoading(true);
        const response = await fetch(
          `${API_BASE_URL}/discover/section-posts?section_type=${encodeURIComponent(sectionType)}&key=${encodeURIComponent(
            key,
          )}&lat=24.8607&lon=67.0099&radius_km=50&max_days_old=30&limit=20`,
        );
        const data = await response.json();
        const rows = data?.details?.posts || [];

        const mappedPosts = rows.map((p) => ({
          postId: p.id,
          title: p.content,
          area: p.area || "Karachi",
          distanceKm: Number(p.distance_km || 0),
          timeAgo: formatTimeAgo(p.created_at),
          upvotes: Number(p.upvotes || 0),
          downvotes: Number(p.downvotes || 0),
          credibility: Math.round(Number(p.credibility_score || 0) * 100),
        }));

        setSheetPayload({
          title,
          subtitle: `${mappedPosts.length} active reports · Updated just now`,
          colors: colorsForCard,
          iconName,
          posts: mappedPosts,
        });
      } catch {
        setSheetPayload({
          title,
          subtitle: `0 active reports · Updated just now`,
          colors: colorsForCard,
          iconName,
          posts: [],
        });
      } finally {
        setIsSheetLoading(false);
      }
    },
    [formatTimeAgo, openBottomSheet],
  );

  const openTopicSheet = useCallback(
    (item) => {
      openSheetWithBackend(
        "topic",
        item.key,
        item.name,
        item.colors,
        iconForKey(item.key),
      );
    },
    [openSheetWithBackend],
  );

  const openLocationSheet = useCallback(
    (item) => {
      const key = normalizeLocationKey(item.name || item.topLabel);
      openSheetWithBackend(
        "location",
        item.name,
        item.name,
        item.colors,
        iconForKey(key),
      );
    },
    [openSheetWithBackend],
  );

  const openEventSheet = useCallback(
    (event) => {
      const key = normalizeEventCategoryKey(event.category);
      openSheetWithBackend(
        "event",
        event.category,
        event.category,
        event.colors,
        iconForKey(key),
      );
    },
    [openSheetWithBackend],
  );

  return (
    <>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <View
          style={[
            styles.topBar,
            { backgroundColor: colors.surface, borderColor: colors.lightGray },
          ]}
        >
          <View
            style={[
              styles.searchRow,
              {
                backgroundColor: colors.background,
                borderColor: colors.lightGray,
              },
            ]}
          >
            <Ionicons name="search" size={15} color={colors.gray} />
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Search incidents, locations..."
              placeholderTextColor={colors.gray}
              style={[styles.searchInput, { color: colors.text }]}
            />
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.gray }]}>
              Loading discover data...
            </Text>
          </View>
        ) : null}

        {showGlobalEmptyState ? (
          <View style={styles.loadingWrap}>
            <Text style={[styles.emptyText, { color: colors.gray }]}>
              No results found. Try a different search term.
            </Text>
          </View>
        ) : (
          <>
            <View style={{ paddingBottom: 8 }}>
              <SectionHeader title="Trending topics" colors={colors} />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterRow}
              >
                {filterChips.map((chip, idx) => {
                  const isActive = chip.key === activeFilter;
                  return (
                    <TouchableOpacity
                      key={`${chip.key}-${idx}`}
                      onPress={() => setActiveFilter(chip.key)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: isActive
                            ? colors.primary
                            : colors.background,
                          borderColor: isActive ? colors.primary : colors.lightGray,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.chipDot,
                          { backgroundColor: isActive ? "#FFFFFF" : chip.dot },
                        ]}
                      />
                      <Text
                        style={[
                          styles.chipText,
                          { color: isActive ? "#FFFFFF" : colors.text },
                        ]}
                      >
                        {chip.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalRow}
            >
              {filteredTopics.map((item, idx) => (
                <TouchableOpacity
                  key={`${item.id || item.key || item.name}-${idx}`}
                  activeOpacity={0.85}
                  onPress={() => openTopicSheet(item)}
                  style={[
                    styles.topicCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.lightGray,
                    },
                  ]}
                >
                  <GradientPanel colors={item.colors} height={136}>
                    <Ionicons
                      name={iconForKey(item.key)}
                      size={30}
                      color="#FFFFFF"
                      style={styles.topicGlyph}
                    />
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>
                        {item.reports} reports
                      </Text>
                    </View>
                  </GradientPanel>
                  <View style={styles.topicBody}>
                    <Text
                      style={[styles.topicTitle, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text style={[styles.topicSub, { color: colors.gray }]}>
                      {item.subtitle}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
              {filteredTopics.length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.gray }]}>
                  No topic matches your search.
                </Text>
              ) : null}
            </ScrollView>

            <SectionHeader title="Trending locations" colors={colors} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalRow}
            >
              {filteredLocations.map((item, idx) => (
                <TouchableOpacity
                  key={`${item.id || item.name || "loc"}-${idx}`}
                  activeOpacity={0.85}
                  onPress={() => openLocationSheet(item)}
                  style={[
                    styles.locationCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.lightGray,
                    },
                  ]}
                >
                  <GradientPanel colors={item.colors} height={120}>
                    <View style={styles.locationHeroCenter}>
                      <Ionicons
                        name={iconForKey(
                          normalizeLocationKey(item.name || item.topLabel),
                        )}
                        size={26}
                        color="#FFFFFF"
                      />
                      <Text style={styles.locationHeroText}>
                        {item.topLabel}
                      </Text>
                    </View>
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>
                        {item.posts} posts
                      </Text>
                    </View>
                  </GradientPanel>

                  <View style={styles.locationBody}>
                    <Text
                      style={[styles.topicTitle, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <View style={styles.pinRow}>
                      <Ionicons
                        name="location-outline"
                        size={11}
                        color={colors.gray}
                      />
                      <Text
                        style={[styles.topicSub, { color: colors.gray }]}
                        numberOfLines={1}
                      >
                        {item.tags}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
              {filteredLocations.length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.gray }]}>
                  No location matches your search.
                </Text>
              ) : null}
            </ScrollView>

            <SectionHeader title="Events near you" colors={colors} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalRow}
            >
              {filteredEvents.map((event, idx) => (
                <TouchableOpacity
                  key={`${event.id || event.title || "event"}-${idx}`}
                  activeOpacity={0.85}
                  onPress={() => openEventSheet(event)}
                  style={[
                    styles.eventCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.lightGray,
                    },
                  ]}
                >
                  <GradientPanel colors={event.colors} height={112}>
                    <View style={styles.eventCenterLabel}>
                      <Ionicons
                        name={iconForKey(
                          normalizeEventCategoryKey(event.category),
                        )}
                        size={30}
                        color="#FFFFFF"
                        style={styles.topicGlyph}
                      />
                      <Text style={styles.eventCenterText}>{event.label}</Text>
                    </View>

                    <View style={styles.eventCatBadge}>
                      <Text style={styles.eventCatText}>{event.category}</Text>
                    </View>

                    <View
                      style={[
                        styles.eventDateBadge,
                        { backgroundColor: colors.surface },
                      ]}
                    >
                      <Text style={[styles.eventDay, { color: colors.text }]}>
                        {event.day}
                      </Text>
                      <Text style={[styles.eventMonth, { color: colors.gray }]}>
                        {event.month}
                      </Text>
                    </View>
                  </GradientPanel>

                  <View style={styles.eventBody}>
                    <Text
                      style={[styles.eventTitle, { color: colors.text }]}
                      numberOfLines={2}
                    >
                      {event.title}
                    </Text>

                    <View style={styles.pinRow}>
                      <Ionicons
                        name="location-outline"
                        size={11}
                        color={colors.gray}
                      />
                      <Text
                        style={[styles.topicSub, { color: colors.gray }]}
                        numberOfLines={1}
                      >
                        {event.location}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.eventFooter,
                        { borderTopColor: colors.lightGray },
                      ]}
                    >
                      <Text
                        style={[styles.attendingText, { color: colors.text }]}
                      >
                        {event.attending}
                      </Text>
                      <View
                        style={[
                          styles.statusPill,
                          { backgroundColor: event.statusBg },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusPillText,
                            { color: event.statusColor },
                          ]}
                        >
                          {event.status}
                        </Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
              {filteredEvents.length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.gray }]}>
                  No event matches your filters.
                </Text>
              ) : null}
            </ScrollView>
          </>
        )}
      </ScrollView>

      <Modal
        visible={sheetVisible}
        transparent
        animationType="none"
        onRequestClose={closeBottomSheet}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeBottomSheet} />

          <Animated.View
            style={[
              styles.bottomSheet,
              {
                height: SHEET_HEIGHT,
                backgroundColor: colors.surface,
                borderColor: colors.lightGray,
                transform: [{ translateY: sheetTranslateY }],
              },
            ]}
          >
            <View
              style={[
                styles.dragHandle,
                { backgroundColor: colors.gray + "66" },
              ]}
            />

            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetHeaderLeft}>
                <View
                  style={[
                    styles.sheetIcon,
                    {
                      backgroundColor:
                        sheetPayload?.colors?.[0] || colors.primary,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.sheetIconOverlay,
                      {
                        backgroundColor:
                          sheetPayload?.colors?.[1] || colors.secondary,
                      },
                    ]}
                  />
                  <Ionicons
                    name={sheetPayload?.iconName || "location-outline"}
                    size={18}
                    color="#FFFFFF"
                  />
                </View>
                <View style={styles.sheetHeaderTextWrap}>
                  <Text
                    style={[styles.sheetTitle, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {sheetPayload?.title || "Section"}
                  </Text>
                  <Text
                    style={[styles.sheetSubtitle, { color: colors.gray }]}
                    numberOfLines={1}
                  >
                    {sheetPayload?.subtitle || "Updated just now"}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[
                  styles.sheetCloseBtn,
                  { backgroundColor: colors.background },
                ]}
                onPress={closeBottomSheet}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sheetListContent}
            >
              {isSheetLoading ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.loadingText, { color: colors.gray }]}>
                    Loading reports...
                  </Text>
                </View>
              ) : null}

              {!isSheetLoading && (sheetPayload?.posts || []).length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.gray }]}>
                  No verified reports found for this section.
                </Text>
              ) : null}

              {!isSheetLoading &&
                (sheetPayload?.posts || []).map((post, idx) => (
                  <TouchableOpacity
                    key={`${post.title}-${idx}`}
                    activeOpacity={0.85}
                    onPress={() => {
                      if (!post.postId) return;
                      closeBottomSheet();
                      navigation.navigate("PostDetails", {
                        postId: post.postId,
                      });
                    }}
                    style={[
                      styles.sheetPostCard,
                      {
                        borderColor: colors.lightGray,
                        backgroundColor: colors.background,
                      },
                    ]}
                  >
                    <View style={styles.sheetPostTopRow}>
                      <View
                        style={[
                          styles.postThumb,
                          {
                            backgroundColor:
                              sheetPayload?.colors?.[0] || colors.primary,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.postThumbOverlay,
                            {
                              backgroundColor:
                                sheetPayload?.colors?.[1] || colors.secondary,
                            },
                          ]}
                        />
                        <Ionicons
                          name={sheetPayload?.iconName || "newspaper-outline"}
                          size={16}
                          color="#FFFFFF"
                        />
                      </View>

                      <View style={styles.sheetPostTextWrap}>
                        <Text
                          style={[
                            styles.sheetPostTitle,
                            { color: colors.text },
                          ]}
                          numberOfLines={2}
                        >
                          {post.title}
                        </Text>
                        <Text
                          style={[
                            styles.sheetPostSubtitle,
                            { color: colors.gray },
                          ]}
                          numberOfLines={1}
                        >{`${post.area} | ${post.distanceKm.toFixed(1)} km | ${post.timeAgo}`}</Text>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.sheetPostDivider,
                        { backgroundColor: colors.lightGray },
                      ]}
                    />

                    <View style={styles.sheetPostFooter}>
                      <TouchableOpacity style={styles.reactionBtn}>
                        <Ionicons
                          name="thumbs-up-outline"
                          size={14}
                          color={colors.gray}
                        />
                        <Text
                          style={[styles.reactionText, { color: colors.gray }]}
                        >
                          {post.upvotes}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.reactionBtn}>
                        <Ionicons
                          name="thumbs-down-outline"
                          size={14}
                          color={colors.gray}
                        />
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.reactionBtn}>
                        <Ionicons
                          name="flag-outline"
                          size={14}
                          color={colors.gray}
                        />
                        <Text
                          style={[styles.reactionText, { color: colors.gray }]}
                        >
                          Flag
                        </Text>
                      </TouchableOpacity>

                      <View style={styles.footerSpacer} />

                      <View style={styles.credibilityBadge}>
                        <Text
                          style={styles.credibilityText}
                        >{`${post.credibility}% credible`}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandShield: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  brandText: {
    fontSize: 17,
    fontWeight: "700",
  },
  navActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  topBar: {
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 0,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  filterRow: {
    paddingBottom: 10,
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "500",
  },
  sectionHeader: {
    marginTop: 18,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  seeAll: {
    fontSize: 12,
    fontWeight: "500",
  },
  horizontalRow: {
    gap: 12,
    paddingBottom: 2,
  },
  topicCard: {
    width: 130,
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  gradientOverlay: {
    position: "absolute",
    right: -26,
    top: -40,
    width: 130,
    height: 210,
    borderRadius: 80,
    opacity: 0.75,
    transform: [{ rotate: "-18deg" }],
  },
  topicGlyph: {
    alignSelf: "center",
    marginTop: 42,
  },
  countBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  countBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "500",
  },
  topicBody: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  topicTitle: {
    fontSize: 12,
    fontWeight: "500",
  },
  topicSub: {
    fontSize: 11,
    marginTop: 2,
  },
  locationCard: {
    width: 160,
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  locationHeroCenter: {
    alignItems: "center",
    marginTop: 30,
  },
  locationHeroText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "500",
    marginTop: 4,
  },
  locationBody: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 3,
  },
  eventCard: {
    width: 200,
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  eventCenterLabel: {
    alignItems: "center",
    marginTop: 28,
  },
  eventCenterText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "500",
    marginTop: 2,
  },
  eventCatBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  eventCatText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "500",
  },
  eventDateBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
    alignItems: "center",
  },
  eventDay: {
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 16,
  },
  eventMonth: {
    fontSize: 10,
    marginTop: 1,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  eventBody: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  eventTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "500",
  },
  eventFooter: {
    marginTop: 8,
    paddingTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
  },
  attendingText: {
    fontSize: 11,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: "500",
  },
  loadingWrap: {
    paddingVertical: 12,
    alignItems: "center",
    gap: 6,
  },
  loadingText: {
    fontSize: 12,
  },
  emptyText: {
    fontSize: 12,
    alignSelf: "center",
    paddingVertical: 12,
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  bottomSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
  },
  dragHandle: {
    width: 46,
    height: 5,
    borderRadius: 6,
    alignSelf: "center",
    marginBottom: 10,
  },
  sheetHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sheetHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 10,
  },
  sheetIcon: {
    width: 38,
    height: 38,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  sheetIconOverlay: {
    position: "absolute",
    width: 42,
    height: 42,
    right: -10,
    top: -14,
    borderRadius: 21,
    opacity: 0.7,
  },
  sheetHeaderTextWrap: {
    flex: 1,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  sheetSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  sheetCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetListContent: {
    paddingBottom: 30,
  },
  sheetPostCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  sheetPostTopRow: {
    flexDirection: "row",
    gap: 10,
  },
  postThumb: {
    width: 42,
    height: 42,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  postThumbOverlay: {
    position: "absolute",
    width: 46,
    height: 46,
    right: -10,
    top: -14,
    borderRadius: 23,
    opacity: 0.75,
  },
  sheetPostTextWrap: {
    flex: 1,
  },
  sheetPostTitle: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  sheetPostSubtitle: {
    marginTop: 3,
    fontSize: 11,
  },
  sheetPostDivider: {
    height: 1,
    marginTop: 9,
    marginBottom: 8,
  },
  sheetPostFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  reactionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  reactionText: {
    fontSize: 11,
    fontWeight: "500",
  },
  footerSpacer: {
    flex: 1,
  },
  credibilityBadge: {
    backgroundColor: "#1D9E7520",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  credibilityText: {
    color: "#1D9E75",
    fontSize: 10,
    fontWeight: "700",
  },
});
