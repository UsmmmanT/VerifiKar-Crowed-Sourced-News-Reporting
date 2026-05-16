import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    Image,
    Modal,
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

const SCREEN_WIDTH = Dimensions.get("window").width;

function formatTime(value) {
  if (!value) return "Unknown time";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function mediaUrlOf(media) {
  if (!media) return "";
  if (typeof media === "string") return media;
  return media.media_url || media.storage_url || "";
}

function mediaTypeOf(media) {
  if (!media || typeof media === "string") return "image";
  return (media.media_type || "image").toString().toLowerCase();
}

function categoryColor(category) {
  const key = (category || "").toLowerCase();
  if (key.includes("fire")) return "#D85A30";
  if (key.includes("traffic")) return "#BA7517";
  if (key.includes("accident")) return "#185FA5";
  if (key.includes("crime")) return "#534AB7";
  if (key.includes("rescue")) return "#0F6E56";
  if (key.includes("protest")) return "#993556";
  if (key.includes("disaster")) return "#A32D2D";
  if (key.includes("infra")) return "#3B6D11";
  if (key.includes("outage")) return "#5F5E5A";
  return "#6B7280";
}

function categoryIcon(category) {
  const categoryIcons = {
    Accident: "car",
    Crime: "alert-circle",
    Infrastructure: "construct",
    Social: "people",
    Emergency: "warning",
    Weather: "thunderstorm",
    Fire: "flame",
    Protest: "megaphone",
    Traffic: "car-sport",
    Health: "medkit",
    Disaster: "alert-outline",
    "Natural Disaster": "earth",
    Flood: "water",
    Earthquake: "pulse",
  };
  return categoryIcons[category] || "alert-circle";
}

function credibilityColor(score) {
  if (score >= 0.8) return "#2ECC71";
  if (score >= 0.6) return "#F39C12";
  return "#E74C3C";
}

function hoursSince(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.round((Date.now() - ts) / 3600000));
}

function compactDuration(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return "0h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem ? `${days}d ${rem}h` : `${days}d`;
}

async function interactWithPost(postId, interactionType) {
  let token = await AsyncStorage.getItem("authToken");
  if (token) token = token.trim();
  if (!token) {
    throw new Error("Authentication required. Please log in again.");
  }

  const response = await fetch(`${API_BASE_URL}/posts/${postId}/interact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ interaction_type: interactionType }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const msg =
      data?.detail?.details?.message ||
      data?.detail ||
      `Failed to ${interactionType} post`;
    throw new Error(
      typeof msg === "string" ? msg : `Failed to ${interactionType} post`,
    );
  }

  return data;
}

const PostInteractionBar = memo(
  ({ postId, initialUpvotes, initialDownvotes, colors, onError }) => {
    const [isUpvoted, setIsUpvoted] = useState(false);
    const [isDownvoted, setIsDownvoted] = useState(false);
    const [upvotes, setUpvotes] = useState(initialUpvotes || 0);
    const [downvotes, setDownvotes] = useState(initialDownvotes || 0);
    const requestIdRef = useRef(0);

    const upScale = useRef(new Animated.Value(1)).current;
    const downScale = useRef(new Animated.Value(1)).current;

    const animate = (v) => {
      Animated.sequence([
        Animated.timing(v, {
          toValue: 0.88,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.timing(v, { toValue: 1, duration: 90, useNativeDriver: true }),
      ]).start();
    };

    const fmt = (count) => {
      if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
      if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
      return count > 0 ? String(count) : "";
    };

    const handleUpvote = async () => {
      animate(upScale);
      const req = ++requestIdRef.current;
      const prev = { isUpvoted, isDownvoted, upvotes, downvotes };

      if (isUpvoted) {
        setIsUpvoted(false);
        setUpvotes((v) => Math.max(0, v - 1));
      } else {
        setIsUpvoted(true);
        setUpvotes((v) => v + 1);
        if (isDownvoted) {
          setIsDownvoted(false);
          setDownvotes((v) => Math.max(0, v - 1));
        }
      }

      try {
        const res = await interactWithPost(postId, "upvote");
        if (req === requestIdRef.current && res?.success) {
          setUpvotes(Number(res.details?.new_upvotes || 0));
          setDownvotes(Number(res.details?.new_downvotes || 0));
        }
      } catch (e) {
        if (req === requestIdRef.current) {
          setIsUpvoted(prev.isUpvoted);
          setIsDownvoted(prev.isDownvoted);
          setUpvotes(prev.upvotes);
          setDownvotes(prev.downvotes);
          onError?.(e.message);
        }
      }
    };

    const handleDownvote = async () => {
      animate(downScale);
      const req = ++requestIdRef.current;
      const prev = { isUpvoted, isDownvoted, upvotes, downvotes };

      if (isDownvoted) {
        setIsDownvoted(false);
        setDownvotes((v) => Math.max(0, v - 1));
      } else {
        setIsDownvoted(true);
        setDownvotes((v) => v + 1);
        if (isUpvoted) {
          setIsUpvoted(false);
          setUpvotes((v) => Math.max(0, v - 1));
        }
      }

      try {
        const res = await interactWithPost(postId, "downvote");
        if (req === requestIdRef.current && res?.success) {
          setUpvotes(Number(res.details?.new_upvotes || 0));
          setDownvotes(Number(res.details?.new_downvotes || 0));
        }
      } catch (e) {
        if (req === requestIdRef.current) {
          setIsUpvoted(prev.isUpvoted);
          setIsDownvoted(prev.isDownvoted);
          setUpvotes(prev.upvotes);
          setDownvotes(prev.downvotes);
          onError?.(e.message);
        }
      }
    };

    const upColor = isUpvoted ? "#00BA7C" : colors.gray;
    const downColor = isDownvoted ? "#F91880" : colors.gray;

    return (
      <View style={styles.actionBar}>
        <Animated.View style={{ transform: [{ scale: upScale }] }}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleUpvote}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isUpvoted ? "thumbs-up" : "thumbs-up-outline"}
              size={20}
              color={upColor}
            />
            <Text style={[styles.actionCount, { color: upColor }]}>
              {fmt(upvotes)}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        <Animated.View style={{ transform: [{ scale: downScale }] }}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleDownvote}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isDownvoted ? "thumbs-down" : "thumbs-down-outline"}
              size={20}
              color={downColor}
            />
            <Text style={[styles.actionCount, { color: downColor }]}>
              {fmt(downvotes)}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  },
);

const PostFlagButton = memo(
  ({ postId, initialFlags = 0, initialUserFlagged = false, onError }) => {
    const [isFlagged, setIsFlagged] = useState(initialUserFlagged);
    const [flags, setFlags] = useState(initialFlags || 0);
    const requestIdRef = useRef(0);
    const flagScale = useRef(new Animated.Value(1)).current;

    const animate = (v) => {
      Animated.sequence([
        Animated.timing(v, {
          toValue: 0.9,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.timing(v, { toValue: 1, duration: 90, useNativeDriver: true }),
      ]).start();
    };

    const handleFlag = async () => {
      animate(flagScale);
      const req = ++requestIdRef.current;
      const prev = { isFlagged, flags };

      if (isFlagged) {
        setIsFlagged(false);
        setFlags((v) => Math.max(0, v - 1));
      } else {
        setIsFlagged(true);
        setFlags((v) => v + 1);
      }

      try {
        const res = await interactWithPost(postId, "flag");
        if (req === requestIdRef.current && res?.success) {
          setFlags(Number(res.details?.new_flags || 0));
        }
      } catch (e) {
        if (req === requestIdRef.current) {
          setIsFlagged(prev.isFlagged);
          setFlags(prev.flags);
          onError?.(e.message);
        }
      }
    };

    const isActive = isFlagged;
    const iconColor = isActive ? "#B91C1C" : "#DC2626";

    return (
      <Animated.View style={{ transform: [{ scale: flagScale }] }}>
        <TouchableOpacity
          style={[
            styles.prominentFlagButton,
            {
              backgroundColor: isActive ? "#FEE2E2" : "#FEE2E2",
              borderColor: isActive ? "#FCA5A5" : "#FECACA",
            },
          ]}
          onPress={handleFlag}
          activeOpacity={0.75}
        >
          <Ionicons
            name={isFlagged ? "flag" : "flag-outline"}
            size={16}
            color={iconColor}
          />
          <Text style={[styles.prominentFlagText, { color: iconColor }]}>
            Flag
          </Text>
        </TouchableOpacity>
      </Animated.View>
    );
  },
);

export default function PostDetailsScreen({ route }) {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const postId = route?.params?.postId;
  const focusComment = route?.params?.focusComment === true;

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [post, setPost] = useState(null);
  const [error, setError] = useState("");
  const [commentText, setCommentText] = useState("");
  const [categoryModal, setCategoryModal] = useState({
    visible: false,
    category: "General",
    score: 0,
  });
  const [locationModal, setLocationModal] = useState({
    visible: false,
    lat: 0,
    lon: 0,
  });
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [mediaWidth, setMediaWidth] = useState(SCREEN_WIDTH - 88);
  const scrollRef = useRef(null);
  const commentInputRef = useRef(null);
  const commentsYRef = useRef(0);
  const didAutoFocusRef = useRef(false);

  const handleNavigateFromLocationModal = useCallback(() => {
    const destination = {
      latitude: Number(locationModal.lat),
      longitude: Number(locationModal.lon),
      address: "Incident Coordinates",
    };

    if (
      !Number.isFinite(destination.latitude) ||
      !Number.isFinite(destination.longitude)
    ) {
      return;
    }

    setLocationModal((prev) => ({ ...prev, visible: false }));
    navigation.navigate("MainTabs", {
      screen: "Navigate",
      params: { destination },
    });
  }, [locationModal.lat, locationModal.lon, navigation]);

  const loadPost = useCallback(async () => {
    if (!postId) {
      setError("Missing post ID");
      setIsLoading(false);
      return;
    }

    try {
      setError("");
      const token = await AsyncStorage.getItem("authToken");
      const response = await fetch(`${API_BASE_URL}/posts/${postId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await response.json();
      if (!response.ok || !data?.success || !data?.details?.post) {
        setPost(null);
        setError("Post details not available.");
        return;
      }
      setPost(data.details.post);
    } catch {
      setPost(null);
      setError("Failed to load post details.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [postId]);

  useEffect(() => {
    setIsLoading(true);
    loadPost();
  }, [loadPost]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadPost();
  }, [loadPost]);

  const submitComment = useCallback(async () => {
    const content = commentText.trim();
    if (!content || !postId || isSubmittingComment) return;

    try {
      setIsSubmittingComment(true);
      setError("");
      const token = await AsyncStorage.getItem("authToken");
      const response = await fetch(`${API_BASE_URL}/posts/${postId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content }),
      });

      const data = await response.json();
      if (!response.ok || !data?.success) {
        setError("Unable to add comment.");
        return;
      }

      setCommentText("");
      await loadPost();
    } catch {
      setError("Unable to add comment.");
    } finally {
      setIsSubmittingComment(false);
    }
  }, [commentText, isSubmittingComment, loadPost, postId]);

  const mediaItems = useMemo(() => post?.media_items || [], [post]);
  const replies = useMemo(() => post?.replies || [], [post]);
  const credibility = Number(post?.credibility_score || 0);
  const credibilityPct = Math.round(credibility * 100);
  const contributorCount =
    Number(post?.contributor_count || post?.contributors_count || 0) || 0;
  const activeSinceHours = hoursSince(post?.created_at);
  const clusterId = post?.cluster_id || "UNCLUSTERED";

  const credibilityBreakdown = useMemo(() => {
    const text = Math.max(0, Math.min(100, credibilityPct + 4));
    const media = Math.max(0, Math.min(100, credibilityPct - 8));
    const community = Math.max(0, Math.min(100, credibilityPct + 2));
    return [
      { label: "Text consistency", value: text, color: "#3dd68c" },
      { label: "Media authenticity", value: media, color: "#f0a04a" },
      { label: "Community votes", value: community, color: "#4a9eff" },
    ];
  }, [credibilityPct]);

  const trendPoints = useMemo(() => {
    const base = Math.max(20, credibilityPct - 18);
    return [
      base,
      base + 4,
      base + 8,
      base + 10,
      base + 14,
      base + 17,
      credibilityPct,
    ].map((v) => Math.max(0, Math.min(100, v)));
  }, [credibilityPct]);

  const trendLabels = useMemo(
    () => ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00"],
    [],
  );

  const trendTicks = useMemo(() => [100, 80, 60, 40, 20, 0], []);

  const contributionBars = useMemo(() => {
    const base = Math.max(1, Math.min(8, Math.ceil(contributorCount / 4)));
    return [1, 2, 1, 3, 2, 3, base, Math.max(2, base - 1)];
  }, [contributorCount]);

  const contributionLabels = useMemo(
    () => ["08", "09", "10", "11", "12", "13", "14", "15"],
    [],
  );

  const contributionMax = useMemo(
    () => Math.max(4, ...contributionBars),
    [contributionBars],
  );

  const contributionTicks = useMemo(
    () => [
      contributionMax,
      Math.ceil(contributionMax * 0.75),
      Math.ceil(contributionMax * 0.5),
      Math.ceil(contributionMax * 0.25),
      0,
    ],
    [contributionMax],
  );

  const fusionSignals = useMemo(() => {
    return [
      {
        label: "Semantic similarity",
        value: Math.max(0, Math.min(100, credibilityPct + 3)),
      },
      {
        label: "Visual similarity",
        value: Math.max(0, Math.min(100, credibilityPct - 9)),
      },
      {
        label: "Geo proximity",
        value: Math.max(0, Math.min(100, credibilityPct + 8)),
      },
      {
        label: "Temporal recency",
        value: Math.max(0, Math.min(100, credibilityPct - 3)),
      },
      {
        label: "Category match",
        value: Math.max(0, Math.min(100, credibilityPct + 5)),
      },
    ];
  }, [credibilityPct]);

  const showCategoryInfo = useCallback(() => {
    if (!post) return;
    setCategoryModal({
      visible: true,
      category: post.event_category || "General",
      score: Number(post.credibility_score || 0) || 0,
    });
  }, [post]);

  const showLocationInfo = useCallback(() => {
    if (!post) return;
    setLocationModal({
      visible: true,
      lat: Number(post.location_lat || 0),
      lon: Number(post.location_lon || 0),
    });
  }, [post]);

  const onMediaScroll = useCallback(
    (event) => {
      if (!mediaWidth) return;
      const x = event.nativeEvent.contentOffset.x;
      const index = Math.round(x / mediaWidth);
      setCurrentMediaIndex(index);
    },
    [mediaWidth],
  );

  useEffect(() => {
    setCurrentMediaIndex(0);
  }, [postId, mediaItems.length]);

  useEffect(() => {
    didAutoFocusRef.current = false;
  }, [postId, focusComment]);

  useEffect(() => {
    if (!focusComment || isLoading || !post || didAutoFocusRef.current) return;
    didAutoFocusRef.current = true;

    const t = setTimeout(() => {
      const y = Math.max(0, commentsYRef.current - 12);
      scrollRef.current?.scrollTo({ y, animated: true });
      commentInputRef.current?.focus();
    }, 220);

    return () => clearTimeout(t);
  }, [focusComment, isLoading, post]);

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.gray }]}>
              Loading post details...
            </Text>
          </View>
        ) : null}

        {!isLoading && error ? (
          <View
            style={[
              styles.errorCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.errorText, { color: "#d32f2f" }]}>
              {error}
            </Text>
          </View>
        ) : null}

        {!isLoading && post ? (
          <>
            <View
              style={[
                styles.heroCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.postHeaderRow}>
                <View style={styles.postMeta}>
                  <TouchableOpacity
                    style={[
                      styles.catIcon,
                      {
                        backgroundColor: categoryColor(post.event_category) + "25",
                        borderColor: categoryColor(post.event_category) + "55",
                      },
                    ]}
                    onPress={showCategoryInfo}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={categoryIcon(post.event_category)}
                      size={18}
                      color={categoryColor(post.event_category)}
                    />
                  </TouchableOpacity>
                  <View>
                    <Text
                      style={[
                        styles.catName,
                        { color: categoryColor(post.event_category) },
                      ]}
                    >
                      {post.event_category || "General"}
                    </Text>
                    <Text style={[styles.postTime, { color: colors.gray }]}>
                      {formatTime(post.created_at)}
                    </Text>
                  </View>
                </View>

                <PostFlagButton
                  postId={post.id}
                  initialFlags={post.flags || 0}
                  initialUserFlagged={post.user_flagged || false}
                  onError={(msg) => Alert.alert("Interaction Error", msg)}
                />
              </View>

              <Text style={[styles.postContent, { color: colors.text }]}>
                {post.content}
              </Text>

              <TouchableOpacity onPress={showLocationInfo} activeOpacity={0.7}>
                <View
                  style={[
                    styles.locationPill,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons name="location" size={13} color="#4A9EFF" />
                  <Text style={styles.locationPillText}>
                    {Number(post.location_lat || 0).toFixed(4)}, {" "}
                    {Number(post.location_lon || 0).toFixed(4)}
                  </Text>
                  <Ionicons name="chevron-forward" size={12} color="#4A9EFF" />
                </View>
              </TouchableOpacity>

              {mediaItems.length > 0 ? (
                <View
                  style={styles.mediaTopWrap}
                  onLayout={(e) => {
                    const w = e.nativeEvent.layout.width;
                    if (w > 0) setMediaWidth(w);
                  }}
                >
                  <ScrollView
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onScroll={onMediaScroll}
                    scrollEventThrottle={16}
                  >
                    {mediaItems.map((media, idx) => {
                      const url = mediaUrlOf(media);
                      const type = mediaTypeOf(media);
                      const isImage = type.includes("image");
                      return (
                        <View
                          key={`${url || "media"}-${idx}`}
                          style={[styles.mediaSlide, { width: mediaWidth }]}
                        >
                          {isImage && !!url ? (
                            <Image
                              source={{ uri: url }}
                              style={styles.mediaImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <View
                              style={[
                                styles.mediaFallback,
                                {
                                  backgroundColor: colors.background,
                                  borderColor: colors.border,
                                },
                              ]}
                            >
                              <Ionicons
                                name="videocam-outline"
                                size={20}
                                color="#4A9EFF"
                              />
                              <Text style={[styles.mediaType, { color: colors.gray }]}>
                                {type}
                              </Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>

                  {mediaItems.length > 1 ? (
                    <View style={styles.mediaCounter}>
                      <Text style={styles.mediaCounterText}>
                        {Math.min(currentMediaIndex + 1, mediaItems.length)}/
                        {mediaItems.length}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <PostInteractionBar
                postId={post.id}
                initialUpvotes={post.upvotes || 0}
                initialDownvotes={post.downvotes || 0}
                colors={colors}
                onError={(msg) => Alert.alert("Interaction Error", msg)}
              />

              {post.parent_post ? (
                <View
                  style={[
                    styles.parentWrap,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.parentLabel, { color: "#A78BFA" }]}> 
                    Parent Post
                  </Text>
                  <Text
                    style={[styles.parentText, { color: colors.text }]}
                    numberOfLines={3}
                  >
                    {post.parent_post.content}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.clusterBanner}>
              <View style={styles.clusterBannerIcon}>
                <Ionicons name="git-network" size={16} color="#4A9EFF" />
              </View>
              <View style={styles.clusterBannerTextWrap}>
                <Text style={styles.clusterBannerTitle}>Cluster Intelligence</Text>
                <Text style={styles.clusterBannerSub}>
                  This post belongs to an active incident cluster
                </Text>
              </View>
              <Text style={styles.clusterBadge}>#{String(clusterId)}</Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: "#3DD68C" }]}>
                  {credibilityPct}%
                </Text>
                <Text style={styles.statLabel}>Credibility</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: "#4A9EFF" }]}>
                  {contributorCount}
                </Text>
                <Text style={styles.statLabel}>Contributors</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: "#F0A04A" }]}>
                  {compactDuration(activeSinceHours)}
                </Text>
                <Text style={styles.statLabel}>Active Since</Text>
              </View>
            </View>

            <View
              style={[
                styles.infoSectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={styles.sectionHead}>Credibility Breakdown</Text>
              <View style={styles.credibilityWrap}>
                <View
                  style={[
                    styles.credibilityDonut,
                    { borderColor: credibilityColor(credibility) },
                  ]}
                >
                  <Text style={styles.credibilityDonutValue}>{credibilityPct}</Text>
                  <Text style={styles.credibilityDonutUnit}>/100</Text>
                </View>

                <View style={styles.credibilityBarsWrap}>
                  {credibilityBreakdown.map((item) => (
                    <View key={item.label} style={styles.breakdownRow}>
                      <View style={styles.breakdownLabelRow}>
                        <Text style={styles.breakdownLabel}>{item.label}</Text>
                        <Text style={[styles.breakdownValue, { color: item.color }]}>
                          {item.value}%
                        </Text>
                      </View>
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${item.value}%`, backgroundColor: item.color },
                          ]}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            <View
              style={[
                styles.infoSectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={styles.sectionHead}>Credibility Trend</Text>
              <View style={styles.chartFrame}>
                <View style={styles.yAxisWrap}>
                  {trendTicks.map((tick) => (
                    <Text key={`trend-tick-${tick}`} style={styles.yAxisLabel}>
                      {tick}
                    </Text>
                  ))}
                </View>

                <View style={styles.plotAreaWrap}>
                  <View style={styles.gridLinesWrap}>
                    {trendTicks.map((tick, index) => (
                      <View
                        key={`trend-grid-${tick}-${index}`}
                        style={styles.gridLine}
                      />
                    ))}
                  </View>

                  <View style={styles.barsWrap}>
                    {trendPoints.map((point, index) => (
                      <View key={`trend-bar-${index}`} style={styles.barCol}>
                        <View
                          style={[
                            styles.trendBar,
                            { height: `${Math.max(6, point)}%` },
                          ]}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              <View style={styles.xAxisOffsetRow}>
                {trendLabels.map((label, index) => (
                  <Text key={`trend-x-${index}`} style={styles.xAxisLabel}>
                    {label}
                  </Text>
                ))}
              </View>
            </View>

            <View
              style={[
                styles.infoSectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={styles.sectionHead}>Contribution Activity</Text>
              <Text style={styles.sectionSub}>Reports added to this cluster over time</Text>
              <View style={styles.chartFrame}>
                <View style={styles.yAxisWrapCompact}>
                  {contributionTicks.map((tick, index) => (
                    <Text key={`contrib-tick-${index}`} style={styles.yAxisLabel}>
                      {tick}
                    </Text>
                  ))}
                </View>

                <View style={styles.plotAreaWrapCompact}>
                  <View style={styles.gridLinesWrapCompact}>
                    {contributionTicks.map((tick, index) => (
                      <View
                        key={`contrib-grid-${tick}-${index}`}
                        style={styles.gridLine}
                      />
                    ))}
                  </View>

                  <View style={styles.barsWrap}>
                    {contributionBars.map((point, index) => (
                      <View key={`contrib-bar-${index}`} style={styles.barCol}>
                        <View
                          style={[
                            styles.contribBar,
                            {
                              height: `${Math.max(
                                8,
                                Math.round((point / contributionMax) * 100),
                              )}%`,
                            },
                          ]}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              <View style={styles.xAxisOffsetRow}>
                {contributionLabels.map((label, index) => (
                  <Text key={`contrib-x-${index}`} style={styles.xAxisLabel}>
                    {label}:00
                  </Text>
                ))}
              </View>
            </View>

            <View
              style={[
                styles.infoSectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={styles.sectionHead}>Cluster Fusion Signals</Text>
              {fusionSignals.map((signal) => (
                <View key={signal.label} style={styles.signalRow}>
                  <Text style={styles.signalLabel}>{signal.label}</Text>
                  <View style={styles.signalTrack}>
                    <View
                      style={[styles.signalFill, { width: `${signal.value}%` }]}
                    />
                  </View>
                  <Text style={styles.signalValue}>{signal.value}%</Text>
                </View>
              ))}
            </View>

            <View
              style={[
                styles.infoSectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={styles.sectionHead}>Cluster Event Timeline</Text>
              <View style={styles.timelineWrap}>
                <View style={styles.timelineItem}>
                  <View style={[styles.timelineDot, { backgroundColor: "#4A9EFF" }]} />
                  <View style={styles.timelineBody}>
                    <Text style={styles.timelineTime}>Initial report</Text>
                    <Text style={styles.timelineText}>
                      First related report created in this area.
                    </Text>
                  </View>
                </View>
                <View style={styles.timelineItem}>
                  <View style={[styles.timelineDot, { backgroundColor: "#F0A04A" }]} />
                  <View style={styles.timelineBody}>
                    <Text style={styles.timelineTime}>Cluster formed</Text>
                    <Text style={styles.timelineText}>
                      Multiple corroborating reports were merged.
                    </Text>
                  </View>
                </View>
                <View style={styles.timelineItem}>
                  <View style={[styles.timelineDot, { backgroundColor: "#3DD68C" }]} />
                  <View style={styles.timelineBody}>
                    <Text style={styles.timelineTime}>Post generated</Text>
                    <Text style={styles.timelineText}>
                      AI-generated summary was published with confidence signals.
                    </Text>
                  </View>
                </View>
                <View style={styles.timelineItem}>
                  <View style={[styles.timelineDot, { backgroundColor: "#E05C3A" }]} />
                  <View style={styles.timelineBody}>
                    <Text style={styles.timelineTime}>Current update</Text>
                    <Text style={styles.timelineText}>{post.content}</Text>
                  </View>
                </View>
              </View>
            </View>

            <View
              style={[
                styles.commentsCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              onLayout={(event) => {
                commentsYRef.current = event.nativeEvent.layout.y;
              }}
            >
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Comments ({replies.length})
              </Text>
              <View style={styles.commentComposerRow}>
                <TextInput
                  ref={commentInputRef}
                  style={[
                    styles.commentInput,
                    {
                      color: colors.text,
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                  placeholder="Write a comment"
                  placeholderTextColor={colors.gray}
                  value={commentText}
                  onChangeText={setCommentText}
                  multiline
                />
                <TouchableOpacity
                  style={[
                    styles.commentBtn,
                    {
                      backgroundColor: isSubmittingComment
                        ? colors.gray
                        : colors.primary,
                    },
                  ]}
                  onPress={submitComment}
                  disabled={isSubmittingComment || !commentText.trim()}
                >
                  {isSubmittingComment ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="send" size={16} color="#fff" />
                  )}
                </TouchableOpacity>
              </View>

              {replies.length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.gray }]}>
                  No comments yet.
                </Text>
              ) : (
                replies.map((reply) => (
                  <View
                    key={reply.id}
                    style={[
                      styles.replyCard,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.contentText, { color: colors.text }]}>
                      {reply.content}
                    </Text>
                    <Text style={[styles.replyMeta, { color: colors.gray }]}>
                      {formatTime(reply.created_at)}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </>
        ) : null}
      </ScrollView>

      <Modal
        visible={categoryModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setCategoryModal((prev) => ({ ...prev, visible: false }))
        }
      >
        <TouchableOpacity
          style={styles.infoOverlay}
          activeOpacity={1}
          onPress={() =>
            setCategoryModal((prev) => ({ ...prev, visible: false }))
          }
        >
          <View style={[styles.infoCard, { backgroundColor: colors.surface }]}>
            <View style={styles.credibilityCircleContainer}>
              <View
                style={[
                  styles.credibilityCircle,
                  {
                    borderColor: categoryColor(categoryModal.category),
                    backgroundColor:
                      categoryColor(categoryModal.category) + "15",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.credibilityPercentage,
                    { color: categoryColor(categoryModal.category) },
                  ]}
                >
                  {Math.round(categoryModal.score * 100)}%
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.credibilityLabelBadge,
                {
                  backgroundColor: categoryColor(categoryModal.category) + "20",
                },
              ]}
            >
              <Ionicons
                name="shield-checkmark"
                size={16}
                color={categoryColor(categoryModal.category)}
              />
              <Text
                style={[
                  styles.credibilityLabel,
                  { color: categoryColor(categoryModal.category) },
                ]}
              >
                High Credibility
              </Text>
            </View>

            <Text
              style={[styles.credibilityDescription, { color: colors.gray }]}
            >
              This score is calculated using AI analysis of media authenticity,
              content verification, and community feedback.
            </Text>

            <Text style={[styles.credibilityHint, { color: colors.gray }]}>
              Tap anywhere to dismiss
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={locationModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setLocationModal((prev) => ({ ...prev, visible: false }))
        }
      >
        <TouchableOpacity
          style={styles.infoOverlay}
          activeOpacity={1}
          onPress={() =>
            setLocationModal((prev) => ({ ...prev, visible: false }))
          }
        >
          <View
            style={[
              styles.locationInfoCard,
              { backgroundColor: colors.surface },
            ]}
          >
            <View
              style={[
                styles.locationIconCircle,
                { backgroundColor: colors.primary + "15" },
              ]}
            >
              <Ionicons name="location" size={30} color={colors.primary} />
            </View>

            <Text style={[styles.locationTitle, { color: colors.text }]}>
              Incident Coordinates
            </Text>

            <View
              style={[
                styles.coordinatesContainer,
                { backgroundColor: colors.border + "50" },
              ]}
            >
              <View style={styles.coordinateRow}>
                <Text style={[styles.coordinateLabel, { color: colors.gray }]}>
                  Latitude
                </Text>
                <Text style={[styles.coordinateValue, { color: colors.text }]}>
                  {locationModal.lat.toFixed(6)}°
                </Text>
              </View>
              <View
                style={[
                  styles.coordinateDivider,
                  { backgroundColor: colors.border },
                ]}
              />
              <View style={styles.coordinateRow}>
                <Text style={[styles.coordinateLabel, { color: colors.gray }]}>
                  Longitude
                </Text>
                <Text style={[styles.coordinateValue, { color: colors.text }]}>
                  {locationModal.lon.toFixed(6)}°
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.locationRouteButton,
                { backgroundColor: colors.primary },
              ]}
              onPress={handleNavigateFromLocationModal}
              activeOpacity={0.85}
            >
              <Ionicons name="navigate" size={14} color="#fff" />
              <Text style={styles.locationRouteButtonText}>1 meters away</Text>
            </TouchableOpacity>

            <Text
              style={[
                styles.credibilityHint,
                { color: colors.gray, marginTop: 16 },
              ]}
            >
              Tap anywhere to dismiss
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f0f" },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
    gap: 12,
  },
  loadingWrap: { alignItems: "center", paddingVertical: 20, gap: 8 },
  loadingText: { fontSize: 13 },
  errorCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  heroCard: {
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
    padding: 14,
  },
  infoSectionCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
  },
  postHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 10,
  },
  postMeta: { flexDirection: "row", alignItems: "center", gap: 10 },
  catIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  catName: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.1,
  },
  postTime: {
    fontSize: 11,
    marginTop: 2,
  },
  postContent: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  mediaTopWrap: {
    marginTop: 10,
    borderRadius: 14,
    overflow: "hidden",
  },
  mediaSlide: {
    borderRadius: 14,
    overflow: "hidden",
  },
  mediaImage: { width: "100%", height: 210 },
  mediaFallback: {
    height: 210,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  mediaType: { fontSize: 12 },
  mediaCounter: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  mediaCounterText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  category: { fontSize: 14, fontWeight: "700" },
  dot: { fontSize: 12 },
  contentText: { fontSize: 14, lineHeight: 20 },
  locationPill: {
    marginTop: 8,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  locationPillText: { fontSize: 12, color: "#4A9EFF", fontWeight: "600" },
  locationText: { fontSize: 11, fontWeight: "600" },
  timeText: { fontSize: 12 },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 18,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  actionCount: {
    fontSize: 13,
    fontWeight: "700",
  },
  prominentFlagButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  prominentFlagText: {
    fontSize: 12,
    fontWeight: "700",
  },
  clusterBanner: {
    backgroundColor: "rgba(74,158,255,0.08)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(74,158,255,0.24)",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  clusterBannerIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(74,158,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  clusterBannerTextWrap: { flex: 1 },
  clusterBannerTitle: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#4A9EFF",
    fontWeight: "800",
  },
  clusterBannerSub: {
    marginTop: 2,
    fontSize: 12,
    color: "#8a8a8a",
  },
  clusterBadge: {
    fontSize: 10,
    color: "#8a8a8a",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statBox: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingVertical: 12,
    alignItems: "center",
  },
  statValue: {
    fontSize: 21,
    fontWeight: "800",
  },
  statLabel: {
    marginTop: 4,
    fontSize: 10,
    color: "#8a8a8a",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionHead: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#9b9b9b",
    fontWeight: "800",
    marginBottom: 10,
  },
  sectionSub: {
    fontSize: 11,
    color: "#8a8a8a",
    marginBottom: 10,
  },
  credibilityWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  credibilityDonut: {
    width: 98,
    height: 98,
    borderRadius: 49,
    borderWidth: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(61,214,140,0.08)",
  },
  credibilityDonutValue: {
    fontSize: 24,
    fontWeight: "800",
    color: "#3dd68c",
    lineHeight: 26,
  },
  credibilityDonutUnit: {
    fontSize: 10,
    color: "#8a8a8a",
  },
  credibilityBarsWrap: { flex: 1, gap: 10 },
  breakdownRow: { gap: 4 },
  breakdownLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  breakdownLabel: { fontSize: 12, color: "#a8a8a8" },
  breakdownValue: { fontSize: 12, fontWeight: "700" },
  progressTrack: {
    height: 5,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 99,
  },
  chartFrame: {
    flexDirection: "row",
    alignItems: "stretch",
    marginTop: 2,
    minHeight: 130,
  },
  yAxisWrap: {
    width: 34,
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingRight: 6,
  },
  yAxisWrapCompact: {
    width: 34,
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingRight: 6,
  },
  yAxisLabel: {
    fontSize: 10,
    color: "#8a8a8a",
  },
  plotAreaWrap: {
    flex: 1,
    minHeight: 130,
    justifyContent: "flex-end",
  },
  plotAreaWrapCompact: {
    flex: 1,
    minHeight: 120,
    justifyContent: "flex-end",
  },
  gridLinesWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },
  gridLinesWrapCompact: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },
  gridLine: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  barsWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    flex: 1,
    gap: 8,
    paddingBottom: 2,
  },
  barCol: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  trendBar: {
    width: "100%",
    borderRadius: 7,
    backgroundColor: "rgba(240,160,74,0.95)",
  },
  contribBar: {
    width: "100%",
    borderRadius: 7,
    backgroundColor: "rgba(74,158,255,0.9)",
  },
  xAxisOffsetRow: {
    marginLeft: 34,
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  xAxisLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 9,
    color: "#8a8a8a",
  },
  signalRow: {
    marginBottom: 10,
  },
  signalLabel: {
    fontSize: 12,
    color: "#9f9f9f",
    marginBottom: 4,
  },
  signalTrack: {
    height: 7,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  signalFill: {
    height: "100%",
    borderRadius: 99,
    backgroundColor: "rgba(167,139,250,0.95)",
  },
  signalValue: {
    marginTop: 2,
    alignSelf: "flex-end",
    fontSize: 11,
    color: "#a78bfa",
    fontWeight: "700",
  },
  timelineWrap: {
    gap: 12,
  },
  timelineItem: {
    flexDirection: "row",
    gap: 10,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
  },
  timelineBody: { flex: 1 },
  timelineTime: {
    fontSize: 11,
    color: "#9b9b9b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  timelineText: {
    fontSize: 12,
    color: "#b1b1b1",
    lineHeight: 17,
  },
  parentWrap: {
    marginTop: 12,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderLeftColor: "#A78BFA",
    borderRadius: 10,
    padding: 12,
  },
  parentLabel: {
    fontSize: 10,
    fontWeight: "800",
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  parentText: { fontSize: 13, lineHeight: 18 },
  commentsCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
  },
  sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 8 },
  commentComposerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginBottom: 10,
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 42,
    maxHeight: 100,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  commentBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { fontSize: 13 },
  replyCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  replyMeta: { fontSize: 11, marginTop: 6 },
  errorText: { fontSize: 14, fontWeight: "600" },
  infoOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  infoCard: {
    width: "100%",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
  },
  credibilityCircleContainer: {
    marginBottom: 14,
  },
  credibilityCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  credibilityPercentage: {
    fontSize: 22,
    fontWeight: "800",
  },
  credibilityLabelBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 10,
  },
  credibilityLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  credibilityDescription: {
    textAlign: "center",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  credibilityHint: {
    fontSize: 12,
  },
  locationInfoCard: {
    width: "100%",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
  },
  locationIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  locationTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  coordinatesContainer: {
    width: "100%",
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  coordinateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  coordinateLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  coordinateValue: {
    fontSize: 13,
    fontWeight: "700",
  },
  coordinateDivider: {
    height: 1,
  },
  locationRouteButton: {
    marginTop: 14,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  locationRouteButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});
