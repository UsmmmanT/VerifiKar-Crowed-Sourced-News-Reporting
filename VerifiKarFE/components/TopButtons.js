import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  TextInput,
} from "react-native";
import { useTheme } from "../styles/ThemeContext";

export default function TopButtons() {
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter states
  const [radiusKm, setRadiusKm] = useState(10);
  const [selectedCategories, setSelectedCategories] = useState(["all"]);
  const [minCredibility, setMinCredibility] = useState(0.5);
  const [maxDaysOld, setMaxDaysOld] = useState(7);

  const categories = [
    { id: "all", name: "All", icon: "apps" },
    { id: "Accident", name: "Accident", icon: "car" },
    { id: "Crime", name: "Crime", icon: "alert-circle" },
    { id: "Infrastructure", name: "Infrastructure", icon: "construct" },
    { id: "Social", name: "Social", icon: "people" },
    { id: "Emergency", name: "Emergency", icon: "warning" },
  ];

  const radiusOptions = [5, 10, 15, 25, 50];
  const credibilityOptions = [0.3, 0.5, 0.7, 0.8, 0.9];
  const daysOptions = [1, 3, 7, 14, 30];

  const toggleCategory = (categoryId) => {
    if (categoryId === "all") {
      setSelectedCategories(["all"]);
    } else {
      const filtered = selectedCategories.filter((id) => id !== "all");
      if (filtered.includes(categoryId)) {
        const newSelection = filtered.filter((id) => id !== categoryId);
        setSelectedCategories(newSelection.length === 0 ? ["all"] : newSelection);
      } else {
        setSelectedCategories([...filtered, categoryId]);
      }
    }
  };

  const getActiveFiltersCount = () => {
    let count = 0;
    if (radiusKm !== 10) count++;
    if (!selectedCategories.includes("all")) count++;
    if (minCredibility !== 0.5) count++;
    if (maxDaysOld !== 7) count++;
    return count;
  };

  const activeFilters = getActiveFiltersCount();

  return (
    <>
      {/* Modern Header */}
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        {/* Logo */}
        <View style={styles.logoSection}>
          <Text style={{ fontSize: 24, marginRight: 6 }}>🛡️</Text>
          <Text style={[styles.logoVerifi, { color: colors.text }]}>Verifi</Text>
          <Text style={[styles.logoKar, { color: colors.primary }]}>Kar</Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: isDark ? "#1e1e1e" : "#f5f5f5" }]}
            onPress={() => setShowSearchModal(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="search" size={20} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: isDark ? "#1e1e1e" : "#f5f5f5" }]}
            onPress={() => setShowFilterModal(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="options" size={20} color={colors.text} />
            {activeFilters > 0 && (
              <View style={[styles.filterBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.filterBadgeText}>{activeFilters}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: isDark ? "#1e1e1e" : "#f5f5f5" }]}
            onPress={() => navigation.openDrawer()}
            activeOpacity={0.7}
          >
            <Ionicons name="menu" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Modal - Modern Fullscreen */}
      <Modal
        visible={showSearchModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowSearchModal(false)}
      >
        <View style={[styles.searchModalContainer, { backgroundColor: colors.background }]}>
          {/* Search Header */}
          <View style={styles.searchHeader}>
            <TouchableOpacity
              style={[styles.backButton, { backgroundColor: isDark ? "#1e1e1e" : "#f5f5f5" }]}
              onPress={() => setShowSearchModal(false)}
            >
              <Ionicons name="arrow-back" size={22} color={colors.text} />
            </TouchableOpacity>

            <View style={[styles.searchInputContainer, { backgroundColor: isDark ? "#1e1e1e" : "#f5f5f5" }]}>
              <Ionicons name="search" size={18} color={colors.gray} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search reports..."
                placeholderTextColor={colors.gray}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery("")}>
                  <Ionicons name="close-circle" size={18} color={colors.gray} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Search Content */}
          <View style={styles.searchContent}>
            {searchQuery.length === 0 ? (
              <View style={styles.searchPlaceholder}>
                <View style={[styles.searchIconBig, { backgroundColor: isDark ? "#1e1e1e" : "#f5f5f5" }]}>
                  <Ionicons name="search" size={40} color={colors.gray} />
                </View>
                <Text style={[styles.searchPlaceholderTitle, { color: colors.text }]}>
                  Search Reports
                </Text>
                <Text style={[styles.searchPlaceholderText, { color: colors.gray }]}>
                  Find reports by location, description, or category
                </Text>

                {/* Recent Searches */}
                <View style={styles.recentSection}>
                  <Text style={[styles.recentTitle, { color: colors.gray }]}>SUGGESTIONS</Text>
                  {["Accident near me", "Road closure", "Fire incident", "Traffic update"].map((item, index) => (
                    <TouchableOpacity
                      key={index}
                      style={styles.recentItem}
                      onPress={() => setSearchQuery(item)}
                    >
                      <Ionicons name="trending-up" size={18} color={colors.gray} />
                      <Text style={[styles.recentText, { color: colors.text }]}>{item}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.searchResults}>
                <Text style={[styles.searchResultsInfo, { color: colors.gray }]}>
                  Search functionality coming soon...
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Filter Modal - Modern Bottom Sheet */}
      <Modal
        visible={showFilterModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowFilterModal(false)}
      >
        <View style={styles.filterModalOverlay}>
          <TouchableOpacity
            style={styles.filterModalBackdrop}
            activeOpacity={1}
            onPress={() => setShowFilterModal(false)}
          />
          <View style={[styles.filterModalContent, { backgroundColor: colors.background }]}>
            {/* Handle Bar */}
            <View style={styles.handleBar}>
              <View style={[styles.handle, { backgroundColor: isDark ? "#333" : "#ddd" }]} />
            </View>

            {/* Header */}
            <View style={styles.filterHeader}>
              <Text style={[styles.filterTitle, { color: colors.text }]}>Filters</Text>
              <TouchableOpacity
                onPress={() => {
                  setRadiusKm(10);
                  setSelectedCategories(["all"]);
                  setMinCredibility(0.5);
                  setMaxDaysOld(7);
                }}
              >
                <Text style={[styles.resetText, { color: colors.primary }]}>Reset</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.filterBody} showsVerticalScrollIndicator={false}>
              {/* Distance */}
              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeader}>
                  <Ionicons name="location" size={20} color={colors.primary} />
                  <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Distance</Text>
                  <Text style={[styles.filterValue, { color: colors.primary }]}>{radiusKm} km</Text>
                </View>
                <View style={styles.chipGrid}>
                  {radiusOptions.map((radius) => (
                    <TouchableOpacity
                      key={radius}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: radiusKm === radius ? colors.primary : isDark ? "#1e1e1e" : "#f5f5f5",
                          borderColor: radiusKm === radius ? colors.primary : "transparent",
                        },
                      ]}
                      onPress={() => setRadiusKm(radius)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: radiusKm === radius ? "#fff" : colors.text },
                        ]}
                      >
                        {radius} km
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Categories */}
              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeader}>
                  <Ionicons name="grid" size={20} color={colors.primary} />
                  <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Categories</Text>
                </View>
                <View style={styles.categoryChipGrid}>
                  {categories.map((category) => {
                    const isSelected = selectedCategories.includes(category.id);
                    return (
                      <TouchableOpacity
                        key={category.id}
                        style={[
                          styles.categoryChip,
                          {
                            backgroundColor: isSelected ? colors.primary : isDark ? "#1e1e1e" : "#f5f5f5",
                          },
                        ]}
                        onPress={() => toggleCategory(category.id)}
                      >
                        <Ionicons
                          name={category.icon}
                          size={16}
                          color={isSelected ? "#fff" : colors.text}
                        />
                        <Text
                          style={[
                            styles.categoryChipText,
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

              {/* Credibility */}
              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeader}>
                  <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
                  <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Min Credibility</Text>
                  <Text style={[styles.filterValue, { color: colors.primary }]}>
                    {Math.round(minCredibility * 100)}%
                  </Text>
                </View>
                <View style={styles.chipGrid}>
                  {credibilityOptions.map((cred) => (
                    <TouchableOpacity
                      key={cred}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: minCredibility === cred ? colors.primary : isDark ? "#1e1e1e" : "#f5f5f5",
                        },
                      ]}
                      onPress={() => setMinCredibility(cred)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: minCredibility === cred ? "#fff" : colors.text },
                        ]}
                      >
                        {Math.round(cred * 100)}%
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Time */}
              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeader}>
                  <Ionicons name="time" size={20} color={colors.primary} />
                  <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Time Range</Text>
                  <Text style={[styles.filterValue, { color: colors.primary }]}>
                    {maxDaysOld} {maxDaysOld === 1 ? "day" : "days"}
                  </Text>
                </View>
                <View style={styles.chipGrid}>
                  {daysOptions.map((days) => (
                    <TouchableOpacity
                      key={days}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: maxDaysOld === days ? colors.primary : isDark ? "#1e1e1e" : "#f5f5f5",
                        },
                      ]}
                      onPress={() => setMaxDaysOld(days)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: maxDaysOld === days ? "#fff" : colors.text },
                        ]}
                      >
                        {days}d
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={{ height: 20 }} />
            </ScrollView>

            {/* Apply Button */}
            <View style={styles.filterFooter}>
              <TouchableOpacity
                style={[styles.applyButton, { backgroundColor: colors.primary }]}
                onPress={() => setShowFilterModal(false)}
              >
                <Text style={styles.applyButtonText}>Apply Filters</Text>
                {activeFilters > 0 && (
                  <View style={styles.applyBadge}>
                    <Text style={styles.applyBadgeText}>{activeFilters}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  logoSection: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  logoText: {
    flexDirection: "row",
    marginLeft: 10,
  },
  logoVerifi: {
    fontSize: 22,
    fontWeight: "300",
    letterSpacing: -0.5,
  },
  logoKar: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  filterBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
  },
  filterBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },

  // Search Modal
  searchModalContainer: {
    flex: 1,
  },
  searchHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 12,
    gap: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  searchContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  searchPlaceholder: {
    flex: 1,
    alignItems: "center",
    paddingTop: 60,
  },
  searchIconBig: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  searchPlaceholderTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  searchPlaceholderText: {
    fontSize: 15,
    textAlign: "center",
    marginBottom: 40,
  },
  recentSection: {
    width: "100%",
    marginTop: 20,
  },
  recentTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    marginBottom: 16,
  },
  recentItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 14,
  },
  recentText: {
    fontSize: 15,
  },
  searchResults: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  searchResultsInfo: {
    fontSize: 15,
  },

  // Filter Modal
  filterModalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  filterModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  filterModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
  },
  handleBar: {
    alignItems: "center",
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  filterHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  filterTitle: {
    fontSize: 22,
    fontWeight: "700",
  },
  resetText: {
    fontSize: 15,
    fontWeight: "600",
  },
  filterBody: {
    paddingHorizontal: 20,
  },
  filterSection: {
    marginTop: 24,
  },
  filterSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    gap: 10,
  },
  filterSectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  filterValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  chipText: {
    fontSize: 14,
    fontWeight: "600",
  },
  categoryChipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  filterFooter: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 30,
  },
  applyButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 16,
    borderRadius: 14,
    gap: 8,
  },
  applyButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  applyBadge: {
    backgroundColor: "rgba(255,255,255,0.3)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  applyBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
});
