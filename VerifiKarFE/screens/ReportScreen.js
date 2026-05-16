import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import {
    Alert,
    Modal,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE_URL } from "../config";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../styles/ThemeContext";

// Step components
import CameraStep from "./report/CameraStep";
import DescriptionStep from "./report/DescriptionStep";
import LocationStep from "./report/LocationStep";
import ReviewStep from "./report/ReviewStep";

const STEPS = {
  CAMERA: 0,
  DESCRIPTION: 1,
  LOCATION: 2,
  REVIEW: 3,
};

export default function ReportScreen() {
  const { colors, isDark } = useTheme();
  const { user, getValidAccessToken } = useAuth();
  const navigation = useNavigation();

  // Step state
  const [currentStep, setCurrentStep] = useState(STEPS.CAMERA);
  const [editingFromReview, setEditingFromReview] = useState(false); // Track if editing from review

  // Form state (preserved from original)
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [media, setMedia] = useState([]);
  const [selectedCoordinates, setSelectedCoordinates] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [errors, setErrors] = useState({
    description: "",
    location: "",
  });

  // Modal states (preserved from original)
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Check for pending reports on mount and retry them (PRESERVED FROM ORIGINAL)
  useEffect(() => {
    const retryPendingReports = async () => {
      try {
        const pendingReports = JSON.parse(
          (await AsyncStorage.getItem("@verifikar_pending_reports")) || "[]",
        );
        if (pendingReports.length === 0) return;

        setPendingCount(pendingReports.length);

        // New logic: refresh token before retrying pending reports.
        const latestToken = await getValidAccessToken();
        if (!latestToken) {
          return;
        }

        const successfulIds = [];

        for (const report of pendingReports) {
          try {
            const formData = new FormData();
            formData.append("raw_text", report.descriptionText);
            formData.append("location", JSON.stringify(report.locationData));

            const images = report.mediaItems.filter(
              (item) => item.type === "image",
            );
            const videos = report.mediaItems.filter(
              (item) => item.type === "video",
            );

            images.forEach((image, index) => {
              const uriParts = image.uri.split(".");
              const fileType = uriParts[uriParts.length - 1];
              formData.append("images", {
                uri: image.uri,
                name: `image_${index}.${fileType}`,
                type: `image/${fileType}`,
              });
            });

            videos.forEach((video, index) => {
              const uriParts = video.uri.split(".");
              const fileType = uriParts[uriParts.length - 1];
              formData.append("videos", {
                uri: video.uri,
                name: `video_${index}.${fileType}`,
                type: `video/${fileType}`,
              });
            });

            const response = await fetch(`${API_BASE_URL}/reports/submit`, {
              method: "POST",
              headers: { Authorization: `Bearer ${latestToken}` },
              body: formData,
            });

            if (response.ok) {
              successfulIds.push(report.id);
            }
          } catch (err) {
            // Keep in queue for next retry
          }
        }

        if (successfulIds.length > 0) {
          const remaining = pendingReports.filter(
            (r) => !successfulIds.includes(r.id),
          );
          await AsyncStorage.setItem(
            "@verifikar_pending_reports",
            JSON.stringify(remaining),
          );
          setPendingCount(remaining.length);
        }
      } catch (error) {
        console.log("Error retrying pending reports:", error);
      }
    };

    retryPendingReports();
  }, []);

  // Navigation functions
  const goToStep = (step) => {
    setCurrentStep(step);
  };

  // Go to step for editing (from review page)
  const goToStepForEdit = (step) => {
    setEditingFromReview(true);
    setCurrentStep(step);
  };

  const nextStep = () => {
    if (editingFromReview) {
      // If editing from review, go back to review
      setEditingFromReview(false);
      setCurrentStep(STEPS.REVIEW);
    } else if (currentStep < STEPS.REVIEW) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (editingFromReview) {
      // If editing from review, go back to review instead of previous step
      setEditingFromReview(false);
      setCurrentStep(STEPS.REVIEW);
    } else if (currentStep > STEPS.CAMERA) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Background submit function - PRESERVED FROM ORIGINAL
  const submitReportInBackground = async (reportData) => {
    try {
      const { locationData, descriptionText, mediaItems } = reportData;

      // New logic: refresh token before submitting report.
      const currentToken = await getValidAccessToken();

      const formData = new FormData();
      formData.append("raw_text", descriptionText);
      formData.append("location", JSON.stringify(locationData));

      const images = mediaItems.filter((item) => item.type === "image");
      const videos = mediaItems.filter((item) => item.type === "video");

      images.forEach((image, index) => {
        const uriParts = image.uri.split(".");
        const fileType = uriParts[uriParts.length - 1];
        formData.append("images", {
          uri: image.uri,
          name: `image_${index}.${fileType}`,
          type: `image/${fileType}`,
        });
      });

      videos.forEach((video, index) => {
        const uriParts = video.uri.split(".");
        const fileType = uriParts[uriParts.length - 1];
        formData.append("videos", {
          uri: video.uri,
          name: `video_${index}.${fileType}`,
          type: `video/${fileType}`,
        });
      });

      const response = await fetch(`${API_BASE_URL}/reports/submit`, {
        method: "POST",
        headers: currentToken
          ? { Authorization: `Bearer ${currentToken}` }
          : {},
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          const pendingReports = JSON.parse(
            (await AsyncStorage.getItem("@verifikar_pending_reports")) || "[]",
          );
          pendingReports.push({
            id: Date.now(),
            ...reportData,
            failedAt: new Date().toISOString(),
            error: "Authentication required",
          });
          await AsyncStorage.setItem(
            "@verifikar_pending_reports",
            JSON.stringify(pendingReports),
          );
          setPendingCount(pendingReports.length);

          Alert.alert(
            "Session Expired",
            "Your report is saved. Please sign in again and it will retry automatically.",
            [{ text: "OK" }],
          );
          return;
        }

        // Store failed report for retry
        const pendingReports = JSON.parse(
          (await AsyncStorage.getItem("@verifikar_pending_reports")) || "[]",
        );
        pendingReports.push({
          id: Date.now(),
          ...reportData,
          failedAt: new Date().toISOString(),
          error: data.detail?.message || "Submission failed",
        });
        await AsyncStorage.setItem(
          "@verifikar_pending_reports",
          JSON.stringify(pendingReports),
        );
        setPendingCount(pendingReports.length);

        Alert.alert(
          "Submission Queued",
          "Your report was saved and will be submitted when connection improves.",
          [{ text: "OK" }],
        );
      }
    } catch (error) {
      // Store for retry on network failure
      const pendingReports = JSON.parse(
        (await AsyncStorage.getItem("@verifikar_pending_reports")) || "[]",
      );
      pendingReports.push({
        id: Date.now(),
        ...reportData,
        failedAt: new Date().toISOString(),
        error: "Network error",
      });
      await AsyncStorage.setItem(
        "@verifikar_pending_reports",
        JSON.stringify(pendingReports),
      );
      setPendingCount(pendingReports.length);

      Alert.alert(
        "Saved Offline",
        "Your report was saved and will be submitted when you're back online.",
        [{ text: "OK" }],
      );
    }
  };

  // Handle submit - PRESERVED LOGIC FROM ORIGINAL
  const handleSubmit = () => {
    // Validate
    if (!description.trim()) {
      Alert.alert(
        "Missing Information",
        "Please add a description of what happened.",
      );
      goToStep(STEPS.DESCRIPTION);
      return;
    }
    if (!location.trim()) {
      Alert.alert("Missing Information", "Please select a location.");
      goToStep(STEPS.LOCATION);
      return;
    }
    setShowConfirmModal(true);
  };

  // Confirm submit - PRESERVED LOGIC FROM ORIGINAL
  const confirmSubmit = async () => {
    setShowConfirmModal(false);

    // Validate token first
    // New logic: refresh token before validating.
    const token = await getValidAccessToken();
    if (!token) {
      Alert.alert("Sign In Required", "Please sign in to submit your report.");
      return;
    }

    // Validate location data
    let locationData;
    if (selectedCoordinates) {
      locationData = {
        lat: selectedCoordinates.latitude,
        lon: selectedCoordinates.longitude,
      };
    } else {
      try {
        const results = await Location.geocodeAsync(location);
        if (results && results.length > 0) {
          locationData = {
            lat: results[0].latitude,
            lon: results[0].longitude,
          };
        } else {
          Alert.alert(
            "Location Issue",
            "Please select a location using the map.",
          );
          return;
        }
      } catch (error) {
        Alert.alert("Location Issue", "We couldn't find this location.");
        return;
      }
    }

    // Capture current form data for background submission
    const reportData = {
      locationData,
      descriptionText: description,
      mediaItems: [...media],
    };

    // OPTIMISTIC: Clear form and show success immediately
    setDescription("");
    setLocation("");
    setMedia([]);
    setSelectedCoordinates(null);
    setSelectedCategory(null);
    setErrors({ description: "", location: "" });
    setCurrentStep(STEPS.CAMERA);
    setShowSuccessModal(true);

    // Submit in background - user doesn't wait
    submitReportInBackground(reportData);
  };

  // Handle skip camera step
  const handleSkipCamera = () => {
    goToStep(STEPS.DESCRIPTION);
  };

  // Handle cancel report (navigate to home)
  const handleCancelReport = () => {
    navigation.navigate("Home");
  };

  // Render current step
  const renderStep = () => {
    switch (currentStep) {
      case STEPS.CAMERA:
        return (
          <CameraStep
            media={media}
            setMedia={setMedia}
            onNext={nextStep}
            onSkip={handleSkipCamera}
            onCancel={handleCancelReport}
            onBack={editingFromReview ? prevStep : null}
            editingFromReview={editingFromReview}
          />
        );
      case STEPS.DESCRIPTION:
        return (
          <DescriptionStep
            description={description}
            setDescription={setDescription}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            media={media}
            onNext={nextStep}
            onBack={prevStep}
            errors={errors}
            setErrors={setErrors}
            editingFromReview={editingFromReview}
          />
        );
      case STEPS.LOCATION:
        return (
          <LocationStep
            location={location}
            setLocation={setLocation}
            selectedCoordinates={selectedCoordinates}
            setSelectedCoordinates={setSelectedCoordinates}
            onNext={nextStep}
            onBack={prevStep}
            errors={errors}
            setErrors={setErrors}
            editingFromReview={editingFromReview}
          />
        );
      case STEPS.REVIEW:
        return (
          <ReviewStep
            media={media}
            description={description}
            location={location}
            selectedCoordinates={selectedCoordinates}
            onSubmit={handleSubmit}
            onEditMedia={() => goToStepForEdit(STEPS.CAMERA)}
            onEditDescription={() => goToStepForEdit(STEPS.DESCRIPTION)}
            onEditLocation={() => goToStepForEdit(STEPS.LOCATION)}
            isSubmitting={isSubmitting}
          />
        );
      default:
        return null;
    }
  };

  // Step indicator labels
  const stepLabels = ["Camera", "Details", "Location", "Review"];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* Step Indicator - Only show on non-camera steps */}
      {currentStep !== STEPS.CAMERA && (
        <View
          style={[
            styles.stepIndicator,
            {
              backgroundColor: colors.background,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={styles.stepRow}>
            {[0, 1, 2, 3].map((step) => (
              <TouchableOpacity
                key={step}
                style={styles.stepItem}
                onPress={() => {
                  // Allow going back to previous steps
                  if (step <= currentStep) {
                    goToStep(step);
                  }
                }}
                disabled={step > currentStep}
              >
                <View
                  style={[
                    styles.stepDot,
                    {
                      backgroundColor:
                        step <= currentStep ? colors.primary : colors.border,
                      opacity: step > currentStep ? 0.5 : 1,
                    },
                  ]}
                >
                  {step < currentStep ? (
                    <Ionicons name="checkmark" size={12} color="#fff" />
                  ) : (
                    <Text style={styles.stepDotText}>{step + 1}</Text>
                  )}
                </View>
                <Text
                  style={[
                    styles.stepLabel,
                    {
                      color:
                        step === currentStep ? colors.primary : colors.gray,
                      fontWeight: step === currentStep ? "600" : "400",
                    },
                  ]}
                >
                  {stepLabels[step]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Progress bar */}
          <View
            style={[styles.progressBar, { backgroundColor: colors.border }]}
          >
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: colors.primary,
                  width: `${((currentStep + 1) / 4) * 100}%`,
                },
              ]}
            />
          </View>
        </View>
      )}

      {/* Pending Reports Indicator */}
      {pendingCount > 0 && currentStep !== STEPS.CAMERA && (
        <View
          style={[
            styles.pendingBanner,
            {
              backgroundColor: isDark
                ? "rgba(251, 191, 36, 0.15)"
                : "rgba(251, 191, 36, 0.1)",
            },
          ]}
        >
          <Ionicons name="cloud-upload-outline" size={18} color="#f59e0b" />
          <Text style={[styles.pendingText, { color: colors.text }]}>
            {pendingCount} report{pendingCount > 1 ? "s" : ""} uploading in
            background
          </Text>
        </View>
      )}

      {/* Current Step Content */}
      <View style={styles.stepContent}>{renderStep()}</View>

      {/* ============ MODALS (PRESERVED FROM ORIGINAL) ============ */}

      {/* Confirmation Modal */}
      <Modal
        visible={showConfirmModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View
              style={[
                styles.modalIcon,
                { backgroundColor: colors.primary + "15" },
              ]}
            >
              <Ionicons name="send" size={32} color={colors.primary} />
            </View>

            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Ready to submit?
            </Text>
            <Text style={[styles.modalText, { color: colors.gray }]}>
              Your anonymous report will help keep the community informed.
            </Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[
                  styles.modalBtnSecondary,
                  { backgroundColor: isDark ? "#2a2a2a" : "#f5f5f5" },
                ]}
                onPress={() => setShowConfirmModal(false)}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>
                  Go Back
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalBtnPrimary,
                  { backgroundColor: colors.primary },
                ]}
                onPress={confirmSubmit}
              >
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>
                  Submit
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Success Modal */}
      <Modal
        visible={showSuccessModal}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[styles.successCard, { backgroundColor: colors.surface }]}
          >
            <View style={styles.successIcon}>
              <Ionicons name="checkmark" size={40} color="#fff" />
            </View>

            <Text style={[styles.successTitle, { color: colors.text }]}>
              Thank You!
            </Text>
            <Text style={[styles.successText, { color: colors.gray }]}>
              Your report is being submitted in the background. It will be
              reviewed and shared to help keep our community informed.
            </Text>

            <TouchableOpacity
              style={[styles.successBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                setShowSuccessModal(false);
                navigation.navigate("Home");
              }}
            >
              <Text style={styles.successBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  stepIndicator: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  stepRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  stepItem: {
    alignItems: "center",
    flex: 1,
  },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 4,
  },
  stepDotText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  stepLabel: {
    fontSize: 11,
  },
  progressBar: {
    height: 3,
    borderRadius: 1.5,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 1.5,
  },
  pendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 8,
  },
  pendingText: {
    fontSize: 13,
    fontWeight: "500",
  },
  stepContent: {
    flex: 1,
  },
  // Modal styles (PRESERVED FROM ORIGINAL)
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
  },
  modalIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 10,
    textAlign: "center",
  },
  modalText: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  modalBtnSecondary: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
  },
  modalBtnPrimary: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
  },
  modalBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
  // Success Modal (PRESERVED FROM ORIGINAL)
  successCard: {
    width: "90%",
    maxWidth: 360,
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#10b981",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 12,
  },
  successText: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  successBtn: {
    width: "100%",
    padding: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  successBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
});
