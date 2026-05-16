import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import * as Location from "expo-location";
import { useVideoPlayer, VideoView } from "expo-video";
import * as VideoThumbnails from "expo-video-thumbnails";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
  AppState,
    Dimensions,
    FlatList,
    Image,
    Modal,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { API_BASE_URL } from "../config";
import { useFilters } from "../context/FilterContext";
import { useTheme } from "../styles/ThemeContext";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// ============ API FUNCTIONS ============

/**
 * Interact with a post (upvote, downvote, or flag)
 * @param {string} postId - The ID of the post
 * @param {string} interactionType - 'upvote' | 'downvote' | 'flag'
 * @returns {Promise<{success: boolean, details: {message: string, new_upvotes: number, new_downvotes: number, new_flags: number}}>}
 */
async function interactWithPost(postId, interactionType) {
  // Get all stored keys for debugging
  const allKeys = await AsyncStorage.getAllKeys();
  console.log("[InteractWithPost] All AsyncStorage keys:", allKeys);

  let token = await AsyncStorage.getItem("authToken");

  console.log(
    "[InteractWithPost] Raw token value:",
    token ? `"${token}"` : "null",
  );
  console.log("[InteractWithPost] Token type:", typeof token);
  console.log("[InteractWithPost] Token length:", token ? token.length : 0);

  // Also check for alternate key names (in case of inconsistency)
  const altToken = await AsyncStorage.getItem("token");
  console.log(
    '[InteractWithPost] Alt token (key: "token"):',
    altToken ? "exists" : "null",
  );

  // Clean up token (remove any whitespace/newlines)
  if (token) {
    token = token.trim();
  }

  if (!token) {
    console.log("[InteractWithPost] ERROR: No token found in AsyncStorage!");
    throw new Error("Authentication required. Please log in again.");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  console.log(
    `[InteractWithPost] POST ${API_BASE_URL}/posts/${postId}/interact`,
  );
  console.log(
    "[InteractWithPost] Auth header:",
    `Bearer ${token.substring(0, 20)}...`,
  );

  const response = await fetch(`${API_BASE_URL}/posts/${postId}/interact`, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({ interaction_type: interactionType }),
  });

  const data = await response.json().catch(() => null);
  console.log("[InteractWithPost] Response status:", response.status);
  console.log(
    "[InteractWithPost] Response data:",
    JSON.stringify(data, null, 2),
  );

  if (!response.ok) {
    // Handle structured error responses from backend
    let errorMessage = `Failed to ${interactionType} post`;

    // Check for expired token (401 Unauthorized)
    if (response.status === 401) {
      errorMessage =
        "Your session has expired. Please log out and log back in.";
    } else if (data?.detail) {
      if (typeof data.detail === "string") {
        errorMessage = data.detail;
      } else if (data.detail?.details?.message) {
        errorMessage = data.detail.details.message;
      }
    }
    throw new Error(errorMessage);
  }

  return data;
}

// ============ POST INTERACTIONS COMPONENT ============

/**
 * Reddit-style voting component with optimistic updates
 * Allows rapid interactions without blocking UI
 */
const PostInteractions = memo(
  ({
    postId,
    initialUpvotes = 0,
    initialDownvotes = 0,
    initialFlags = 0,
    initialUserVote = null, // 'upvote' | 'downvote' | null
    initialUserFlagged = false,
    colors,
    onInteractionError,
    onCommentPress,
  }) => {
    // Local state
    const [isUpvoted, setIsUpvoted] = useState(initialUserVote === "upvote");
    const [isDownvoted, setIsDownvoted] = useState(
      initialUserVote === "downvote",
    );
    const [isFlagged, setIsFlagged] = useState(initialUserFlagged);
    const [upvotes, setUpvotes] = useState(initialUpvotes);
    const [downvotes, setDownvotes] = useState(initialDownvotes);
    const [flags, setFlags] = useState(initialFlags);

    // Request tracking to handle stale responses
    const requestIdRef = useRef(0);
    const pendingRequestRef = useRef(null);

    // Animation for button press feedback
    const upvoteScale = useRef(new Animated.Value(1)).current;
    const downvoteScale = useRef(new Animated.Value(1)).current;
    const flagScale = useRef(new Animated.Value(1)).current;

    const animatePress = (scaleValue) => {
      Animated.sequence([
        Animated.timing(scaleValue, {
          toValue: 0.85,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(scaleValue, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();
    };

    const handleUpvote = async () => {
      animatePress(upvoteScale);

      // Increment request ID to track this specific request
      const currentRequestId = ++requestIdRef.current;

      // Store previous state for rollback
      const prevUpvoted = isUpvoted;
      const prevDownvoted = isDownvoted;
      const prevUpvotes = upvotes;
      const prevDownvotes = downvotes;

      // Optimistic update - toggle behavior
      if (isUpvoted) {
        // Already upvoted, remove upvote
        setIsUpvoted(false);
        setUpvotes((prev) => Math.max(0, prev - 1));
      } else {
        // Add upvote
        setIsUpvoted(true);
        setUpvotes((prev) => prev + 1);
        // If was downvoted, remove downvote
        if (isDownvoted) {
          setIsDownvoted(false);
          setDownvotes((prev) => Math.max(0, prev - 1));
        }
      }

      try {
        const response = await interactWithPost(postId, "upvote");

        // Only apply server response if this is still the latest request
        if (currentRequestId === requestIdRef.current && response.success) {
          setUpvotes(response.details.new_upvotes);
          setDownvotes(response.details.new_downvotes);
          setFlags(response.details.new_flags);
        }
      } catch (error) {
        // Only rollback if this is still the latest request
        if (currentRequestId === requestIdRef.current) {
          setIsUpvoted(prevUpvoted);
          setIsDownvoted(prevDownvoted);
          setUpvotes(prevUpvotes);
          setDownvotes(prevDownvotes);
          onInteractionError?.(error.message);
        }
      }
    };

    const handleDownvote = async () => {
      animatePress(downvoteScale);

      // Increment request ID to track this specific request
      const currentRequestId = ++requestIdRef.current;

      // Store previous state for rollback
      const prevUpvoted = isUpvoted;
      const prevDownvoted = isDownvoted;
      const prevUpvotes = upvotes;
      const prevDownvotes = downvotes;

      // Optimistic update - toggle behavior
      if (isDownvoted) {
        // Already downvoted, remove downvote
        setIsDownvoted(false);
        setDownvotes((prev) => Math.max(0, prev - 1));
      } else {
        // Add downvote
        setIsDownvoted(true);
        setDownvotes((prev) => prev + 1);
        // If was upvoted, remove upvote
        if (isUpvoted) {
          setIsUpvoted(false);
          setUpvotes((prev) => Math.max(0, prev - 1));
        }
      }

      try {
        const response = await interactWithPost(postId, "downvote");

        // Only apply server response if this is still the latest request
        if (currentRequestId === requestIdRef.current && response.success) {
          setUpvotes(response.details.new_upvotes);
          setDownvotes(response.details.new_downvotes);
          setFlags(response.details.new_flags);
        }
      } catch (error) {
        // Only rollback if this is still the latest request
        if (currentRequestId === requestIdRef.current) {
          setIsUpvoted(prevUpvoted);
          setIsDownvoted(prevDownvoted);
          setUpvotes(prevUpvotes);
          setDownvotes(prevDownvotes);
          onInteractionError?.(error.message);
        }
      }
    };

    const handleFlag = async () => {
      animatePress(flagScale);

      // Increment request ID to track this specific request
      const currentRequestId = ++requestIdRef.current;

      // Store previous state for rollback
      const prevFlagged = isFlagged;
      const prevFlags = flags;

      // Optimistic update (flag is independent of votes)
      if (isFlagged) {
        setIsFlagged(false);
        setFlags((prev) => Math.max(0, prev - 1));
      } else {
        setIsFlagged(true);
        setFlags((prev) => prev + 1);
      }

      try {
        const response = await interactWithPost(postId, "flag");

        // Only apply server response if this is still the latest request
        if (currentRequestId === requestIdRef.current && response.success) {
          setUpvotes(response.details.new_upvotes);
          setDownvotes(response.details.new_downvotes);
          setFlags(response.details.new_flags);
        }
      } catch (error) {
        // Only rollback if this is still the latest request
        if (currentRequestId === requestIdRef.current) {
          setIsFlagged(prevFlagged);
          setFlags(prevFlags);
          onInteractionError?.(error.message);
        }
      }
    };

    // Colors for active states
    const upvoteColor = isUpvoted ? "#00BA7C" : colors.gray; // Green when active
    const downvoteColor = isDownvoted ? "#F91880" : colors.gray; // Pink when active
    const flagColor = isFlagged ? "#EF4444" : colors.gray; // Red when active

    // Format count like Twitter (1K, 1M, etc.)
    const formatCount = (count) => {
      if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
      if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
      return count > 0 ? count.toString() : "";
    };

    return (
      <View style={twitterStyles.actionBar}>
        {/* Upvote Button */}
        <Animated.View style={{ transform: [{ scale: upvoteScale }] }}>
          <TouchableOpacity
            style={twitterStyles.actionButton}
            onPress={handleUpvote}
            activeOpacity={0.6}
          >
            <Ionicons
              name={isUpvoted ? "thumbs-up" : "thumbs-up-outline"}
              size={20}
              color={upvoteColor}
            />
            <Text style={[twitterStyles.actionCount, { color: upvoteColor }]}>
              {formatCount(upvotes)}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Downvote Button */}
        <Animated.View style={{ transform: [{ scale: downvoteScale }] }}>
          <TouchableOpacity
            style={twitterStyles.actionButton}
            onPress={handleDownvote}
            activeOpacity={0.6}
          >
            <Ionicons
              name={isDownvoted ? "thumbs-down" : "thumbs-down-outline"}
              size={20}
              color={downvoteColor}
            />
            <Text style={[twitterStyles.actionCount, { color: downvoteColor }]}>
              {formatCount(downvotes)}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Comment Button */}
        <TouchableOpacity
          style={twitterStyles.actionButton}
          onPress={onCommentPress}
          activeOpacity={0.6}
        >
          <Ionicons name="chatbubble-outline" size={18} color={colors.gray} />
        </TouchableOpacity>

        {/* Flag Button */}
        <Animated.View style={{ transform: [{ scale: flagScale }] }}>
          <TouchableOpacity
            style={twitterStyles.actionButton}
            onPress={handleFlag}
            activeOpacity={0.6}
          >
            <Ionicons
              name={isFlagged ? "flag" : "flag-outline"}
              size={18}
              color={flagColor}
            />
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  },
);

// ============ SKELETON COMPONENTS ============

// Twitter-style skeleton for feed items
const TwitterSkeleton = memo(({ colors }) => (
  <View style={[twitterStyles.post, { borderBottomColor: colors.border }]}>
    <View style={twitterStyles.postContent}>
      {/* Avatar skeleton */}
      <View
        style={[
          twitterStyles.avatarSkeleton,
          { backgroundColor: colors.border },
        ]}
      />

      {/* Content skeleton */}
      <View style={twitterStyles.postBody}>
        {/* Header skeleton */}
        <View style={twitterStyles.skeletonHeader}>
          <View
            style={[
              twitterStyles.skeletonName,
              { backgroundColor: colors.border },
            ]}
          />
          <View
            style={[
              twitterStyles.skeletonHandle,
              { backgroundColor: colors.border },
            ]}
          />
        </View>

        {/* Text skeleton */}
        <View
          style={[
            twitterStyles.skeletonText,
            { backgroundColor: colors.border, width: "100%" },
          ]}
        />
        <View
          style={[
            twitterStyles.skeletonText,
            { backgroundColor: colors.border, width: "90%" },
          ]}
        />
        <View
          style={[
            twitterStyles.skeletonText,
            { backgroundColor: colors.border, width: "75%" },
          ]}
        />

        {/* Media skeleton */}
        <View
          style={[
            twitterStyles.skeletonMedia,
            { backgroundColor: colors.border },
          ]}
        />

        {/* Actions skeleton */}
        <View style={twitterStyles.skeletonActions}>
          <View
            style={[
              twitterStyles.skeletonAction,
              { backgroundColor: colors.border },
            ]}
          />
          <View
            style={[
              twitterStyles.skeletonAction,
              { backgroundColor: colors.border },
            ]}
          />
          <View
            style={[
              twitterStyles.skeletonAction,
              { backgroundColor: colors.border },
            ]}
          />
          <View
            style={[
              twitterStyles.skeletonAction,
              { backgroundColor: colors.border },
            ]}
          />
        </View>
      </View>
    </View>
  </View>
));

// Skeleton card component (kept for backwards compatibility)
const SkeletonCard = ({ colors }) => <TwitterSkeleton colors={colors} />;

// Fast image component - minimal state, maximum performance
const SmartImage = memo(
  ({ uri, style, colors, onPress }) => {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);

    // Memoize callbacks to prevent re-renders
    const handleLoad = useCallback(() => setLoaded(true), []);
    const handleError = useCallback(() => setError(true), []);

    if (error) {
      return (
        <View
          style={[
            style,
            {
              backgroundColor: colors.border,
              justifyContent: "center",
              alignItems: "center",
            },
          ]}
        >
          <Ionicons name="image-outline" size={28} color={colors.gray} />
        </View>
      );
    }

    return (
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={[style, { backgroundColor: colors.border }]}
      >
        <Image
          source={{ uri, cache: "force-cache" }}
          style={[StyleSheet.absoluteFill, { opacity: loaded ? 1 : 0 }]}
          resizeMode="cover"
          onLoad={handleLoad}
          onError={handleError}
          fadeDuration={0}
        />
      </Pressable>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison - only re-render if uri or colors change
    return (
      prevProps.uri === nextProps.uri &&
      prevProps.colors.border === nextProps.colors.border
    );
  },
);

// Video thumbnail component - tries to show first frame from video URL
const VideoThumbnail = memo(({ uri, style, colors, onPress }) => {
  const [thumbnailUri, setThumbnailUri] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const generateThumbnail = async () => {
      if (!uri) {
        setIsLoading(false);
        setHasError(true);
        return;
      }

      try {
        const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, {
          time: 1000, // Get frame at 1 second
          quality: 0.7,
        });

        if (isMounted) {
          setThumbnailUri(thumbUri);
          setIsLoading(false);
        }
      } catch (error) {
        console.log("Thumbnail generation failed:", error.message);
        if (isMounted) {
          setHasError(true);
          setIsLoading(false);
        }
      }
    };

    generateThumbnail();

    return () => {
      isMounted = false;
    };
  }, [uri]);

  return (
    <TouchableOpacity
      style={[style, { overflow: "hidden", backgroundColor: "#1a1a2e" }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Generated thumbnail */}
      {thumbnailUri && (
        <Image
          source={{ uri: thumbnailUri }}
          style={[StyleSheet.absoluteFill]}
          resizeMode="cover"
        />
      )}

      {/* Fallback background if thumbnail generation fails */}
      {(hasError || (!thumbnailUri && !isLoading)) && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: "#1a1a2e",
              justifyContent: "center",
              alignItems: "center",
            },
          ]}
        >
          <Ionicons name="videocam" size={60} color="rgba(255,255,255,0.15)" />
        </View>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: "#1a1a2e",
              justifyContent: "center",
              alignItems: "center",
            },
          ]}
        >
          <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
        </View>
      )}

      {/* Dark overlay for better play button visibility */}
      {!isLoading && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "rgba(0,0,0,0.3)" },
          ]}
        />
      )}

      {/* Play button overlay */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <View
          style={{
            backgroundColor: "rgba(0,0,0,0.7)",
            borderRadius: 35,
            width: 70,
            height: 70,
            justifyContent: "center",
            alignItems: "center",
            borderWidth: 3,
            borderColor: "rgba(255,255,255,0.3)",
          }}
        >
          <Ionicons
            name="play"
            size={32}
            color="#fff"
            style={{ marginLeft: 4 }}
          />
        </View>
      </View>

      {/* Video badge */}
      <View
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          backgroundColor: "rgba(0,0,0,0.7)",
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 4,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Ionicons name="videocam" size={12} color="#fff" />
        <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>
          VIDEO
        </Text>
      </View>
    </TouchableOpacity>
  );
});

// Video Player Modal Component using new expo-video API
const VideoPlayerModal = ({ visible, uri, onClose, colors }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  // Create video player with the new API
  const player = useVideoPlayer(uri, (player) => {
    player.loop = true;
    player.play();
  });

  // Reset states when modal opens/closes
  useEffect(() => {
    if (visible && uri) {
      setIsLoading(true);
      setError(false);
    }
  }, [visible, uri]);

  // Listen to player status changes
  useEffect(() => {
    if (!player) return;

    const subscriptions = [];

    // Listen for status changes
    const statusSub = player.addListener("statusChange", (newStatus) => {
      console.log("Video status:", newStatus);
      // expo-video uses 'readyToPlay', 'loading', 'idle', 'error'
      if (newStatus === "readyToPlay") {
        setIsLoading(false);
        setError(false);
      } else if (newStatus === "error") {
        setError(true);
        setIsLoading(false);
      } else if (newStatus === "loading") {
        setIsLoading(true);
      }
    });
    subscriptions.push(statusSub);

    // Also listen for when video starts playing as backup
    const playingSub = player.addListener("playingChange", (isPlaying) => {
      console.log("Video playing:", isPlaying);
      if (isPlaying) {
        setIsLoading(false);
      }
    });
    subscriptions.push(playingSub);

    // Check initial status
    if (player.status === "readyToPlay") {
      setIsLoading(false);
    }

    // Fallback timeout - hide loading after 5 seconds regardless
    // This handles cases where events don't fire properly
    const timeout = setTimeout(() => {
      setIsLoading(false);
    }, 5000);

    return () => {
      subscriptions.forEach((sub) => sub?.remove());
      clearTimeout(timeout);
    };
  }, [player]);

  // Additional effect to check player.playing state periodically
  useEffect(() => {
    if (!player || !visible) return;

    const interval = setInterval(() => {
      if (player.playing || player.status === "readyToPlay") {
        setIsLoading(false);
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [player, visible]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.videoModalContainer}>
        {/* Close button */}
        <TouchableOpacity style={styles.videoCloseButton} onPress={onClose}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>

        {error ? (
          <View style={styles.videoErrorContainer}>
            <Ionicons name="alert-circle-outline" size={64} color="#fff" />
            <Text style={styles.videoErrorText}>Failed to load video</Text>
            <TouchableOpacity style={styles.videoRetryButton} onPress={onClose}>
              <Text style={styles.videoRetryText}>Close</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.videoWrapper}>
            <VideoView
              player={player}
              style={styles.videoPlayer}
              contentFit="contain"
              nativeControls={true}
              allowsPictureInPicture={true}
            />
            {isLoading && (
              <View style={styles.videoLoadingOverlay}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={{ color: "#fff", marginTop: 12 }}>
                  Loading video...
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
};

// Image Viewer Modal Component with swipeable gallery
const ImageViewerModal = ({ visible, images, initialIndex, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);
  const [loadingStates, setLoadingStates] = useState({});
  const [errorStates, setErrorStates] = useState({});
  const flatListRef = useRef(null);

  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex || 0);
      setLoadingStates({});
      setErrorStates({});
      // Scroll to initial index when modal opens
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: initialIndex || 0,
          animated: false,
        });
      }, 100);
    }
  }, [visible, initialIndex]);

  const handleImageLoad = useCallback((index) => {
    setLoadingStates((prev) => ({ ...prev, [index]: false }));
  }, []);

  const handleImageError = useCallback((index) => {
    setErrorStates((prev) => ({ ...prev, [index]: true }));
    setLoadingStates((prev) => ({ ...prev, [index]: false }));
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  if (!visible || !images || images.length === 0) return null;

  const renderImageItem = ({ item: uri, index }) => {
    const isLoading = loadingStates[index] !== false;
    const hasError = errorStates[index];

    return (
      <View style={styles.imageSlide}>
        {hasError ? (
          <View style={styles.videoErrorContainer}>
            <Ionicons name="image-outline" size={64} color="#fff" />
            <Text style={styles.videoErrorText}>Failed to load image</Text>
          </View>
        ) : (
          <>
            <Image
              source={{ uri, cache: "force-cache" }}
              style={styles.fullscreenImage}
              resizeMode="contain"
              onLoad={() => handleImageLoad(index)}
              onError={() => handleImageError(index)}
            />
            {isLoading && (
              <View style={styles.videoLoadingOverlay}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={{ color: "#fff", marginTop: 12 }}>
                  Loading image...
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.videoModalContainer}>
        {/* Close button */}
        <TouchableOpacity style={styles.videoCloseButton} onPress={onClose}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>

        {/* Image counter */}
        {images.length > 1 && (
          <View style={styles.imageCounter}>
            <Text style={styles.imageCounterText}>
              {currentIndex + 1} / {images.length}
            </Text>
          </View>
        )}

        {/* Swipeable image gallery */}
        <FlatList
          ref={flatListRef}
          data={images}
          renderItem={renderImageItem}
          keyExtractor={(item, index) => `image-${index}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          getItemLayout={(data, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          initialScrollIndex={initialIndex || 0}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({
                index: info.index,
                animated: false,
              });
            }, 100);
          }}
        />

        {/* Pagination dots */}
        {images.length > 1 && (
          <View style={styles.paginationDots}>
            {images.map((uri, index) => (
              <View
                key={`pagination-${uri}-${index}`}
                style={[
                  styles.paginationDot,
                  currentIndex === index && styles.paginationDotActive,
                ]}
              />
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
};

export default function HomeScreen() {
  const { colors, isDark } = useTheme();
  const {
    selectedCategories,
    minCredibility,
    maxDaysOld,
    getActiveCategory,
  } =
    useFilters();
  const navigation = useNavigation();
  const isFocused = useIsFocused();

  // State management
  const [posts, setPosts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [locationPermission, setLocationPermission] = useState(null);
  const [error, setError] = useState(null);
  const [isUsingRealLocation, setIsUsingRealLocation] = useState(false);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [locationName, setLocationName] = useState("Loading...");
  const [locationCache, setLocationCache] = useState({});

  // Video player state
  const [videoModalVisible, setVideoModalVisible] = useState(false);
  const [currentVideoUri, setCurrentVideoUri] = useState(null);

  // Image viewer state
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [currentImages, setCurrentImages] = useState([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Credibility tooltip state
  const [credibilityModal, setCredibilityModal] = useState({
    visible: false,
    score: 0,
  });

  // Location tooltip state
  const [locationModal, setLocationModal] = useState({
    visible: false,
    name: "",
    lat: 0,
    lon: 0,
    distance: null,
  });

  // Step 52 & 53: Pagination state for recommendations/feed
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Step 54: Store recommendation reasons for display
  const [postReasons, setPostReasons] = useState({});
  // Track current media index for each post in carousel
  const [mediaIndices, setMediaIndices] = useState({});
  const mediaScrollRefs = useRef({});

  const safeAlert = useCallback(
    (title, message, buttons) => {
      if (AppState.currentState === "active" && isFocused) {
        Alert.alert(title, message, buttons);
      }
    },
    [isFocused],
  );

  // Function to show credibility info
  const showCredibilityInfo = useCallback((score) => {
    setCredibilityModal({ visible: true, score });
  }, []);

  // Function to show location info
  const showLocationInfo = useCallback((name, lat, lon, distance) => {
    setLocationModal({ visible: true, name, lat, lon, distance });
  }, []);

  const handleNavigateFromLocationModal = useCallback(() => {
    const destination = {
      latitude: Number(locationModal.lat),
      longitude: Number(locationModal.lon),
      address: locationModal.name || "Pinned destination",
    };

    if (
      !Number.isFinite(destination.latitude) ||
      !Number.isFinite(destination.longitude)
    ) {
      return;
    }

    setLocationModal((prev) => ({ ...prev, visible: false }));
    navigation.navigate("Navigate", { destination });
  }, [locationModal.lat, locationModal.lon, locationModal.name, navigation]);

  // Function to play video
  const playVideo = useCallback((uri) => {
    setCurrentVideoUri(uri);
    setVideoModalVisible(true);
  }, []);

  // Function to view image fullscreen (supports multiple images)
  const viewImage = useCallback((images, startIndex = 0) => {
    // Handle both single image string and array of images
    const imageArray = Array.isArray(images) ? images : [images];
    setCurrentImages(imageArray);
    setCurrentImageIndex(startIndex);
    setImageModalVisible(true);
  }, []);

  // Reverse geocode coordinates to get location name
  const getLocationName = async (lat, lon) => {
    const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;

    // Check cache first
    if (locationCache[cacheKey]) {
      return locationCache[cacheKey];
    }

    try {
      const result = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lon,
      });

      if (result && result.length > 0) {
        const loc = result[0];
        // Build a readable location string
        let locationStr = "";
        if (loc.district) {
          locationStr = loc.district;
        } else if (loc.subregion) {
          locationStr = loc.subregion;
        } else if (loc.name) {
          locationStr = loc.name;
        }

        if (loc.city && loc.city !== locationStr) {
          locationStr = locationStr ? `${locationStr}, ${loc.city}` : loc.city;
        }

        if (!locationStr) {
          locationStr = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        }

        // Cache the result
        setLocationCache((prev) => ({ ...prev, [cacheKey]: locationStr }));
        return locationStr;
      }
    } catch (error) {
      console.log("Reverse geocoding failed:", error);
    }

    // Fallback to coordinates
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  };

  useEffect(() => {
    requestLocationPermission(false);
  }, []);

  useEffect(() => {
    console.log("[Feed] useEffect triggered: userLocation =", userLocation);
    if (userLocation) {
      console.log("[Feed] 📍 Location available, calling loadFeed()");
      loadFeed();
    } else {
      console.warn("[Feed] ⚠️ No userLocation set yet");
    }
  }, [userLocation, selectedCategories, minCredibility, maxDaysOld]);

  const requestLocationPermission = async (showAlert = true) => {
    console.log("[Location] Requesting location permission...");
    setIsLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      console.log("[Location] Permission status:", status);
      setLocationPermission(status === "granted");

      if (status === "granted") {
        try {
          console.log("[Location] Getting current position...");
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
            maximumAge: 5000,
            timeout: 10000,
          });
          console.log("[Location] ✅ Got location:", location.coords);
          setUserLocation({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          });
          setIsUsingRealLocation(true);
          // Get actual location name via reverse geocoding
          const actualLocationName = await getLocationName(
            location.coords.latitude,
            location.coords.longitude,
          );
          setLocationName(actualLocationName);
          console.log(
            "[Location] Using real location:",
            location.coords,
            actualLocationName,
          );
        } catch (locError) {
          console.error("[Location] ❌ Error getting location:", locError);
          // Try to get last known location as fallback
          try {
            const lastKnown = await Location.getLastKnownPositionAsync({
              maxAge: 60000,
            });
            if (lastKnown) {
              console.log("[Location] Using last known location");
              setUserLocation({
                latitude: lastKnown.coords.latitude,
                longitude: lastKnown.coords.longitude,
              });
              setIsUsingRealLocation(true);
              // Get actual location name via reverse geocoding
              const lastKnownName = await getLocationName(
                lastKnown.coords.latitude,
                lastKnown.coords.longitude,
              );
              setLocationName(lastKnownName);
              console.log("[Location] Using last known location:", lastKnownName);
            } else {
              // Use a default location (Karachi, Pakistan) if all fails
              console.log("[Location] Using default location");
              setUserLocation({
                latitude: 24.8607,
                longitude: 67.0099,
              });
              setIsUsingRealLocation(false);
              setLocationName("Karachi (Default)");
              console.log("Using default location (Karachi)");
              if (showAlert) {
                safeAlert(
                  "Location Unavailable",
                  "Could not get your location. Showing posts from Karachi. Tap the location button to try again.",
                  [{ text: "OK" }],
                );
              }
            }
          } catch (fallbackError) {
            // Last fallback - use default location
            setUserLocation({
              latitude: 24.8607,
              longitude: 67.0099,
            });
            setIsUsingRealLocation(false);
            setLocationName("Karachi (Default)");
            console.log("Using default location after all attempts failed");
          }
        }
      } else {
        // Permission denied - use default location
        setUserLocation({
          latitude: 24.8607,
          longitude: 67.0099,
        });
        setIsUsingRealLocation(false);
        setLocationName("Karachi (Default)");
        if (showAlert) {
          safeAlert(
            "Location Permission Required",
            "Please enable location to see posts near you. Using default location.",
            [
              {
                text: "Enable",
                onPress: () => Location.requestForegroundPermissionsAsync(),
              },
              { text: "OK" },
            ],
          );
        }
      }
    } catch (error) {
      console.error("Error requesting location:", error);
      // Use default on any error
      setUserLocation({
        latitude: 24.8607,
        longitude: 67.0099,
      });
      setIsUsingRealLocation(false);
      setLocationName("Karachi (Default)");
    } finally {
      setIsLoadingLocation(false);
    }
  };

  // Manual location refresh
  const refreshLocation = async () => {
    setIsLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status === "granted") {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
          maximumAge: 0,
          timeout: 15000,
        });
        setUserLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
        setIsUsingRealLocation(true);
        // Get actual location name via reverse geocoding
        const refreshedLocationName = await getLocationName(
          location.coords.latitude,
          location.coords.longitude,
        );
        setLocationName(refreshedLocationName);
        console.log(
          "Location refreshed:",
          location.coords,
          refreshedLocationName,
        );
      } else {
        safeAlert(
          "Location Permission Required",
          "Please enable location in your device settings.",
          [{ text: "OK" }],
        );
      }
    } catch (error) {
      console.error("Error refreshing location:", error);
      safeAlert(
        "Location Error",
        "Could not get your location. Make sure location services are enabled in your device settings.",
        [{ text: "OK" }],
      );
    } finally {
      setIsLoadingLocation(false);
    }
  };

  const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // Fetch feed from API
  const fetchFeed = useCallback(async () => {
    if (!userLocation) return [];

    try {
      const token = await AsyncStorage.getItem("authToken");

      // Build query parameters
      const queryParams = new URLSearchParams();
      queryParams.append("lat", userLocation.latitude.toString());
      queryParams.append("lon", userLocation.longitude.toString());
      queryParams.append("radius_km", "50");
      // Force relaxed defaults until filter UI refreshes correctly.
      queryParams.append("max_days_old", "30");

      // Add category filter if not 'all'
      const activeCategory = getActiveCategory();
      if (activeCategory) {
        queryParams.append("category", activeCategory);
      }

      // Add credibility filter
      queryParams.append("min_credibility", "0");

      queryParams.append("skip", "0");
      queryParams.append("limit", "20");

      const endpoint = `${API_BASE_URL}/feed?${queryParams}`;
      const startedAt = Date.now();

      console.log("[Feed] Fetching with params:", queryParams.toString());
      console.log("[Feed] Endpoint:", endpoint);

      let response;
      try {
        response = await fetchWithTimeout(
          endpoint,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              ...(token && { Authorization: `Bearer ${token}` }),
            },
          },
          15000,
        );
      } catch (fetchError) {
        console.error("[Feed] Network/timeout error:", fetchError);
        throw new Error(
          "Network request failed. Verify API URL and emulator connectivity.",
        );
      }

      console.log(
        "[Feed] Response:",
        response.status,
        response.statusText,
        `(${Date.now() - startedAt}ms)`,
      );

      const rawText = await response.text();
      let data = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch (parseError) {
        console.error("[Feed] JSON parse error:", parseError);
      }

      if (!response.ok) {
        console.error(
          "[Feed] API error payload:",
          rawText?.slice(0, 600) || "<empty>",
        );
        throw new Error(`Failed to fetch feed: ${response.status}`);
      }

      console.log("[Feed] Response payload keys:", data ? Object.keys(data) : null);

      if (data.success && data.details?.posts) {
        console.log("[Feed] Posts received:", data.details.posts.length);
        if (data.details.posts.length > 0) {
          console.log("[Feed] First post id:", data.details.posts[0].id);
          console.log(
            "[Feed] First post media_items:",
            data.details.posts?.[0]?.media_items,
          );
        }
        // Sort posts by created_at from latest to earliest
        const sortedPosts = data.details.posts.sort((a, b) => {
          return new Date(b.created_at) - new Date(a.created_at);
        });
        return sortedPosts;
      }

      console.warn("[Feed] Unexpected response shape:", data);

      return [];
    } catch (error) {
      console.error("Error fetching feed:", error);
      throw error;
    }
  }, [userLocation, maxDaysOld, minCredibility, getActiveCategory]);

  // Step 52: Fetch personalized recommendations from backend
  const fetchRecommendations = useCallback(async (paginationOffset = 0) => {
    if (!userLocation) return [];

    try {
      const token = await AsyncStorage.getItem("authToken");

      // Build query parameters
      const queryParams = new URLSearchParams();
      // queryParams.append("skip", paginationOffset.toString());
      // queryParams.append("limit", "20");

      queryParams.append('hours_lookback',"720")
      
      // Step 52: Include user location for location-aware recommendations
      // queryParams.append("user_location_lat", userLocation.latitude.toString());
      // queryParams.append("user_location_lon", userLocation.longitude.toString());

      const endpoint = `${API_BASE_URL}/posts/recommendations?${queryParams}`;
      const startedAt = Date.now();

      console.log("[Recommendations] Fetching offset:", paginationOffset);
      console.log("[Recommendations] Endpoint:", endpoint);
      console.log("[Recommendations] User location:", userLocation);

      let response;
      try {
        response = await fetch(
          endpoint,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              ...(token && { Authorization: `Bearer ${token}` }),
            },
          },
          15000,
        );
      } catch (fetchError) {
        console.error("[Recommendations] Network/timeout error:", fetchError);
        throw new Error(
          "Network request failed. Verify API URL and emulator connectivity.",
        );
      }

      console.log(
        "[Recommendations] Response:",
        response.status,
        response.statusText,
        `(${Date.now() - startedAt}ms)`,
      );

      const rawText = await response.text();
      let data = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch (parseError) {
        console.error("[Recommendations] JSON parse error:", parseError);
      }

      if (!response.ok) {
        console.error(
          "[Recommendations] API error payload:",
          rawText?.slice(0, 600) || "<empty>",
        );
        throw new Error(`Failed to fetch recommendations: ${response.status}`);
      }

      console.log("[Recommendations] Response payload keys:", data ? Object.keys(data) : null);

      if (data.success && data.details?.recommendations) {
        console.log("[Recommendations] Posts received:", data.details.recommendations.length);

        // Step 54: Extract recommendation reasons for each post
        const reasons = {};
        data.details.recommendations.forEach((post) => {
          if (post.reason) {
            reasons[post.id] = post.reason;
          }
        });
        
        // Store reasons for UI display
        setPostReasons((prev) => ({ ...prev, ...reasons }));

        // Sort posts by created_at from latest to earliest
        const sortedPosts = data.details.recommendations.sort((a, b) => {
          return new Date(b.created_at) - new Date(a.created_at);
        });

        return sortedPosts;
      }

      console.warn("[Recommendations] Unexpected response shape:", data);
      return [];
    } catch (error) {
      console.error("Error fetching recommendations:", error);
      throw error;
    }
  }, [userLocation, selectedCategories, minCredibility, maxDaysOld]);

  // Batch geocode locations in background (non-blocking)
  const batchGeocodeLocations = useCallback(
    async (postsToGeocode) => {
      const uncachedPosts = postsToGeocode.filter((post) => {
        const cacheKey = `${post.location_lat.toFixed(4)},${post.location_lon.toFixed(4)}`;
        return !locationCache[cacheKey];
      });

      // Only geocode first 5 unique locations to avoid rate limiting
      const uniqueLocations = [];
      const seen = new Set();
      for (const post of uncachedPosts) {
        const key = `${post.location_lat.toFixed(4)},${post.location_lon.toFixed(4)}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueLocations.push({
            lat: post.location_lat,
            lon: post.location_lon,
            key,
          });
          if (uniqueLocations.length >= 5) break;
        }
      }

      // Geocode in background without blocking UI
      for (const loc of uniqueLocations) {
        try {
          const result = await Location.reverseGeocodeAsync({
            latitude: loc.lat,
            longitude: loc.lon,
          });
          if (result && result.length > 0) {
            const r = result[0];
            const name =
              r.district ||
              r.subregion ||
              r.city ||
              r.name ||
              `${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°`;
            setLocationCache((prev) => ({ ...prev, [loc.key]: name }));
          }
        } catch (e) {
          // Silently fail - coordinates will be shown
        }
      }
    },
    [locationCache],
  );

  const loadFeed = async (paginationOffset = 0) => {
    console.log("[Feed] loadFeed() called with offset:", paginationOffset);
    try {
      setError(null);

      // Step 53: Handle pagination logic
      if (paginationOffset === 0) {
        console.log("[Feed] Initial load (offset=0)");
        // Initial load - show loading indicator or cached data
        if (posts.length === 0) {
          try {
            const cacheKey = "@verifikar_feed_cache";
            const cachedData = await AsyncStorage.getItem(cacheKey);
            if (cachedData) {
              const { posts: cachedPosts, timestamp } = JSON.parse(cachedData);
              // Use cache if it's less than 30 minutes old
              const cacheAge = Date.now() - timestamp;
              if (cacheAge < 30 * 60 * 1000 && cachedPosts.length > 0) {
                console.log("[Feed] ✅ Using cached data:", cachedPosts.length, "posts");
                setPosts(cachedPosts);
                setIsLoading(false);
              } else {
                console.log("[Feed] Cache expired, fetching fresh data");
                setIsLoading(true);
              }
            } else {
              console.log("[Feed] No cache found, fetching fresh data");
              setIsLoading(true);
            }
          } catch (cacheError) {
            console.log("[Feed] Cache read error:", cacheError);
            setIsLoading(true);
          }
        } else {
          console.log("[Feed] Posts already exist, refreshing");
          setIsLoading(true);
        }
      } else {
        console.log("[Feed] Load more (offset =", paginationOffset + ")");
        // Loading more - show load more spinner
        setIsLoadingMore(true);
      }

      // Step 52: Fetch from recommendations or feed endpoint
      console.log("[Feed] Fetching from feed endpoint");
      const feedData = await fetchFeed();

      console.log("[Feed] ✅ Received", feedData.length, "posts");

      // Remove duplicate posts to avoid duplicate keys in lists
      const seenPostIds = new Set();
      const uniqueFeedData = [];
      for (const post of feedData) {
        if (!seenPostIds.has(post.id)) {
          seenPostIds.add(post.id);
          uniqueFeedData.push(post);
        }
      }

      // Step 53: Update posts based on pagination offset
      if (paginationOffset === 0) {
        // Initial load - replace posts
        console.log("[Feed] Setting initial posts");
        setPosts(uniqueFeedData);
        setOffset(0);
        setHasMore(uniqueFeedData.length >= 20);
      } else {
        // Load more - append to existing posts
        console.log("[Feed] Appending", uniqueFeedData.length, "posts");
        setPosts((prev) => {
          const merged = [...prev, ...uniqueFeedData];
          const seen = new Set();
          return merged.filter((post) => {
            if (seen.has(post.id)) return false;
            seen.add(post.id);
            return true;
          });
        });
        setOffset(paginationOffset);
        setHasMore(uniqueFeedData.length >= 20);
      }

      // Cache the fresh data
      try {
        const cacheKey = "@verifikar_feed_cache";
        await AsyncStorage.setItem(
          cacheKey,
          JSON.stringify({
            posts: uniqueFeedData,
            timestamp: Date.now(),
          }),
        );
        console.log("[Feed] ✅ Cached successfully");
      } catch (cacheError) {
        console.log("[Feed] Cache write error:", cacheError);
      }

      // Start background geocoding after posts are set
      setTimeout(() => batchGeocodeLocations(uniqueFeedData), 100);
    } catch (error) {
      console.error("[Feed] ❌ Error loading feed:", error);
      // Only show error if we have no cached data
      if (posts.length === 0) {
        setError(error.message || "Failed to load feed");
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  // Step 53: Load more posts on pagination
  const handleLoadMore = () => {
    if (!isLoadingMore && hasMore && !isLoading) {
      const nextOffset = offset + 20;
      loadFeed(nextOffset);
    }
  };

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      setError(null);
      setOffset(0);

      // Refresh location
      if (locationPermission) {
        try {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Low,
            maximumAge: 10000,
            timeout: 5000,
          });
          setUserLocation({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          });
        } catch (locError) {
          console.log("Location refresh failed, using existing location");
        }
      }

      // Fetch fresh data
      const feedData = await fetchFeed();
      setPosts(feedData);
      setHasMore(feedData.length >= 20);

      // Update cache on refresh
      try {
        const cacheKey = "@verifikar_feed_cache";
        await AsyncStorage.setItem(
          cacheKey,
          JSON.stringify({
            posts: feedData,
            timestamp: Date.now(),
          }),
        );
      } catch (cacheError) {
        console.log("Cache write error:", cacheError);
      }
    } catch (error) {
      console.error("Error refreshing feed:", error);
      setError(error.message || "Failed to refresh feed");
    } finally {
      setIsRefreshing(false);
    }
  };

  const formatTimeAgo = (timestamp) => {
    const now = new Date();
    const postTime = new Date(timestamp);
    const diffMs = now - postTime;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getCategoryColor = (category) => {
    const categoryColors = {
      Accident: "#FF6B6B",
      Crime: "#E74C3C",
      Infrastructure: "#3498DB",
      Social: "#2ECC71",
      Emergency: "#E67E22",
      Weather: "#9B59B6",
      Fire: "#FF4500",
      Protest: "#FFD700",
      Traffic: "#FF8C00",
      Health: "#00CED1",
      Disaster: "#8B0000",
      "Natural Disaster": "#8B0000",
      Flood: "#1E90FF",
      Earthquake: "#8B4513",
      default: colors.primary,
    };
    return categoryColors[category] || categoryColors.default;
  };

  // Get icon for each category - helps users who can't read
  const getCategoryIcon = (category) => {
    const categoryIcons = {
      Accident: "car", // 🚗 Car accident
      Crime: "alert-circle", // ⚠️ Crime/danger
      Infrastructure: "construct", // 🚧 Construction/infrastructure
      Social: "people", // 👥 Social gathering
      Emergency: "warning", // ⚡ Emergency
      Weather: "thunderstorm", // 🌩️ Weather
      Fire: "flame", // 🔥 Fire
      Protest: "megaphone", // 📢 Protest
      Traffic: "car-sport", // 🚗 Traffic
      Health: "medkit", // 🏥 Health/medical
      Disaster: "alert-outline", // ⚠️ Disaster
      "Natural Disaster": "earth", // 🌍 Natural disaster
      Flood: "water", // 💧 Flood
      Earthquake: "pulse", // 📈 Earthquake
      default: "alert-circle", // ⚠️ Default alert
    };
    return categoryIcons[category] || categoryIcons.default;
  };

  const getCredibilityColor = (score) => {
    if (score >= 0.8) return "#2ECC71";
    if (score >= 0.6) return "#F39C12";
    return "#E74C3C";
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const renderPost = useCallback(
    ({ item }) => {
      const SCREEN_WIDTH_LOCAL = Dimensions.get("window").width - 32;
      const currentMediaIdx = mediaIndices[item.id] || 0;

      let distance = null;
      if (userLocation) {
        distance = calculateDistance(
          userLocation.latitude,
          userLocation.longitude,
          item.location_lat,
          item.location_lon,
        );
      }

      // Get location name from cache or use coordinates
      const cacheKey = `${item.location_lat.toFixed(4)},${item.location_lon.toFixed(4)}`;
      const incidentLocation =
        locationCache[cacheKey] ||
        `${item.location_lat.toFixed(2)}°, ${item.location_lon.toFixed(2)}°`;

      // Helper functions for media
      const getMediaInfo = (media) => {
        const mediaUrl =
          typeof media === "string"
            ? media
            : media?.media_url || media?.storage_url;
        const mediaType =
          typeof media === "string" ? "image" : media?.media_type || "image";
        return { mediaUrl, mediaType };
      };

      const isImageType = (type) =>
        type === "image" ||
        type === "ImageMediaEnum" ||
        type?.includes("image");

      const isVideoType = (type) => type === "video" || type?.includes("video");

      // Render swipeable media catalog
      const renderMedia = () => {
        if (!item.media_items || item.media_items.length === 0) return null;

        const totalMediaCount = item.media_items.length;

        // Collect all image URLs for fullscreen gallery
        const allImageUrls = item.media_items
          .map((media) => {
            const { mediaUrl, mediaType } = getMediaInfo(media);
            return isImageType(mediaType) ? mediaUrl : null;
          })
          .filter(Boolean);

        // Handle scroll to calculate current index
        const handleMediaScroll = (event) => {
          const contentOffsetX = event.nativeEvent.contentOffset.x;
          const index = Math.round(contentOffsetX / SCREEN_WIDTH_LOCAL);
          setMediaIndices((prev) => ({
            ...prev,
            [item.id]: Math.min(index, item.media_items.length - 1),
          }));
        };

        return (
          <View style={twitterStyles.mediaContainerWrapper}>
            {/* Swipeable media carousel */}
            <ScrollView
              ref={(ref) => {
                mediaScrollRefs.current[item.id] = ref;
              }}
              horizontal
              pagingEnabled
              scrollEventThrottle={16}
              onScroll={handleMediaScroll}
              showsHorizontalScrollIndicator={false}
              scrollsToTop={false}
              style={twitterStyles.mediaCarousel}
              nestedScrollEnabled={true}
              pointerEvents="auto"
            >
              {item.media_items.map((media, index) => {
                const { mediaUrl, mediaType } = getMediaInfo(media);
                const imageUrlIndex = allImageUrls.indexOf(mediaUrl);

                return (
                  <View
                    key={`${item.id}-media-${index}`}
                    style={[
                      twitterStyles.mediaSlide,
                      { width: SCREEN_WIDTH_LOCAL },
                    ]}
                  >
                    {mediaUrl && isImageType(mediaType) ? (
                      <SmartImage
                        uri={mediaUrl}
                        style={twitterStyles.singleMedia}
                        colors={colors}
                        onPress={() =>
                          viewImage(
                            allImageUrls,
                            imageUrlIndex >= 0 ? imageUrlIndex : 0,
                          )
                        }
                      />
                    ) : mediaUrl && isVideoType(mediaType) ? (
                      <VideoThumbnail
                        uri={mediaUrl}
                        style={twitterStyles.singleMedia}
                        colors={colors}
                        onPress={() => playVideo(mediaUrl)}
                      />
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>

            {/* Dot indicators */}
            {totalMediaCount > 1 && (
              <View style={twitterStyles.dotIndicatorContainer}>
                {item.media_items.map((_, index) => (
                  <View
                    key={`${item.id}-dot-${index}`}
                    style={[
                      twitterStyles.dot,
                      index === currentMediaIdx
                        ? twitterStyles.activeDot
                        : twitterStyles.inactiveDot,
                    ]}
                  />
                ))}
              </View>
            )}

            {/* Media counter badge */}
            {totalMediaCount > 1 && (
              <View style={twitterStyles.mediaCounterBadge}>
                <Ionicons name="images" size={12} color="#fff" />
                <Text style={twitterStyles.mediaCounterText}>
                  {currentMediaIdx + 1}/{totalMediaCount}
                </Text>
              </View>
            )}
          </View>
        );
      };

      // Get credibility label
      const getCredibilityLabel = (score) => {
        if (score >= 0.7) return "High";
        if (score >= 0.4) return "Medium";
        return "Low";
      };

      return (
        <View
          style={[
            twitterStyles.post,
            {
              borderBottomColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
        >
          <View style={twitterStyles.postContent}>
            {/* Avatar - Shows category icon with credibility-colored background */}
            <TouchableOpacity
              style={[
                twitterStyles.avatarPlaceholder,
                {
                  backgroundColor:
                    getCredibilityColor(item.credibility_score) + "20",
                  borderWidth: 2,
                  borderColor:
                    getCredibilityColor(item.credibility_score) + "50",
                },
              ]}
              onPress={() => showCredibilityInfo(item.credibility_score)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={getCategoryIcon(item.event_category)}
                size={20}
                color={getCategoryColor(item.event_category)}
              />
              {/* Credibility indicator dot */}
              <View
                style={[
                  twitterStyles.credibilityDot,
                  {
                    backgroundColor: getCredibilityColor(
                      item.credibility_score,
                    ),
                  },
                ]}
              />
            </TouchableOpacity>

            {/* Post Body */}
            <View style={twitterStyles.postBody}>
              {/* Pressable for header/location/content navigation */}
              <Pressable
                onPress={() =>
                  navigation.navigate("PostDetails", { postId: item.id })
                }
              >
                {/* Header: Category + Time + Distance */}
                <View style={twitterStyles.postHeader}>
                <Text
                  style={[twitterStyles.displayName, { color: colors.text }]}
                >
                  {item.event_category}
                </Text>
                <Text style={[twitterStyles.dot, { color: colors.gray }]}>
                  ·
                </Text>
                <Text style={[twitterStyles.time, { color: colors.gray }]}>
                  {formatTimeAgo(item.created_at)}
                </Text>
                {distance && (
                  <>
                    <Text style={[twitterStyles.dot, { color: colors.gray }]}>
                      ·
                    </Text>
                    <Text style={[twitterStyles.time, { color: colors.gray }]}>
                      {distance < 1
                        ? `${Math.round(distance * 1000)}m`
                        : `${distance.toFixed(1)}km`}
                    </Text>
                  </>
                )}
              </View>

              {/* Subtext: Location (tappable with visual hint) */}
              <TouchableOpacity
                style={twitterStyles.locationTouchable}
                onPress={() =>
                  showLocationInfo(
                    incidentLocation,
                    item.location_lat,
                    item.location_lon,
                    distance,
                  )
                }
                activeOpacity={0.6}
              >
                <View
                  style={[
                    twitterStyles.locationPill,
                    { backgroundColor: colors.primary + "10" },
                  ]}
                >
                  <Ionicons name="location" size={12} color={colors.primary} />
                  <Text
                    style={[
                      twitterStyles.locationPillText,
                      { color: colors.primary },
                    ]}
                    numberOfLines={1}
                  >
                    {incidentLocation}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={12}
                    color={colors.primary}
                    style={{ opacity: 0.6 }}
                  />
                </View>
              </TouchableOpacity>

              {/* Content */}
              <Text style={[twitterStyles.contentText, { color: colors.text }]}>
                {item.content}
              </Text>
              </Pressable>

              {/* Media - Instagram-style catalog layout with counter */}
              {renderMedia()}

              {/* Action Bar */}
              <PostInteractions
                postId={item.id}
                initialUpvotes={item.upvotes || 0}
                initialDownvotes={item.downvotes || 0}
                initialFlags={item.flags || 0}
                initialUserVote={item.user_vote || null}
                initialUserFlagged={item.user_flagged || false}
                colors={colors}
                onInteractionError={(message) => safeAlert("Error", message)}
                onCommentPress={() =>
                  navigation.navigate("PostDetails", {
                    postId: item.id,
                    focusComment: true,
                  })
                }
              />
            </View>
          </View>
        </View>
      );
    },
    [
      userLocation,
      locationCache,
      colors,
      playVideo,
      showCredibilityInfo,
      showLocationInfo,
      navigation,
      postReasons,
      mediaIndices,
      setMediaIndices,
    ],
  );

  if (!locationPermission) {
    return (
      <View
        style={[styles.centerContainer, { backgroundColor: colors.background }]}
      >
        <Ionicons name="location-outline" size={64} color={colors.gray} />
        <Text style={[styles.emptyText, { color: colors.text, marginTop: 16 }]}>
          Location Permission Required
        </Text>
        <Text
          style={[styles.emptySubtext, { color: colors.gray, marginTop: 8 }]}
        >
          Enable location to see posts near you
        </Text>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: colors.primary }]}
          onPress={requestLocationPermission}
        >
          <Text style={styles.retryButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading && posts.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Location Bar (same as main view) */}
        <View
          style={[
            styles.locationBar,
            {
              backgroundColor: colors.surface,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={styles.locationInfo}>
            <Ionicons name="location-outline" size={18} color={colors.gray} />
            <View
              style={{
                width: 120,
                height: 16,
                backgroundColor: colors.border,
                borderRadius: 4,
              }}
            />
          </View>
          <View
            style={[styles.locationButton, { backgroundColor: colors.border }]}
          >
            <View
              style={{
                width: 100,
                height: 16,
                backgroundColor: colors.border,
                borderRadius: 4,
              }}
            />
          </View>
        </View>

        {/* Skeleton Cards - Twitter Style */}
        <FlatList
          data={[1, 2, 3, 4, 5]}
          renderItem={() => <TwitterSkeleton colors={colors} />}
          keyExtractor={(item) => item.toString()}
          showsVerticalScrollIndicator={false}
        />
      </View>
    );
  }

  // Error state
  if (error && posts.length === 0) {
    return (
      <View
        style={[styles.centerContainer, { backgroundColor: colors.background }]}
      >
        <Ionicons name="alert-circle-outline" size={64} color="#E74C3C" />
        <Text style={[styles.emptyText, { color: colors.text, marginTop: 16 }]}>
          Failed to load feed
        </Text>
        <Text
          style={[
            styles.emptySubtext,
            {
              color: colors.gray,
              marginTop: 8,
              textAlign: "center",
              paddingHorizontal: 20,
            },
          ]}
        >
          {error}
        </Text>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: colors.primary }]}
          onPress={loadFeed}
        >
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Location Bar - Modern Design */}
      <View
        style={[
          styles.locationBar,
          { backgroundColor: isDark ? "#1a1a1a" : "#f8f9fa" },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.locationInfo,
            { backgroundColor: isDark ? "#252525" : "#fff" },
          ]}
          onPress={refreshLocation}
          disabled={isLoadingLocation}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.locationIconContainer,
              {
                backgroundColor: isUsingRealLocation
                  ? colors.primary + "15"
                  : colors.gray + "15",
              },
            ]}
          >
            <Ionicons
              name={isUsingRealLocation ? "location" : "location-outline"}
              size={16}
              color={isUsingRealLocation ? colors.primary : colors.gray}
            />
          </View>
          <View style={styles.locationTextContainer}>
            <Text style={[styles.locationLabel, { color: colors.gray }]}>
              {isUsingRealLocation ? "Your Location" : "Default Location"}
            </Text>
            <Text
              style={[styles.locationBarText, { color: colors.text }]}
              numberOfLines={1}
            >
              {locationName}
            </Text>
          </View>
          {isLoadingLocation ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <View
              style={[
                styles.refreshButton,
                { backgroundColor: colors.primary },
              ]}
            >
              <Ionicons name="navigate" size={14} color="#fff" />
            </View>
          )}
        </TouchableOpacity>

      </View>

      {/* Feed List */}
      <FlatList
        data={posts}
        renderItem={renderPost}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => null}
        // Performance optimizations
        removeClippedSubviews={true}
        maxToRenderPerBatch={5}
        windowSize={10}
        initialNumToRender={3}
        updateCellsBatchingPeriod={100}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        // Step 53: Pagination - load more on reaching end
        onEndReached={() => handleLoadMore()}
        onEndReachedThreshold={0.5}
        // Step 53: Show loading indicator while loading more
        ListFooterComponent={
          isLoadingMore && hasMore ? (
            <View style={{ padding: 16, alignItems: "center" }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={{ color: colors.gray, marginTop: 8 }}>
                Loading more posts...
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="newspaper-outline" size={64} color={colors.gray} />
            <Text style={[styles.emptyText, { color: colors.gray }]}>
              No posts found nearby
            </Text>
            <Text style={[styles.emptySubtext, { color: colors.gray }]}>
              Be the first to report something in your area!
            </Text>
          </View>
        }
      />

      {/* Video Player Modal */}
      {videoModalVisible && !!currentVideoUri && (
        <VideoPlayerModal
          visible={videoModalVisible}
          uri={currentVideoUri}
          onClose={() => {
            setVideoModalVisible(false);
            setCurrentVideoUri(null);
          }}
          colors={colors}
        />
      )}

      {/* Image Viewer Modal */}
      <ImageViewerModal
        visible={imageModalVisible}
        images={currentImages}
        initialIndex={currentImageIndex}
        onClose={() => {
          setImageModalVisible(false);
          setCurrentImages([]);
          setCurrentImageIndex(0);
        }}
      />

      {/* Credibility Info Modal */}
      <Modal
        visible={credibilityModal.visible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setCredibilityModal({ visible: false, score: 0 })}
      >
        <TouchableOpacity
          style={styles.credibilityOverlay}
          activeOpacity={1}
          onPress={() => setCredibilityModal({ visible: false, score: 0 })}
        >
          <View
            style={[
              styles.credibilityCard,
              { backgroundColor: colors.surface },
            ]}
          >
            {/* Circular Progress Indicator */}
            <View style={styles.credibilityCircleContainer}>
              <View
                style={[
                  styles.credibilityCircle,
                  {
                    borderColor: getCredibilityColor(credibilityModal.score),
                    backgroundColor:
                      getCredibilityColor(credibilityModal.score) + "15",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.credibilityPercentage,
                    { color: getCredibilityColor(credibilityModal.score) },
                  ]}
                >
                  {Math.round(credibilityModal.score * 100)}%
                </Text>
              </View>
            </View>

            {/* Label */}
            <View
              style={[
                styles.credibilityLabelBadge,
                {
                  backgroundColor:
                    getCredibilityColor(credibilityModal.score) + "20",
                },
              ]}
            >
              <Ionicons
                name={
                  credibilityModal.score >= 0.7
                    ? "shield-checkmark"
                    : credibilityModal.score >= 0.4
                      ? "shield-half"
                      : "shield-outline"
                }
                size={16}
                color={getCredibilityColor(credibilityModal.score)}
              />
              <Text
                style={[
                  styles.credibilityLabel,
                  { color: getCredibilityColor(credibilityModal.score) },
                ]}
              >
                {credibilityModal.score >= 0.7
                  ? "High Credibility"
                  : credibilityModal.score >= 0.4
                    ? "Medium Credibility"
                    : "Low Credibility"}
              </Text>
            </View>

            {/* Description */}
            <Text
              style={[styles.credibilityDescription, { color: colors.gray }]}
            >
              This score is calculated using AI analysis of media authenticity,
              content verification, and community feedback.
            </Text>

            {/* Tap to dismiss hint */}
            <Text style={[styles.credibilityHint, { color: colors.gray }]}>
              Tap anywhere to dismiss
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Location Info Modal */}
      <Modal
        visible={locationModal.visible}
        transparent={true}
        animationType="fade"
        onRequestClose={() =>
          setLocationModal({ ...locationModal, visible: false })
        }
      >
        <TouchableOpacity
          style={styles.credibilityOverlay}
          activeOpacity={1}
          onPress={() => setLocationModal({ ...locationModal, visible: false })}
        >
          <View
            style={[styles.locationCard, { backgroundColor: colors.surface }]}
          >
            {/* Map Pin Icon */}
            <View
              style={[
                styles.locationIconCircle,
                { backgroundColor: colors.primary + "15" },
              ]}
            >
              <Ionicons name="location" size={32} color={colors.primary} />
            </View>

            {/* Location Name */}
            <Text style={[styles.locationTitle, { color: colors.text }]}>
              {locationModal.name}
            </Text>

            {/* Coordinates */}
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

            {/* Distance Badge */}
            {locationModal.distance && (
              <TouchableOpacity
                style={[
                  styles.distanceBadge,
                  { backgroundColor: colors.primary },
                ]}
                onPress={handleNavigateFromLocationModal}
                activeOpacity={0.85}
              >
                <Ionicons name="navigate" size={14} color="#fff" />
                <Text style={styles.distanceText}>
                  {locationModal.distance < 1
                    ? `${Math.round(locationModal.distance * 1000)} meters away`
                    : `${locationModal.distance.toFixed(1)} km away`}
                </Text>
              </TouchableOpacity>
            )}

            {/* Tap to dismiss hint */}
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
  container: {
    flex: 1,
  },
  locationBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },
  locationInfo: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    gap: 12,
    flex: 1,
    minWidth: 220,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  locationIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  locationTextContainer: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  locationBarText: {
    fontSize: 14,
    fontWeight: "600",
  },
  refreshButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  defaultBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  defaultBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  locationButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  locationButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
  },
  searchInput: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  searchPlaceholder: {
    fontSize: 15,
  },
  filterButton: {
    padding: 10,
    borderRadius: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 4,
  },
  radiusButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
  },
  radiusText: {
    fontSize: 14,
    fontWeight: "600",
  },
  categoryContainer: {
    maxHeight: 60,
  },
  categoryList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  categoryChipText: {
    fontSize: 14,
    fontWeight: "600",
  },
  feedList: {
    padding: 16,
  },
  postCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  locationHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  locationText: {
    fontSize: 13,
    fontWeight: "600",
  },
  credibilityBar: {
    marginBottom: 12,
  },
  credibilityBarBg: {
    height: 6,
    backgroundColor: "rgba(128, 128, 128, 0.2)",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 6,
  },
  credibilityBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  credibilityInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  credibilityPercentText: {
    fontSize: 12,
    fontWeight: "600",
  },
  categoryBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: "600",
  },
  distanceText: {
    fontSize: 11,
    fontWeight: "500",
  },
  timeText: {
    fontSize: 11,
  },
  contentText: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  mediaImage: {
    width: "100%",
    height: 200,
    borderRadius: 8,
    marginBottom: 12,
  },
  // Two image grid
  mediaGrid2: {
    flexDirection: "row",
    gap: 4,
    marginBottom: 12,
  },
  mediaGrid2Item: {
    flex: 1,
    height: 150,
    borderRadius: 8,
  },
  // Three image grid
  mediaGrid3: {
    flexDirection: "row",
    gap: 4,
    height: 200,
    marginBottom: 12,
  },
  mediaGrid3Left: {
    flex: 2,
  },
  mediaGrid3Large: {
    width: "100%",
    height: "100%",
    borderRadius: 8,
  },
  mediaGrid3Right: {
    flex: 1,
    gap: 4,
  },
  mediaGrid3Small: {
    width: "100%",
    height: "100%",
    borderRadius: 8,
  },
  mediaGrid3SmallWrapper: {
    flex: 1,
    position: "relative",
  },
  mediaOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  mediaOverlayText: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
  },
  postFooter: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(128, 128, 128, 0.2)",
  },
  votingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },
  voteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  commentButton: {
    padding: 4,
    marginLeft: "auto",
  },
  flagButton: {
    padding: 4,
    marginLeft: 8,
  },
  voteText: {
    fontSize: 14,
    fontWeight: "500",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 12,
    fontWeight: "600",
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 4,
  },
  retryButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  // Video Modal Styles
  videoModalContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  videoCloseButton: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 10,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: 25,
  },
  videoWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.7,
    justifyContent: "center",
    alignItems: "center",
  },
  videoPlayer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.7,
  },
  videoLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  videoErrorContainer: {
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  videoErrorText: {
    color: "#fff",
    fontSize: 18,
    marginTop: 16,
    textAlign: "center",
  },
  videoRetryButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 8,
  },
  videoRetryText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  // Image viewer styles
  imageViewerWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.85,
  },
  imageSlide: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  imageCounter: {
    position: "absolute",
    top: 50,
    left: 20,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    zIndex: 10,
  },
  imageCounterText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  paginationDots: {
    position: "absolute",
    bottom: 50,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.4)",
    marginHorizontal: 4,
  },
  paginationDotActive: {
    backgroundColor: "#fff",
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  // Credibility Modal Styles
  credibilityOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  credibilityCard: {
    width: "100%",
    maxWidth: 300,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 15,
  },
  credibilityCircleContainer: {
    marginBottom: 20,
  },
  credibilityCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  credibilityPercentage: {
    fontSize: 32,
    fontWeight: "800",
  },
  credibilityLabelBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
    marginBottom: 16,
  },
  credibilityLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
  credibilityDescription: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
  },
  credibilityHint: {
    fontSize: 12,
    opacity: 0.6,
  },
  // Location Modal Styles
  locationCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 15,
  },
  locationIconCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  locationTitle: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 20,
  },
  coordinatesContainer: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 16,
  },
  coordinateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  coordinateLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  coordinateValue: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  coordinateDivider: {
    height: 1,
    width: "100%",
  },
  distanceBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
  },
  distanceText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});

// ============ TWITTER-STYLE STYLESHEET ============
const twitterStyles = StyleSheet.create({
  // Post container - no cards, just dividers
  post: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  postContent: {
    flexDirection: "row",
  },
  // Avatar
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarSkeleton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  // Post body (right side of avatar)
  postBody: {
    flex: 1,
  },
  // Header row: name, handle, time
  postHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 2,
  },
  displayName: {
    fontSize: 15,
    fontWeight: "700",
  },
  handle: {
    fontSize: 14,
    marginLeft: 4,
  },
  dot: {
    fontSize: 14,
    marginHorizontal: 4,
  },
  time: {
    fontSize: 14,
  },
  // Handle/subtitle text (location line)
  handleText: {
    fontSize: 13,
    marginBottom: 6,
  },
  // Location pill (tappable with visual hint)
  locationTouchable: {
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  locationPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 5,
    maxWidth: "100%",
  },
  locationPillText: {
    fontSize: 12,
    fontWeight: "500",
    flexShrink: 1,
  },
  // Credibility indicator dot on avatar
  credibilityDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#fff",
  },
  // Category badge (inline)
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: "600",
  },
  // Step 54: Recommendation reason badge
  recommendationBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
    marginTop: 6,
    alignSelf: "flex-start",
  },
  recommendationBadgeText: {
    fontSize: 12,
    fontWeight: "500",
  },
  // Location & credibility row
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    flexWrap: "wrap",
  },
  locationBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginRight: 8,
  },
  locationText: {
    fontSize: 12,
    marginLeft: 4,
    fontWeight: "500",
  },
  credibilityBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  credibilityText: {
    fontSize: 12,
    marginLeft: 4,
    fontWeight: "600",
  },
  // Content text
  contentText: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 12,
  },
  // Media
  mediaContainerWrapper: {
    position: "relative",
    marginBottom: 12,
  },
  mediaContainer: {
    borderRadius: 16,
    overflow: "hidden",
  },
  // Swipeable carousel
  mediaCarousel: {
    borderRadius: 16,
    overflow: "hidden",
    height: 250,
  },
  mediaSlide: {
    borderRadius: 16,
    overflow: "hidden",
    height: 250,
    justifyContent: "center",
    alignItems: "center",
  },
  // Dot indicators
  dotIndicatorContainer: {
    position: "absolute",
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    zIndex: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  activeDot: {
    backgroundColor: "#fff",
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  inactiveDot: {
    backgroundColor: "rgba(255, 255, 255, 0.5)",
  },
  singleMedia: {
    width: "100%",
    height: "100%",
    borderRadius: 16,
  },
  mediaGrid2: {
    flexDirection: "row",
    gap: 2,
    borderRadius: 16,
    overflow: "hidden",
  },
  mediaGrid2Item: {
    flex: 1,
    height: 180,
  },
  mediaGrid3: {
    flexDirection: "row",
    gap: 2,
    height: 200,
    borderRadius: 16,
    overflow: "hidden",
  },
  mediaGrid3Left: {
    flex: 2,
  },
  mediaGrid3Large: {
    width: "100%",
    height: "100%",
  },
  mediaGrid3Right: {
    flex: 1,
    gap: 2,
  },
  mediaGrid3Small: {
    width: "100%",
    height: "100%",
  },
  mediaGrid3SmallWrapper: {
    flex: 1,
    position: "relative",
  },
  mediaOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  mediaOverlayText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
  },
  // Media counter badge
  mediaCounterBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    zIndex: 10,
  },
  mediaCounterText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  // Action bar
  actionBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
    paddingRight: 48,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    marginLeft: -8,
  },
  actionText: {
    fontSize: 13,
    marginLeft: 4,
  },
  // Skeleton styles
  skeletonHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  skeletonName: {
    width: 100,
    height: 14,
    borderRadius: 4,
  },
  skeletonHandle: {
    width: 80,
    height: 12,
    borderRadius: 4,
    marginLeft: 8,
  },
  skeletonText: {
    height: 14,
    borderRadius: 4,
    marginBottom: 8,
  },
  skeletonMedia: {
    width: "100%",
    height: 180,
    borderRadius: 16,
    marginTop: 4,
    marginBottom: 8,
  },
  skeletonActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingRight: 48,
    marginTop: 8,
  },
  skeletonAction: {
    width: 40,
    height: 16,
    borderRadius: 4,
  },
});
