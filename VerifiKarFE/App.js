import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Slider from "@react-native-community/slider";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import * as Device from "expo-device";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { setupCompleteNotificationFlow } from "./services/notificationService";

import { API_BASE_URL } from "./config";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { FilterProvider, useFilters } from "./context/FilterContext";
import DiscoverScreen from "./screens/DiscoverScreen";
import HomeScreen from "./screens/HomeScreen";
import LoginScreen from "./screens/LoginScreen";
import PostDetailsScreen from "./screens/PostDetailsScreen";
import ProfileScreen from "./screens/ProfileScreen";
import ReportScreen from "./screens/ReportScreen";
import SettingsScreen from "./screens/SettingsScreen";
import SignupScreen from "./screens/SignupScreen";
import RoutingScreen from "./src/screens/RoutingScreen";
import { ThemeProvider, useTheme } from "./styles/ThemeContext";

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function HeaderButtons() {
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMoreResults, setHasMoreResults] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [searchHasRun, setSearchHasRun] = useState(false);
  const lastSearchLocationRef = useRef({
    lat: 24.8607,
    lon: 67.0099,
    ts: 0,
  });
  const { colors } = useTheme();
  const {
    radiusKm,
    setRadiusKm,
    selectedCategories,
    minCredibility,
    setMinCredibility,
    maxDaysOld,
    setMaxDaysOld,
    toggleCategory,
  } = useFilters();

  const categories = [
    { id: "all", name: "All", icon: "grid-outline" },
    { id: "Accident", name: "Accident", icon: "car-outline" },
    { id: "Crime", name: "Crime", icon: "warning-outline" },
    { id: "Infrastructure", name: "Infrastructure", icon: "construct-outline" },
    { id: "Social", name: "Social", icon: "people-outline" },
    { id: "Emergency", name: "Emergency", icon: "alert-circle-outline" },
  ];

  const handleFilter = () => {
    setFilterVisible(true);
  };

  const handleSearch = () => {
    setSearchVisible(true);
  };

  // New logic: avoid passing TextInput events into runSearch.
  const handleSearchSubmit = () => runSearch(false);

  const runSearch = async (isLoadMore = false) => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchError("");
      setSearchHasRun(false);
      setSearchOffset(0);
      setHasMoreResults(true);
      return;
    }

    try {
      if (isLoadMore) {
        setIsLoadingMore(true);
        setSearchError("");
      } else {
        setIsSearching(true);
        setSearchResults([]);
        setSearchOffset(0);
        setHasMoreResults(true);
        setSearchError("");
        setSearchHasRun(false);
      }

      const token = await AsyncStorage.getItem("authToken");
      const limit = 20;
      const nextOffset = isLoadMore ? searchOffset + limit : 0;

      // New logic: fetch live user location with fallback to defaults.
      const now = Date.now();
      const cachedLocation = lastSearchLocationRef.current;
      let latitude = cachedLocation.lat ?? 24.8607;
      let longitude = cachedLocation.lon ?? 67.0099;
      let radiusKm = "50";

      try {
        if (now - cachedLocation.ts > 30000) {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === "granted") {
            const current = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
              maximumAge: 5000,
              timeout: 10000,
            });
            latitude = current.coords.latitude;
            longitude = current.coords.longitude;
            lastSearchLocationRef.current = {
              lat: latitude,
              lon: longitude,
              ts: now,
            };
          }
        }
      } catch (locationError) {
        // Fallback to default coordinates when location is unavailable.
      }

      const queryParams = new URLSearchParams();
      queryParams.append("lat", latitude.toString());
      queryParams.append("lon", longitude.toString());
      queryParams.append("radius_km", radiusKm);
      queryParams.append("max_days_old", maxDaysOld.toString());
      queryParams.append("search", query);
      queryParams.append("global_search", "true");
      queryParams.append("skip", nextOffset.toString());
      queryParams.append("limit", limit.toString());

      const response = await fetch(
        `${API_BASE_URL}/feed?${queryParams.toString()}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...(token && { Authorization: `Bearer ${token}` }),
          },
        },
      );

      const data = await response.json();
      if (
        !response.ok ||
        !data?.success ||
        !Array.isArray(data?.details?.posts)
      ) {
        throw new Error("Search failed. Please try again.");
      }

      const newResults = data.details.posts;
      setSearchResults((prev) =>
        isLoadMore ? [...prev, ...newResults] : newResults,
      );
      setSearchOffset(nextOffset);
      setHasMoreResults(newResults.length === limit);
      setSearchHasRun(true);
    } catch (e) {
      // New logic: surface search errors clearly in the modal.
      const message = e?.message || "Search failed. Please try again.";
      setSearchError(message);
      if (!isLoadMore) {
        setSearchResults([]);
        setSearchHasRun(true);
      }
    } finally {
      setIsSearching(false);
      setIsLoadingMore(false);
    }
  };

  const closeSearchModal = () => {
    setSearchVisible(false);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError("");
    setSearchHasRun(false);
    setSearchOffset(0);
    setHasMoreResults(true);
    setIsSearching(false);
    setIsLoadingMore(false);
  };

  const renderSearchItem = ({ item }) => {
    const created = new Date(item.created_at).toLocaleString();
    return (
      <View
        style={[
          styles.searchResultCard,
          { backgroundColor: colors.background, borderColor: colors.border },
        ]}
      >
        <Text
          style={[styles.searchResultTitle, { color: colors.text }]}
          numberOfLines={2}
        >
          {item.content}
        </Text>
        <View style={styles.searchMetaRow}>
          <Text style={[styles.searchMetaText, { color: colors.gray }]}>
            {item.event_category || "General"}
          </Text>
          <Text style={[styles.searchMetaText, { color: colors.gray }]}>•</Text>
          <Text style={[styles.searchMetaText, { color: colors.gray }]}>
            Credibility {Math.round((item.credibility_score || 0) * 100)}%
          </Text>
        </View>
        <Text style={[styles.searchMetaText, { color: colors.gray }]}>
          {created}
        </Text>
      </View>
    );
  };

  return (
    <>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          marginRight: 15,
        }}
      >
        <TouchableOpacity onPress={handleFilter} style={{ padding: 8 }}>
          <Ionicons name="filter-outline" size={24} color={colors.text} />
        </TouchableOpacity>

        <TouchableOpacity onPress={handleSearch} style={{ padding: 8 }}>
          <Ionicons name="search-outline" size={24} color={colors.text} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setSettingsVisible(true)}
          style={{ padding: 8 }}
        >
          <Ionicons name="settings-outline" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <Modal
        animationType="slide"
        visible={settingsVisible}
        onRequestClose={() => setSettingsVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 16,
              backgroundColor: colors.surface,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text
              style={{ fontSize: 20, fontWeight: "600", color: colors.text }}
            >
              Settings
            </Text>
            <TouchableOpacity
              onPress={() => setSettingsVisible(false)}
              style={{ padding: 8 }}
            >
              <Ionicons name="close" size={28} color={colors.text} />
            </TouchableOpacity>
          </View>
          <SettingsScreen />
        </View>
      </Modal>

      {/* Search Modal */}
      <Modal
        animationType="slide"
        visible={searchVisible}
        transparent={true}
        onRequestClose={closeSearchModal}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[styles.modalContent, { backgroundColor: colors.surface }]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Search Posts
              </Text>
              <TouchableOpacity onPress={closeSearchModal}>
                <Ionicons name="close" size={28} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <View
                style={[
                  styles.searchInputRow,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons name="search-outline" size={18} color={colors.gray} />
                <TextInput
                  style={[styles.searchInput, { color: colors.text }]}
                  placeholder="Search by keyword or category"
                  placeholderTextColor={colors.gray}
                  value={searchQuery}
                  onChangeText={(text) => {
                    // New logic: reset error state on input change.
                    setSearchQuery(text);
                    setSearchError("");
                    setSearchHasRun(false);
                  }}
                  onSubmitEditing={handleSearchSubmit}
                  returnKeyType="search"
                  editable={!isSearching}
                />
                <TouchableOpacity
                  onPress={handleSearchSubmit}
                  disabled={isSearching}
                >
                  <Text
                    style={[styles.searchActionText, { color: colors.primary }]}
                  >
                    Search
                  </Text>
                </TouchableOpacity>
              </View>

              {isSearching ? (
                <View style={styles.searchLoaderWrap}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : (
                <>
                  {searchQuery.trim().length === 0 ? (
                    <Text
                      style={[styles.comingSoonText, { color: colors.gray }]}
                    >
                      Type a keyword and tap Search.
                    </Text>
                  ) : searchError ? (
                    <Text
                      style={[styles.comingSoonText, { color: colors.gray }]}
                    >
                      {searchError}
                    </Text>
                  ) : searchHasRun && searchResults.length === 0 ? (
                    <Text
                      style={[styles.comingSoonText, { color: colors.gray }]}
                    >
                      No results found for your search.
                    </Text>
                  ) : (
                    <FlatList
                      data={searchResults}
                      keyExtractor={(item) => item.id}
                      renderItem={renderSearchItem}
                      contentContainerStyle={styles.searchResultsList}
                      showsVerticalScrollIndicator={false}
                      ListFooterComponent={
                        hasMoreResults && searchResults.length > 0 ? (
                          <View style={styles.searchFooter}>
                            <TouchableOpacity
                              onPress={() => runSearch(true)}
                              disabled={isLoadingMore}
                            >
                              {isLoadingMore ? (
                                <ActivityIndicator
                                  size="small"
                                  color={colors.primary}
                                />
                              ) : (
                                <Text
                                  style={[
                                    styles.searchActionText,
                                    { color: colors.primary },
                                  ]}
                                >
                                  Load More
                                </Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        ) : searchError ? (
                          <Text
                            style={[
                              styles.comingSoonText,
                              { color: colors.gray },
                            ]}
                          >
                            {searchError}
                          </Text>
                        ) : null
                      }
                    />
                  )}
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Filter Modal - Modern Bottom Sheet */}
      <Modal
        animationType="slide"
        visible={filterVisible}
        transparent={true}
        onRequestClose={() => setFilterVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setFilterVisible(false)}
          />
          <View
            style={[styles.modalContent, { backgroundColor: colors.surface }]}
          >
            {/* Handle Bar */}
            <View style={styles.handleBar}>
              <View
                style={[styles.handle, { backgroundColor: colors.gray + "40" }]}
              />
            </View>

            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Filters
              </Text>
              <TouchableOpacity
                onPress={() => {
                  // Reset filters
                  setMinCredibility(0);
                  setMaxDaysOld(30);
                }}
              >
                <Text style={[styles.resetText, { color: colors.primary }]}>
                  Reset
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalBody}
              showsVerticalScrollIndicator={false}
            >
              {/* Report Types Section */}
              <View style={styles.filterSection}>
                <View style={styles.sectionHeader}>
                  <Ionicons
                    name="albums-outline"
                    size={18}
                    color={colors.primary}
                  />
                  <Text style={[styles.filterLabel, { color: colors.text }]}>
                    Report Types
                  </Text>
                </View>
                <View style={styles.categoryGrid}>
                  {categories.map((category) => {
                    const isSelected = selectedCategories.includes(category.id);
                    return (
                      <TouchableOpacity
                        key={category.id}
                        style={[
                          styles.categoryChip,
                          {
                            backgroundColor: isSelected
                              ? colors.primary
                              : colors.background,
                            borderColor: isSelected
                              ? colors.primary
                              : colors.border,
                          },
                        ]}
                        onPress={() => toggleCategory(category.id)}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={category.icon}
                          size={16}
                          color={isSelected ? "#fff" : colors.text}
                        />
                        <Text
                          style={[
                            styles.categoryText,
                            { color: isSelected ? "#fff" : colors.text },
                          ]}
                        >
                          {category.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Trust Score Section */}
              <View style={styles.filterSection}>
                <View style={styles.sectionHeader}>
                  <Ionicons
                    name="shield-checkmark"
                    size={18}
                    color={colors.primary}
                  />
                  <Text style={[styles.filterLabel, { color: colors.text }]}>
                    Trust Score
                  </Text>
                  <View
                    style={[
                      styles.sliderValueBadge,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    <Text style={styles.sliderValueBadgeText}>
                      {Math.round(minCredibility * 100)}%+
                    </Text>
                  </View>
                </View>
                <View
                  style={[
                    styles.sliderContainer,
                    { backgroundColor: colors.background },
                  ]}
                >
                  <Slider
                    style={styles.slider}
                    minimumValue={0}
                    maximumValue={1}
                    step={0.05}
                    value={minCredibility}
                    onValueChange={setMinCredibility}
                    minimumTrackTintColor={colors.primary}
                    maximumTrackTintColor={colors.border}
                    thumbTintColor={colors.primary}
                  />
                  <View style={styles.sliderLabels}>
                    <Text
                      style={[styles.sliderLabelText, { color: colors.gray }]}
                    >
                      Any
                    </Text>
                    <Text
                      style={[styles.sliderLabelText, { color: colors.gray }]}
                    >
                      50%+
                    </Text>
                    <Text
                      style={[styles.sliderLabelText, { color: colors.gray }]}
                    >
                      100%
                    </Text>
                  </View>
                </View>
              </View>

              {/* Posted Within Section */}
              <View style={styles.filterSection}>
                <View style={styles.sectionHeader}>
                  <Ionicons
                    name="calendar-outline"
                    size={18}
                    color={colors.primary}
                  />
                  <Text style={[styles.filterLabel, { color: colors.text }]}>
                    Posted Within
                  </Text>
                  <View
                    style={[
                      styles.sliderValueBadge,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    <Text style={styles.sliderValueBadgeText}>
                      {maxDaysOld === 1 ? "Today" : `${maxDaysOld} days`}
                    </Text>
                  </View>
                </View>
                <View
                  style={[
                    styles.sliderContainer,
                    { backgroundColor: colors.background },
                  ]}
                >
                  <Slider
                    style={styles.slider}
                    minimumValue={1}
                    maximumValue={30}
                    step={1}
                    value={maxDaysOld}
                    onValueChange={setMaxDaysOld}
                    minimumTrackTintColor={colors.primary}
                    maximumTrackTintColor={colors.border}
                    thumbTintColor={colors.primary}
                  />
                  <View style={styles.sliderLabels}>
                    <Text
                      style={[styles.sliderLabelText, { color: colors.gray }]}
                    >
                      Today
                    </Text>
                    <Text
                      style={[styles.sliderLabelText, { color: colors.gray }]}
                    >
                      2 weeks
                    </Text>
                    <Text
                      style={[styles.sliderLabelText, { color: colors.gray }]}
                    >
                      1 month
                    </Text>
                  </View>
                </View>
              </View>

              {/* Apply Button */}
              <TouchableOpacity
                style={[
                  styles.applyButton,
                  { backgroundColor: colors.primary },
                ]}
                onPress={() => setFilterVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.applyButtonText}>Apply Filters</Text>
                <Ionicons name="checkmark" size={20} color="#fff" />
              </TouchableOpacity>

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function AuthNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Login"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
    </Stack.Navigator>
  );
}

function MainNavigator() {
  const { colors } = useTheme();

  const HeaderTitle = () => (
    <View
      style={{ flexDirection: "row", alignItems: "center" }}
    >
      <Ionicons
        name="shield-checkmark"
        size={24}
        color={colors.primary}
        style={{ marginRight: 8 }}
      />
      <Text style={{ fontSize: 20, fontWeight: "600", color: colors.text }}>
        Verifi
      </Text>
      <Text style={{ fontSize: 20, fontWeight: "800", color: colors.primary }}>
        Kar
      </Text>
    </View>
  );

  return (
    <>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: true,
          headerStyle: {
            backgroundColor: colors.surface,
            elevation: 0,
            shadowOpacity: 0,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
          headerTintColor: colors.text,
          headerTitleStyle: {
            fontWeight: "600",
            fontSize: 20,
          },
          headerTitle: () => <HeaderTitle />,
          headerRight: () => <HeaderButtons />,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.gray,
          tabBarStyle: { backgroundColor: colors.surface },
          tabBarIcon: ({ color, size }) => {
            let iconName;
            if (route.name === "Home") iconName = "home-outline";
            else if (route.name === "Report") iconName = "document-text-outline";
            else if (route.name === "Discover") iconName = "compass-outline";
            else if (route.name === "Navigate") iconName = "navigate-outline";
            else if (route.name === "Profile") iconName = "person-circle-outline";
            return <Ionicons name={iconName} size={size} color={color} />;
          },
        })}
      >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: "Home" }}
      />
      <Tab.Screen
        name="Report"
        component={ReportScreen}
        options={{ title: "Report" }}
      />
      <Tab.Screen
        name="Discover"
        component={DiscoverScreen}
        options={{ title: "Discover" }}
      />
      <Tab.Screen
        name="Navigate"
        component={RoutingScreen}
        options={{
          title: "Navigate",
          headerShown: false,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: "Profile" }}
      />
      </Tab.Navigator>
    </>
  );
}

function AuthenticatedNavigator() {
  const { colors } = useTheme();

  return (
    <Stack.Navigator>
      <Stack.Screen
        name="MainTabs"
        component={MainNavigator}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PostDetails"
        component={PostDetailsScreen}
        options={{
          title: "Post Details",
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "700" },
        }}
      />
      <Stack.Screen
        name="PostDetail"
        component={PostDetailsScreen}
        options={{
          title: "Post Details",
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "700" },
        }}
      />
    </Stack.Navigator>
  );
}

function InnerApp() {
  const { colors, navigationTheme } = useTheme();
  const { user, isLoading } = useAuth();
  const [notificationCleanup, setNotificationCleanup] = useState(null);

  // Step 51: Register notifications on login
  useEffect(() => {
    if (user && !isLoading) {
      const initializeNotifications = async () => {
        try {
          // DEBUG: Check device and permissions
          const isPhysical = Device.isDevice;
          console.log("[DEBUG] Physical device?", isPhysical);

          const permissions = await Notifications.getPermissionsAsync();
          console.log("[DEBUG] Current permissions:", permissions);

          // Show permission status on screen
          Alert.alert(
            "📋 Permission Status",
            JSON.stringify(permissions, null, 2),
          );

          const authToken = await AsyncStorage.getItem("authToken");
          if (!authToken) {
            console.warn("[Notifications] No auth token found");
            return;
          }

          console.log("[Notifications] Initializing for user:", user.id);

          const result = await setupCompleteNotificationFlow(
            authToken,
            // Callback for received notifications
            (notification) => {
              console.log(
                "[Notifications] 🔔 RECEIVED:",
                JSON.stringify(notification, null, 2),
              );
              Alert.alert(
                "🔔 Notification Received",
                JSON.stringify(notification, null, 2),
              );
            },
            // Callback for user interactions
            (response) => {
              console.log(
                "[Notifications] 📱 USER TAPPED:",
                JSON.stringify(response, null, 2),
              );
              Alert.alert("📱 User Tapped", JSON.stringify(response, null, 2));
            },
          );

          if (result.success) {
            console.log("[Notifications] ✅ Setup complete!");
            console.log("[Notifications] Token:", result.token);

            // Show token on screen for easy copying
            Alert.alert(
              "✅ Notifications Enabled",
              `Token: ${result.token}\n\nYou can now receive notifications!`,
              [{ text: "OK" }],
            );

            // Store cleanup function for logout
            setNotificationCleanup(() => result.cleanup);
          } else {
            console.warn("[Notifications] ❌ Setup failed:", result.error);
            Alert.alert("❌ Notification Setup Failed", result.error);
          }
        } catch (error) {
          console.error("[Notifications] 🔴 Initialization error:", error);
          Alert.alert("❌ Notification Error", String(error));
        }
      };

      initializeNotifications();
    } else if (!user && notificationCleanup) {
      // Clean up notifications on logout
      notificationCleanup?.();
      setNotificationCleanup(null);
    }

    return () => {
      // Cleanup on unmount
      if (notificationCleanup) {
        notificationCleanup?.();
      }
    };
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      {user ? <AuthenticatedNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <FilterProvider>
        <AuthProvider>
          <InnerApp />
        </AuthProvider>
      </FilterProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
  },
  handleBar: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "700",
  },
  resetText: {
    fontSize: 15,
    fontWeight: "600",
  },
  modalBody: {
    paddingHorizontal: 20,
  },
  comingSoonText: {
    fontSize: 16,
    textAlign: "center",
    paddingVertical: 40,
  },
  filterSection: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  filterLabel: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  sliderContainer: {
    borderRadius: 14,
    padding: 16,
  },
  sliderValueBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  sliderValueBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  sliderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  sliderValue: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  sliderValueText: {
    fontSize: 14,
    fontWeight: "700",
  },
  slider: {
    width: "100%",
    height: 40,
  },
  sliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginTop: 4,
  },
  sliderLabelText: {
    fontSize: 11,
  },
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  optionChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  optionText: {
    fontSize: 14,
    fontWeight: "600",
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  categoryText: {
    fontSize: 13,
    fontWeight: "600",
  },
  applyButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 10,
  },
  applyButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  feedModeOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  feedModeBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  feedModeCard: {
    width: "84%",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },
  feedModeTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  feedModeSubtitle: {
    fontSize: 12,
    marginTop: 4,
    marginBottom: 16,
  },
  feedModeOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  feedModeOptionActive: {
    borderWidth: 1,
  },
  feedModeOptionText: {
    fontSize: 14,
    fontWeight: "600",
  },
  feedModeClose: {
    marginTop: 6,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  feedModeCloseText: {
    fontSize: 14,
    fontWeight: "600",
  },
  searchInputRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 2,
  },
  searchActionText: {
    fontSize: 14,
    fontWeight: "700",
  },
  searchLoaderWrap: {
    paddingVertical: 22,
    alignItems: "center",
  },
  searchResultsList: {
    paddingTop: 12,
    paddingBottom: 12,
  },
  searchFooter: {
    paddingVertical: 16,
    alignItems: "center",
  },
  searchResultCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  searchResultTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 6,
  },
  searchMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  searchMetaText: {
    fontSize: 12,
  },
});
