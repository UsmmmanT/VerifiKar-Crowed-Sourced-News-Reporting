import { Ionicons } from "@expo/vector-icons";
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
} from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Alert,
  ActivityIndicator,
  Dimensions,
  Animated,
} from "react-native";
import { useTheme } from "../../styles/ThemeContext";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function CameraStep({
  media,
  setMedia,
  onNext,
  onSkip,
  onCancel,
  onBack,
  editingFromReview,
}) {
  const { colors, isDark } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [cameraMode, setCameraMode] = useState("picture"); // 'picture' or 'video'
  const [facing, setFacing] = useState("back");
  const [isRecording, setIsRecording] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const cameraRef = useRef(null);

  // Toast notification state
  const [toast, setToast] = useState({
    visible: false,
    message: "",
    type: "error",
  });
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(-20)).current;
  const toastTimeoutRef = useRef(null);

  // Show toast notification
  const showToast = (message, type = "error") => {
    // Clear any existing timeout
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    // Reset animation values immediately
    toastOpacity.setValue(0);
    toastTranslateY.setValue(-20);

    // Set toast state
    setToast({ visible: true, message, type });

    // Animate in
    Animated.parallel([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(toastTranslateY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto hide after 3 seconds
    toastTimeoutRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateY, {
          toValue: -20,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setToast({ visible: false, message: "", type: "error" });
      });
    }, 3000);
  };

  // Request camera permission on mount
  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  // Request microphone permission when switching to video mode
  useEffect(() => {
    if (cameraMode === "video" && !micPermission?.granted) {
      requestMicPermission();
    }
  }, [cameraMode]);

  const handleTakePhoto = async () => {
    if (!cameraRef.current || !isCameraReady) return;

    if (media.length >= 5) {
      showToast("Maximum 5 files allowed", "warning");
      return;
    }

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
      });
      if (photo?.uri) {
        setMedia([...media, { uri: photo.uri, type: "image" }]);
      }
    } catch (error) {
      console.error("Error taking photo:", error);
      showToast("Failed to take photo", "error");
    }
  };

  const handleStopRecording = async () => {
    if (cameraRef.current && isRecording) {
      try {
        await cameraRef.current.stopRecording();
      } catch (error) {
        console.error("Error stopping recording:", error);
      }
    }
  };

  const handlePickFromGallery = async () => {
    if (media.length >= 5) {
      showToast("Maximum 5 files allowed", "warning");
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsEditing: false,
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: 5 - media.length,
    });

    if (!result.canceled) {
      const newMedia = result.assets.map((asset) => ({
        uri: asset.uri,
        type: asset.type === "video" ? "video" : "image",
      }));
      setMedia([...media, ...newMedia].slice(0, 5));
    }
  };

  const removeMedia = (index) => {
    setMedia(media.filter((_, i) => i !== index));
  };

  const toggleCameraFacing = () => {
    setFacing((current) => (current === "back" ? "front" : "back"));
  };

  // Permission not granted yet
  if (!permission) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Permission denied - show alternative
  if (!permission.granted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.permissionContainer}>
          <View
            style={[
              styles.permissionIcon,
              { backgroundColor: colors.primary + "20" },
            ]}
          >
            <Ionicons name="camera-outline" size={48} color={colors.primary} />
          </View>
          <Text style={[styles.permissionTitle, { color: colors.text }]}>
            Camera Access Needed
          </Text>
          <Text style={[styles.permissionText, { color: colors.gray }]}>
            To capture photos or videos of incidents, we need camera access.
          </Text>
          <TouchableOpacity
            style={[styles.permissionBtn, { backgroundColor: colors.primary }]}
            onPress={requestPermission}
          >
            <Text style={styles.permissionBtnText}>Grant Access</Text>
          </TouchableOpacity>

          <View style={styles.alternativeSection}>
            <Text style={[styles.orText, { color: colors.gray }]}>— or —</Text>
            <TouchableOpacity
              style={[
                styles.galleryBtn,
                {
                  backgroundColor: isDark ? "#1e1e1e" : "#f8f9fa",
                  borderColor: colors.border,
                },
              ]}
              onPress={handlePickFromGallery}
            >
              <Ionicons
                name="images-outline"
                size={20}
                color={colors.primary}
              />
              <Text style={[styles.galleryBtnText, { color: colors.text }]}>
                Choose from Gallery
              </Text>
            </TouchableOpacity>
            {!editingFromReview && (
              <TouchableOpacity onPress={onCancel}>
                <Text style={[styles.skipText, { color: colors.primary }]}>
                  Cancel and return home
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onSkip}>
              <Text style={[styles.skipText, { color: colors.primary }]}>
                Skip this step →
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  const handleStartRecording = async () => {
    // Prevent starting a new recording if one is already in progress
    if (isRecording) {
      return;
    }

    if (media.length >= 5) {
      showToast("Maximum 5 files allowed", "warning");
      return;
    }

    // Check microphone permission before recording
    if (!micPermission?.granted) {
      const result = await requestMicPermission();
      if (!result.granted) {
        showToast("Microphone access required for video", "error");
        return;
      }
    }

    try {
      setIsRecording(true);
      const video = await cameraRef.current.recordAsync({
        maxDuration: 60,
      });
      if (video?.uri) {
        setMedia([...media, { uri: video.uri, type: "video" }]);
      }
    } catch (error) {
      console.error("Error recording video:", error);
      // Only show error if it's not a "recording already in progress" error
      if (!error.message?.includes("already in progress")) {
        showToast("Failed to record video", "error");
      }
    } finally {
      setIsRecording(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: "#000" }]}>
      {/* Modern Toast Notification */}
      {toast.visible && (
        <Animated.View
          style={[
            styles.toastContainer,
            {
              opacity: toastOpacity,
              transform: [{ translateY: toastTranslateY }],
              backgroundColor:
                toast.type === "warning"
                  ? "#f59e0b"
                  : toast.type === "success"
                  ? "#10b981"
                  : "#ef4444",
            },
          ]}
        >
          <View style={styles.toastContent}>
            <Ionicons
              name={
                toast.type === "warning"
                  ? "warning"
                  : toast.type === "success"
                  ? "checkmark-circle"
                  : "close-circle"
              }
              size={20}
              color="#fff"
            />
            <Text style={styles.toastText}>{toast.message}</Text>
          </View>
        </Animated.View>
      )}

      {/* Camera View - NO CHILDREN (expo-camera requirement) */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        mode={cameraMode}
        onCameraReady={() => setIsCameraReady(true)}
      />

      {/* Overlay Container - Positioned absolutely on top of camera */}
      <View style={styles.overlay} pointerEvents="box-none">
        {/* Top Bar */}
        <View style={styles.topBar}>
          {!editingFromReview && (
            <TouchableOpacity style={styles.topBtn} onPress={onCancel}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          )}
          {editingFromReview && <View style={styles.topBtn} />}

          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[
                styles.modeBtn,
                cameraMode === "picture" && styles.modeBtnActive,
              ]}
              onPress={() => setCameraMode("picture")}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  cameraMode === "picture" && styles.modeBtnTextActive,
                ]}
              >
                Photo
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modeBtn,
                cameraMode === "video" && styles.modeBtnActive,
              ]}
              onPress={() => setCameraMode("video")}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  cameraMode === "video" && styles.modeBtnTextActive,
                ]}
              >
                Video
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.topBtn} onPress={toggleCameraFacing}>
            <Ionicons name="camera-reverse-outline" size={26} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Media Thumbnails */}
        {media.length > 0 && (
          <View style={styles.thumbnailWrapper}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbnailContainer}
            >
              {media.map((item, index) => (
                <View key={index} style={styles.thumbnail}>
                  <Image
                    source={{ uri: item.uri }}
                    style={styles.thumbnailImage}
                  />
                  {item.type === "video" && (
                    <View style={styles.videoOverlay}>
                      <Ionicons name="play" size={16} color="#fff" />
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.removeThumbnail}
                    onPress={() => removeMedia(index)}
                  >
                    <Ionicons name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              <View style={styles.thumbnailCount}>
                <Text style={styles.thumbnailCountText}>{media.length}/5</Text>
              </View>
            </ScrollView>
          </View>
        )}

        {/* Recording indicator */}
        {isRecording && (
          <View style={styles.recordingIndicator}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>Recording...</Text>
          </View>
        )}

        {/* Bottom Bar */}
        <View style={styles.bottomBar}>
          {/* Gallery Button */}
          <TouchableOpacity
            style={styles.sideBtn}
            onPress={handlePickFromGallery}
          >
            <View style={styles.galleryIcon}>
              <Ionicons name="images-outline" size={24} color="#fff" />
            </View>
            <Text style={styles.nextText}>Gallery</Text>
          </TouchableOpacity>

          {/* Main Capture Button */}
          {cameraMode === "picture" ? (
            <TouchableOpacity
              style={styles.captureBtn}
              onPress={handleTakePhoto}
              disabled={!isCameraReady}
            >
              <View style={styles.captureOuter}>
                <View style={styles.captureInner} />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.captureBtn}
              onPress={isRecording ? handleStopRecording : handleStartRecording}
              disabled={!isCameraReady}
            >
              <View
                style={[
                  styles.captureOuter,
                  isRecording && styles.recordingOuter,
                ]}
              >
                <View
                  style={[
                    styles.captureInner,
                    isRecording && styles.recordingInner,
                  ]}
                />
              </View>
            </TouchableOpacity>
          )}

          {/* Next / Continue Button */}
          <TouchableOpacity
            style={[
              styles.sideBtn,
              (media.length > 0 || editingFromReview) && styles.nextBtnActive,
            ]}
            onPress={
              editingFromReview ? onNext : media.length > 0 ? onNext : onSkip
            }
          >
            <View
              style={[
                styles.nextIcon,
                (media.length > 0 || editingFromReview) && {
                  backgroundColor: "#10b981",
                },
              ]}
            >
              <Ionicons
                name={editingFromReview ? "checkmark" : "arrow-forward"}
                size={22}
                color="#fff"
              />
            </View>
            <Text style={styles.nextText}>
              {editingFromReview ? "Done" : media.length > 0 ? "Next" : "Skip"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Toast styles
  toastContainer: {
    position: "absolute",
    top: 60,
    left: 20,
    right: 20,
    zIndex: 1000,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  toastContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  toastText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 50,
    paddingHorizontal: 16,
  },
  topBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  modeToggle: {
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 20,
    padding: 4,
  },
  modeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  modeBtnActive: {
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  modeBtnText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "500",
  },
  modeBtnTextActive: {
    color: "#fff",
  },
  thumbnailWrapper: {
    position: "absolute",
    bottom: 140,
    left: 0,
    right: 0,
  },
  thumbnailContainer: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: "center",
    flexDirection: "row",
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#fff",
  },
  thumbnailImage: {
    width: "100%",
    height: "100%",
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  removeThumbnail: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  thumbnailCount: {
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  thumbnailCountText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  recordingIndicator: {
    position: "absolute",
    top: 110,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ef4444",
    marginRight: 6,
  },
  recordingText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
  },
  bottomBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  sideBtn: {
    alignItems: "center",
  },
  galleryIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  nextIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  nextBtnActive: {},
  nextText: {
    color: "#fff",
    fontSize: 12,
    marginTop: 4,
    fontWeight: "500",
  },
  captureBtn: {
    width: 80,
    height: 80,
    justifyContent: "center",
    alignItems: "center",
  },
  captureOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  captureInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#fff",
  },
  recordingOuter: {
    borderColor: "#ef4444",
  },
  recordingInner: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: "#ef4444",
  },
  // Permission screen styles
  permissionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  permissionIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  permissionText: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  permissionBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  permissionBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  alternativeSection: {
    marginTop: 32,
    alignItems: "center",
  },
  orText: {
    fontSize: 14,
    marginBottom: 16,
  },
  galleryBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 10,
    marginBottom: 16,
  },
  galleryBtnText: {
    fontSize: 15,
    fontWeight: "500",
  },
  skipText: {
    fontSize: 15,
    fontWeight: "500",
  },
});
