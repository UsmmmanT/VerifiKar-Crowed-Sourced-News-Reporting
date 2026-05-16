import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Alert,
  Keyboard,
  ActivityIndicator,
  Platform,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { useTheme } from "../../styles/ThemeContext";

export default function LocationStep({
  location,
  setLocation,
  selectedCoordinates,
  setSelectedCoordinates,
  onNext,
  onBack,
  errors,
  setErrors,
  editingFromReview,
}) {
  const { colors, isDark } = useTheme();
  const [showMapModal, setShowMapModal] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [mapRegion, setMapRegion] = useState({
    latitude: 24.8607,
    longitude: 67.0099,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  });

  // Auto-get location on mount if not already set
  useEffect(() => {
    if (!location && !selectedCoordinates) {
      getCurrentLocation();
    }
  }, []);

  const getCurrentLocation = async () => {
    try {
      setIsGettingLocation(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Needed", "Location access helps us show your report in the right area.");
        setIsGettingLocation(false);
        return;
      }

      try {
        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          maximumAge: 10000,
          timeout: 10000,
        });
        const { latitude, longitude } = currentLocation.coords;
        setSelectedCoordinates({ latitude, longitude });
        setMapRegion({ latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 });

        try {
          const address = await Location.reverseGeocodeAsync({ latitude, longitude });
          if (address[0]) {
            const addressParts = [];
            if (address[0].street) addressParts.push(address[0].street);
            if (address[0].district) addressParts.push(address[0].district);
            if (address[0].city) addressParts.push(address[0].city);
            const addressString = addressParts.filter((p) => p).join(", ") || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            setLocation(addressString);
          }
        } catch (geocodeError) {
          setLocation(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
        }

        if (errors?.location) setErrors((prev) => ({ ...prev, location: "" }));
      } catch (locError) {
        const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 60000 });
        if (lastKnown) {
          const { latitude, longitude } = lastKnown.coords;
          setSelectedCoordinates({ latitude, longitude });
          setLocation(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
        } else {
          Alert.alert("Location Unavailable", "Please use the map to select a location.", [
            { text: "Open Map", onPress: () => setShowMapModal(true) },
            { text: "OK" },
          ]);
        }
      }
    } catch (error) {
      console.error("Location error:", error);
    } finally {
      setIsGettingLocation(false);
    }
  };

  const searchLocation = async (text) => {
    setLocation(text);
    if (text.length > 2) {
      try {
        const results = await Location.geocodeAsync(text);
        if (results.length > 0) {
          const suggestions = await Promise.all(
            results.slice(0, 5).map(async (result) => {
              try {
                const address = await Location.reverseGeocodeAsync({
                  latitude: result.latitude,
                  longitude: result.longitude,
                });
                if (address[0]) {
                  const addr = address[0];
                  const parts = [addr.street, addr.district, addr.city, addr.country].filter(Boolean);
                  return {
                    address: parts.join(", "),
                    coords: { latitude: result.latitude, longitude: result.longitude },
                  };
                }
              } catch (err) {}
              return null;
            })
          );
          const valid = suggestions.filter((s) => s !== null);
          setLocationSuggestions(valid);
          setShowSuggestions(valid.length > 0);
        } else {
          setLocationSuggestions([]);
          setShowSuggestions(false);
        }
      } catch (error) {
        setLocationSuggestions([]);
        setShowSuggestions(false);
      }
    } else {
      setLocationSuggestions([]);
      setShowSuggestions(false);
    }
    if (errors?.location) setErrors((prev) => ({ ...prev, location: "" }));
  };

  const selectLocationSuggestion = (suggestion) => {
    setLocation(suggestion.address);
    setSelectedCoordinates(suggestion.coords);
    setShowSuggestions(false);
    setLocationSuggestions([]);
    Keyboard.dismiss();
    if (errors?.location) setErrors((prev) => ({ ...prev, location: "" }));
  };

  const openMapPicker = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Needed", "Location access helps position the map.");
    }

    let initialCoords = selectedCoordinates || { latitude: 24.8607, longitude: 67.0099 };
    
    if (!selectedCoordinates) {
      try {
        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          maximumAge: 10000,
          timeout: 10000,
        });
        initialCoords = {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
        };
      } catch (error) {
        try {
          const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 300000 });
          if (lastKnown) {
            initialCoords = {
              latitude: lastKnown.coords.latitude,
              longitude: lastKnown.coords.longitude,
            };
          }
        } catch (fallbackError) {}
      }
    }

    setMapRegion({ ...initialCoords, latitudeDelta: 0.0922, longitudeDelta: 0.0421 });
    if (!selectedCoordinates) {
      setSelectedCoordinates(initialCoords);
    }

    try {
      const addresses = await Location.reverseGeocodeAsync(initialCoords);
      if (addresses && addresses.length > 0 && !location) {
        const addr = addresses[0];
        const fullAddress = [addr.name, addr.street, addr.district, addr.city].filter(Boolean).join(", ");
        if (fullAddress) setLocation(fullAddress);
      }
    } catch (geocodeError) {}

    setShowMapModal(true);
  };

  const handleMapPress = async (event) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setSelectedCoordinates({ latitude, longitude });

    try {
      const address = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (address[0]) {
        const addr = address[0];
        const parts = [addr.name, addr.street, addr.city, addr.region, addr.country].filter(Boolean);
        setLocation(parts.join(", "));
      }
    } catch (error) {
      setLocation(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
    }
  };

  const confirmMapLocation = () => {
    if (selectedCoordinates && location) {
      setShowMapModal(false);
      if (errors?.location) setErrors((prev) => ({ ...prev, location: "" }));
    } else {
      Alert.alert("Select Location", "Tap on the map to choose a location.");
    }
  };

  const handleNext = () => {
    if (!location.trim()) {
      setErrors(prev => ({ ...prev, location: "Please select a location" }));
      return;
    }
    onNext();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Where did it happen?</Text>
          <Text style={[styles.subtitle, { color: colors.gray }]}>
            Help us pinpoint the location for accuracy
          </Text>
        </View>

        {/* Quick Actions */}
        {/* Quick action buttons removed as location is fetched real-time and map is available for adjustment */}

        {/* Search Input */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Search location</Text>
          
          <View style={{ position: "relative", zIndex: 1000 }}>
            <View
              style={[
                styles.locationInput,
                {
                  backgroundColor: isDark ? "#1a1a1a" : "#f8f9fa",
                  borderColor: errors?.location ? "#ef4444" : isDark ? "#333" : "#e5e5e5",
                },
              ]}
            >
              <Ionicons name="search" size={20} color={colors.gray} style={{ marginRight: 10 }} />
              <TextInput
                style={{ flex: 1, color: colors.text, fontSize: 15 }}
                value={location}
                onChangeText={searchLocation}
                placeholder="Search for a place or address..."
                placeholderTextColor={colors.gray}
              />
              {location.length > 0 && (
                <TouchableOpacity onPress={() => { setLocation(""); setSelectedCoordinates(null); }}>
                  <Ionicons name="close-circle" size={20} color={colors.gray} />
                </TouchableOpacity>
              )}
            </View>

            {showSuggestions && locationSuggestions.length > 0 && (
              <View style={[styles.suggestionsContainer, { backgroundColor: colors.surface }]}>
                {locationSuggestions.map((item, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[styles.suggestionItem, { borderBottomColor: colors.border }]}
                    onPress={() => selectLocationSuggestion(item)}
                  >
                    <Ionicons name="location-outline" size={18} color={colors.primary} style={{ marginRight: 10 }} />
                    <Text style={[styles.suggestionText, { color: colors.text }]} numberOfLines={2}>
                      {item.address}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          {errors?.location && (
            <Text style={styles.errorText}>{errors.location}</Text>
          )}
        </View>

        {/* Map Preview */}
        {selectedCoordinates && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Selected location</Text>
            
            <TouchableOpacity 
              style={styles.mapPreview}
              onPress={openMapPicker}
              activeOpacity={0.9}
            >
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
              <View style={styles.mapOverlay}>
                <Ionicons name="expand-outline" size={20} color="#fff" />
                <Text style={styles.mapOverlayText}>Tap to adjust</Text>
              </View>
            </TouchableOpacity>

            <View style={[styles.locationPreview, { backgroundColor: isDark ? "#1e1e1e" : "#f8f9fa" }]}>
              <Ionicons name="location" size={18} color={colors.primary} />
              <Text style={[styles.locationPreviewText, { color: colors.text }]} numberOfLines={2}>
                {location}
              </Text>
            </View>
          </View>
        )}

        {/* Tip */}
        <View style={[styles.tip, { backgroundColor: isDark ? "rgba(59, 130, 246, 0.1)" : "rgba(59, 130, 246, 0.08)" }]}>
          <Ionicons name="information-circle" size={18} color="#3b82f6" />
          <Text style={[styles.tipText, { color: colors.gray }]}>
            Accurate location helps emergency services and other users respond faster.
          </Text>
        </View>
      </ScrollView>

      {/* Bottom Navigation */}
      <View style={[styles.bottomNav, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color={colors.text} />
          <Text style={[styles.backBtnText, { color: colors.text }]}>
            {editingFromReview ? "Cancel" : "Back"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.nextBtn, { backgroundColor: colors.primary }]}
          onPress={handleNext}
        >
          <Text style={styles.nextBtnText}>
            {editingFromReview ? "Done" : "Next"}
          </Text>
          <Ionicons name={editingFromReview ? "checkmark" : "arrow-forward"} size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Map Modal */}
      <Modal visible={showMapModal} animationType="slide" onRequestClose={() => setShowMapModal(false)}>
        <View style={{ flex: 1 }}>
          <View style={[styles.mapHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowMapModal(false)} style={styles.mapClose}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.mapTitle, { color: colors.text }]}>Select Location</Text>
            <View style={{ width: 40 }} />
          </View>

          <MapView 
            style={{ flex: 1 }} 
            region={mapRegion} 
            onPress={handleMapPress} 
            showsUserLocation={true} 
            showsMyLocationButton={false}
          >
            {selectedCoordinates && <Marker coordinate={selectedCoordinates} draggable onDragEnd={handleMapPress} />}
          </MapView>

          <TouchableOpacity
            style={[styles.myLocationBtn, { backgroundColor: colors.background }]}
            onPress={async () => {
              try {
                const currentLocation = await Location.getCurrentPositionAsync({});
                const coords = { latitude: currentLocation.coords.latitude, longitude: currentLocation.coords.longitude };
                setSelectedCoordinates(coords);
                setMapRegion({ ...coords, latitudeDelta: 0.0922, longitudeDelta: 0.0421 });
                const addresses = await Location.reverseGeocodeAsync(coords);
                if (addresses && addresses.length > 0) {
                  const addr = addresses[0];
                  const fullAddress = [addr.name, addr.street, addr.district, addr.city].filter(Boolean).join(", ");
                  setLocation(fullAddress);
                }
              } catch (error) {
                Alert.alert("Error", "Could not get location");
              }
            }}
          >
            <Ionicons name="locate" size={22} color={colors.primary} />
          </TouchableOpacity>

          <View style={[styles.mapFooter, { backgroundColor: colors.background }]}>
            {location ? (
              <View style={styles.selectedLocation}>
                <Ionicons name="location" size={18} color={colors.primary} />
                <Text style={[styles.selectedLocationText, { color: colors.text }]} numberOfLines={2}>
                  {location}
                </Text>
              </View>
            ) : (
              <Text style={[styles.mapHint, { color: colors.gray }]}>Tap on the map to select a location</Text>
            )}
            <TouchableOpacity 
              style={[styles.confirmLocationBtn, { backgroundColor: colors.primary }]} 
              onPress={confirmMapLocation}
            >
              <Text style={styles.confirmLocationText}>Confirm Location</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 100,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  quickActions: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  quickActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 10,
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: "600",
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  locationInput: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
  },
  suggestionsContainer: {
    position: "absolute",
    top: 58,
    left: 0,
    right: 0,
    maxHeight: 200,
    borderRadius: 14,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    zIndex: 1000,
    overflow: "hidden",
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 0.5,
  },
  suggestionText: {
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  errorText: {
    color: "#ef4444",
    fontSize: 13,
    marginTop: 8,
    marginLeft: 4,
  },
  mapPreview: {
    height: 160,
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 12,
  },
  miniMap: {
    width: "100%",
    height: "100%",
  },
  mapOverlay: {
    position: "absolute",
    bottom: 10,
    right: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  mapOverlayText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "500",
  },
  locationPreview: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    gap: 10,
  },
  locationPreviewText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  tip: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    gap: 10,
  },
  tipText: {
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  bottomNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    paddingBottom: Platform.OS === "ios" ? 32 : 16,
    borderTopWidth: 1,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 6,
  },
  backBtnText: {
    fontSize: 16,
    fontWeight: "500",
  },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 8,
  },
  nextBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  // Map Modal styles
  mapHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
  },
  mapClose: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  mapTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  myLocationBtn: {
    position: "absolute",
    right: 16,
    bottom: 160,
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  mapFooter: {
    padding: 20,
  },
  selectedLocation: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
    gap: 8,
  },
  selectedLocationText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  mapHint: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
  confirmLocationBtn: {
    padding: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  confirmLocationText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
