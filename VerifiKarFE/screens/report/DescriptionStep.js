import { Ionicons } from "@expo/vector-icons";
import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  LayoutAnimation,
  UIManager,
  Keyboard,
} from "react-native";
import { useTheme } from "../../styles/ThemeContext";

// Enable LayoutAnimation on Android

export default function DescriptionStep({ 
  description, 
  setDescription, 
  selectedCategory,
  setSelectedCategory,
  media,
  onNext, 
  onBack,
  errors,
  setErrors,
  editingFromReview 
}) {
  const { colors, isDark } = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  // No keyboard event listener; use TextInput onFocus/onBlur only

  // Templates to help users quickly describe incidents
  const templates = [
    { id: 1, icon: "car", label: "Accident", color: "#64748b", template: "I witnessed a traffic accident involving..." },
    { id: 2, icon: "flame", label: "Fire", color: "#f97316", template: "There is a fire at..." },
    { id: 3, icon: "water", label: "Flood", color: "#3b82f6", template: "Flooding has occurred due to..." },
    { id: 4, icon: "construct", label: "Infrastructure", color: "#8b5cf6", template: "There is damage to infrastructure..." },
    { id: 5, icon: "people", label: "Gathering", color: "#10b981", template: "A large gathering is taking place at..." },
    { id: 6, icon: "warning", label: "Emergency", color: "#ef4444", template: "Emergency situation reported..." },
    { id: 7, icon: "megaphone", label: "Protest", color: "#eab308", template: "A protest is happening at..." },
    { id: 8, icon: "ellipsis-horizontal", label: "Other", color: "#6b7280", template: "" },
  ];

  const quickPhrases = [
    "Just now",
    "Few minutes ago",
    "Ongoing situation",
    "Multiple people involved",
    "Emergency services needed",
    "Road blocked",
  ];

  const handleTemplatePress = (tmpl) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (selectedCategory === tmpl.id) {
      setSelectedCategory(null);
      setDescription("");
    } else {
      setSelectedCategory(tmpl.id);
      setDescription(tmpl.template);
    }
    if (errors?.description) {
      setErrors(prev => ({ ...prev, description: "" }));
    }
  };

  const handleDeselectCategory = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectedCategory(null);
    // Don't clear description when deselecting while focused
  };

  const handleQuickPhrasePress = (phrase) => {
    const newDescription = description ? `${description} ${phrase}.` : `${phrase}.`;
    setDescription(newDescription);
  };

  const handleFocus = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsFocused(true);
  };

  const handleBlur = () => {
    // Let keyboard listener handle the state change
  };

  const dismissKeyboard = () => {
    Keyboard.dismiss();
  };

  const handleNext = () => {
    if (!description.trim()) {
      setErrors(prev => ({ ...prev, description: "Please describe what happened" }));
      return;
    }
    onNext();
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {/* When focused, show only the text input */}
      {isFocused ? (
        <View style={styles.focusedContainer}>
          {/* Collapse/minimize button */}
          <TouchableOpacity 
            style={[styles.collapseBtn, { backgroundColor: isDark ? "#1e1e1e" : "#f0f0f0" }]}
            onPress={() => {
              Keyboard.dismiss();
              setIsFocused(false);
            }}
          >
            <Ionicons name="chevron-down" size={20} color={colors.gray} />
          </TouchableOpacity>

          {/* Selected Category Badge */}
          {selectedCategory && (
            <View style={styles.selectedBadgeRow}>
              {(() => {
                const tmpl = templates.find(t => t.id === selectedCategory);
                return (
                  <TouchableOpacity 
                    style={[styles.selectedBadge, { backgroundColor: tmpl.color + "20", borderColor: tmpl.color }]}
                    onPress={handleDeselectCategory}
                    activeOpacity={0.7}
                  >
                    <Ionicons name={tmpl.icon} size={14} color={tmpl.color} />
                    <Text style={[styles.selectedBadgeText, { color: tmpl.color }]}>{tmpl.label}</Text>
                    <Ionicons name="close-circle" size={14} color={tmpl.color} style={{ marginLeft: 2 }} />
                  </TouchableOpacity>
                );
              })()}
            </View>
          )}

          {/* Categories - show if none selected */}
          {!selectedCategory && (
            <View style={styles.focusedCategoriesSection}>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryScroll}
                keyboardShouldPersistTaps="handled"
              >
                {templates.map((tmpl) => (
                  <TouchableOpacity
                    key={tmpl.id}
                    style={[
                      styles.categoryChip,
                      {
                        backgroundColor: isDark ? "#1e1e1e" : "#f8f9fa",
                        borderColor: isDark ? "#333" : "#e5e5e5",
                      },
                    ]}
                    onPress={() => handleTemplatePress(tmpl)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name={tmpl.icon} size={16} color={colors.gray} />
                    <Text style={[styles.categoryChipLabel, { color: colors.text }]}>
                      {tmpl.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Text Input - takes remaining space */}
          <View style={styles.focusedInputSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>What happened?</Text>
            <TextInput
              style={[
                styles.textArea,
                styles.focusedTextArea,
                {
                  height: 48,
                  paddingVertical: 8,
                  backgroundColor: isDark ? "#1a1a1a" : "#f8f9fa",
                  color: colors.text,
                  borderColor: errors?.description ? "#ef4444" : colors.primary,
                  textAlignVertical: "top",
                },
              ]}
              value={description}
              onChangeText={(text) => {
                setDescription(text);
                if (errors?.description) setErrors(prev => ({ ...prev, description: "" }));
              }}
              onBlur={handleBlur}
              onSubmitEditing={() => {
                Keyboard.dismiss();
                setIsFocused(false);
              }}
              returnKeyType="done"
              placeholder="Describe what you saw in your own words..."
              placeholderTextColor={colors.gray}
              multiline={false}
              textAlignVertical="top"
            />
            {errors?.description && (
              <Text style={styles.errorText}>{errors.description}</Text>
            )}
          </View>
        </View>
      ) : (
        /* Normal scrollable view when not focused */
        <>
          <ScrollView 
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.text }]}>Describe what happened</Text>
              <Text style={[styles.subtitle, { color: colors.gray }]}>
                Help others understand the situation
              </Text>
            </View>

            {/* Media Preview (if any) */}
            {/* Media preview removed, will show in Review step only */}

            {/* Quick Categories */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick categories</Text>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryScroll}
                keyboardShouldPersistTaps="handled"
              >
                {templates.map((tmpl) => (
                  <TouchableOpacity
                    key={tmpl.id}
                    style={[
                      styles.categoryChip,
                      {
                        backgroundColor: selectedCategory === tmpl.id ? tmpl.color + "20" : isDark ? "#1e1e1e" : "#f8f9fa",
                        borderColor: selectedCategory === tmpl.id ? tmpl.color : isDark ? "#333" : "#e5e5e5",
                      },
                    ]}
                    onPress={() => handleTemplatePress(tmpl)}
                    activeOpacity={0.7}
                  >
                    <Ionicons 
                      name={tmpl.icon} 
                      size={16} 
                      color={selectedCategory === tmpl.id ? tmpl.color : colors.gray} 
                    />
                    <Text
                      style={[
                        styles.categoryChipLabel,
                        { color: selectedCategory === tmpl.id ? tmpl.color : colors.text },
                      ]}
                    >
                      {tmpl.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Description Input */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>What happened?</Text>
              
              <TextInput
                style={[
                  styles.textArea,
                  {
                    backgroundColor: isDark ? "#1a1a1a" : "#f8f9fa",
                    color: colors.text,
                    borderColor: errors?.description ? "#ef4444" : isDark ? "#333" : "#e5e5e5",
                    height: 120,
                  },
                ]}
                value={description}
                onChangeText={(text) => {
                  setDescription(text);
                  if (errors?.description) setErrors(prev => ({ ...prev, description: "" }));
                }}
                onFocus={handleFocus}
                placeholder="Describe what you saw in your own words..."
                placeholderTextColor={colors.gray}
                multiline
                textAlignVertical="top"
              />
              {errors?.description && (
                <Text style={styles.errorText}>{errors.description}</Text>
              )}
            </View>

            {/* Quick Phrases */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick phrases</Text>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickPhrasesScroll}
              >
                {quickPhrases.map((phrase, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[styles.quickPhraseChip, { backgroundColor: isDark ? "#1e1e1e" : "#f0f9ff", borderColor: colors.primary + "30" }]}
                    onPress={() => handleQuickPhrasePress(phrase)}
                  >
                    <Text style={[styles.quickPhraseText, { color: colors.primary }]}>{phrase}</Text>
                    <Ionicons name="add" size={14} color={colors.primary} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Safety Note */}
            <View style={[styles.safetyNote, { backgroundColor: isDark ? "rgba(16, 185, 129, 0.1)" : "rgba(16, 185, 129, 0.08)" }]}>
              <Ionicons name="shield-checkmark" size={18} color="#10b981" />
              <Text style={[styles.safetyNoteText, { color: colors.gray }]}>
                Your report is anonymous. Your identity stays private.
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
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Focused state styles
  focusedContainer: {
    flex: 1,
    padding: 16,
  },
  collapseBtn: {
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingVertical: 6,
    borderRadius: 16,
    marginBottom: 12,
  },
  focusedCategoriesSection: {
    marginBottom: 12,
  },
  focusedInputSection: {
    flex: 1,
  },
  focusedTextArea: {
    flex: 1,
    minHeight: 150,
  },
  // Normal state styles
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
  mediaPreviewSection: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    gap: 12,
  },
  miniThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: "hidden",
    marginRight: 6,
  },
  miniThumbnailImage: {
    width: "100%",
    height: "100%",
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  mediaCountText: {
    fontSize: 13,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 10,
  },
  sectionSubtitle: {
    fontSize: 13,
    marginBottom: 12,
  },
  categoryScroll: {
    paddingRight: 20,
    gap: 8,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
    gap: 6,
    marginRight: 8,
  },
  categoryChipLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  selectedBadgeRow: {
    marginBottom: 12,
  },
  selectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
  },
  selectedBadgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  textArea: {
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    lineHeight: 22,
    borderWidth: 1.5,
  },
  errorText: {
    color: "#ef4444",
    fontSize: 13,
    marginTop: 8,
    marginLeft: 4,
  },
  quickPhrasesScroll: {
    paddingRight: 20,
  },
  quickPhraseChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    gap: 4,
    marginRight: 8,
  },
  quickPhraseText: {
    fontSize: 12,
    fontWeight: "500",
  },
  safetyNote: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    gap: 10,
  },
  safetyNoteText: {
    fontSize: 13,
    flex: 1,
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
});
