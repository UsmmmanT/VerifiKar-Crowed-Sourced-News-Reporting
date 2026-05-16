import { Ionicons } from "@expo/vector-icons";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Platform,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { useTheme } from "../../styles/ThemeContext";

export default function ReviewStep({
  media,
  description,
  location,
  selectedCoordinates,
  onSubmit,
  onEditMedia,
  onEditDescription,
  onEditLocation,
  isSubmitting,
}) {
  const { colors, isDark } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.checkIcon, { backgroundColor: "#10b981" + "20" }]}>
            <Ionicons name="checkmark-circle" size={32} color="#10b981" />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Review your report</Text>
          <Text style={[styles.subtitle, { color: colors.gray }]}>
            Make sure everything looks correct before submitting
          </Text>
        </View>

        {/* Media Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="images-outline" size={20} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Media</Text>
            </View>
            <TouchableOpacity onPress={onEditMedia} style={styles.editBtn}>
              <Ionicons name="pencil" size={16} color={colors.primary} />
              <Text style={[styles.editBtnText, { color: colors.primary }]}>Edit</Text>
            </TouchableOpacity>
          </View>

          {media.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.mediaRow}>
                {media.map((item, index) => (
                  <View key={index} style={styles.mediaThumb}>
                    <Image source={{ uri: item.uri }} style={styles.mediaImage} />
                    {item.type === "video" && (
                      <View style={styles.videoOverlay}>
                        <Ionicons name="play-circle" size={28} color="#fff" />
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : (
            <View style={[styles.emptySection, { backgroundColor: isDark ? "#1e1e1e" : "#f8f9fa" }]}>
              <Ionicons name="images-outline" size={24} color={colors.gray} />
              <Text style={[styles.emptyText, { color: colors.gray }]}>No media attached</Text>
            </View>
          )}
        </View>

        {/* Category section removed. Only media, description, and location are shown in review. */}

        {/* Description Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="document-text-outline" size={20} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Description</Text>
            </View>
            <TouchableOpacity onPress={onEditDescription} style={styles.editBtn}>
              <Ionicons name="pencil" size={16} color={colors.primary} />
              <Text style={[styles.editBtnText, { color: colors.primary }]}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.descriptionBox, { backgroundColor: isDark ? "#1e1e1e" : "#f8f9fa" }]}>
            <Text style={[styles.descriptionText, { color: colors.text }]}>{description}</Text>
          </View>
        </View>

        {/* Location Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="location-outline" size={20} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Location</Text>
            </View>
            <TouchableOpacity onPress={onEditLocation} style={styles.editBtn}>
              <Ionicons name="pencil" size={16} color={colors.primary} />
              <Text style={[styles.editBtnText, { color: colors.primary }]}>Edit</Text>
            </TouchableOpacity>
          </View>

          {selectedCoordinates ? (
            <View style={styles.locationContent}>
              <View style={styles.mapPreview}>
                <MapView
                  style={styles.miniMap}
                  region={{
                    ...selectedCoordinates,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  }}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  pitchEnabled={false}
                  rotateEnabled={false}
                >
                  <Marker coordinate={selectedCoordinates} />
                </MapView>
              </View>
              <View style={[styles.locationAddress, { backgroundColor: isDark ? "#1e1e1e" : "#f8f9fa" }]}>
                <Ionicons name="location" size={18} color={colors.primary} />
                <Text style={[styles.locationText, { color: colors.text }]} numberOfLines={2}>
                  {location}
                </Text>
              </View>
            </View>
          ) : (
            <View style={[styles.emptySection, { backgroundColor: isDark ? "#1e1e1e" : "#f8f9fa" }]}>
              <Ionicons name="location-outline" size={24} color={colors.gray} />
              <Text style={[styles.emptyText, { color: colors.gray }]}>No location selected</Text>
            </View>
          )}
        </View>

        {/* Privacy Notice */}
        <View style={[styles.privacyNotice, { backgroundColor: isDark ? "rgba(16, 185, 129, 0.1)" : "rgba(16, 185, 129, 0.08)" }]}>
          <Ionicons name="shield-checkmark" size={20} color="#10b981" />
          <View style={styles.privacyContent}>
            <Text style={[styles.privacyTitle, { color: colors.text }]}>Your privacy is protected</Text>
            <Text style={[styles.privacyText, { color: colors.gray }]}>
              Your identity remains anonymous. Only the report content is shared.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Bottom Submit Button */}
      <View style={[styles.bottomNav, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TouchableOpacity 
          style={[
            styles.submitBtn, 
            { backgroundColor: colors.primary },
            isSubmitting && { opacity: 0.7 }
          ]}
          onPress={onSubmit}
          disabled={isSubmitting}
        >
          <Ionicons name="paper-plane" size={20} color="#fff" />
          <Text style={styles.submitBtnText}>
            {isSubmitting ? "Submitting..." : "Submit Report"}
          </Text>
        </TouchableOpacity>
        
        <Text style={[styles.footerText, { color: colors.gray }]}>
          Your report will help keep the community informed
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 20,
  },
  header: {
    alignItems: "center",
    marginBottom: 28,
  },
  checkIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  editBtnText: {
    fontSize: 14,
    fontWeight: "500",
  },
  mediaRow: {
    flexDirection: "row",
    gap: 10,
  },
  mediaThumb: {
    width: 100,
    height: 100,
    borderRadius: 12,
    overflow: "hidden",
  },
  mediaImage: {
    width: "100%",
    height: "100%",
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  emptySection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    borderRadius: 12,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
  },
  categoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
  },
  categoryText: {
    fontSize: 14,
    fontWeight: "600",
  },
  descriptionBox: {
    padding: 16,
    borderRadius: 12,
  },
  descriptionText: {
    fontSize: 15,
    lineHeight: 22,
  },
  locationContent: {
    gap: 12,
  },
  mapPreview: {
    height: 140,
    borderRadius: 12,
    overflow: "hidden",
  },
  miniMap: {
    width: "100%",
    height: "100%",
  },
  locationAddress: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    gap: 10,
  },
  locationText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  privacyNotice: {
    flexDirection: "row",
    padding: 16,
    borderRadius: 14,
    gap: 12,
  },
  privacyContent: {
    flex: 1,
  },
  privacyTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  privacyText: {
    fontSize: 13,
    lineHeight: 18,
  },
  bottomNav: {
    padding: 16,
    paddingBottom: Platform.OS === "ios" ? 32 : 16,
    borderTopWidth: 1,
    alignItems: "center",
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  footerText: {
    fontSize: 13,
    marginTop: 12,
    textAlign: "center",
  },
});
