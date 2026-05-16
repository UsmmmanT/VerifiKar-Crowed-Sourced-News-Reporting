import { StyleSheet } from 'react-native';

// Light mode - Professional news app palette
export const lightColors = {
  primary: '#2563EB',
  secondary: '#3B82F6',
  background: '#F8F9FA',
  surface: '#FFFFFF',
  text: '#1F2937',
  lightGray: '#E5E7EB',
  gray: '#6B7280',
};

// Professional news app dark palette
export const darkColors = {
  // Professional blue accent (like news apps - BBC, CNN style)
  primary: '#4A90E2',
  secondary: '#5B9BD5',
  background: '#1a1a1a',
  surface: '#242424',
  text: '#E6E6E6',
  lightGray: '#2a2a2a',
  gray: '#999999',
};

export const typography = {
  header: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  medium: {
    fontSize: 16,
    fontWeight: '500',
  },
  body: {
    fontSize: 16,
    fontWeight: 'normal',
  },
};

export const layout = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});