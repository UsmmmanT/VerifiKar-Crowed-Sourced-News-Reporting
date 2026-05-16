import React, { createContext, useContext, useState } from 'react';

const FilterContext = createContext();

export const useFilters = () => {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error('useFilters must be used within FilterProvider');
  }
  return context;
};

export const FilterProvider = ({ children }) => {
  const [radiusKm, setRadiusKm] = useState(10);
  const [selectedCategories, setSelectedCategories] = useState(['all']);
  const [minCredibility, setMinCredibility] = useState(0);
  const [maxDaysOld, setMaxDaysOld] = useState(30);

  const toggleCategory = (categoryId) => {
    if (categoryId === 'all') {
      setSelectedCategories(['all']);
    } else {
      const filtered = selectedCategories.filter(id => id !== 'all');
      if (filtered.includes(categoryId)) {
        const newSelection = filtered.filter(id => id !== categoryId);
        setSelectedCategories(newSelection.length === 0 ? ['all'] : newSelection);
      } else {
        setSelectedCategories([...filtered, categoryId]);
      }
    }
  };

  const resetFilters = () => {
    setRadiusKm(10);
    setSelectedCategories(['all']);
    setMinCredibility(0);
    setMaxDaysOld(30);
  };

  const getActiveCategory = () => {
    if (selectedCategories.includes('all') || selectedCategories.length === 0) {
      return null;
    }
    // For backend API, send first selected category
    return selectedCategories[0];
  };

  return (
    <FilterContext.Provider
      value={{
        radiusKm,
        setRadiusKm,
        selectedCategories,
        setSelectedCategories,
        toggleCategory,
        minCredibility,
        setMinCredibility,
        maxDaysOld,
        setMaxDaysOld,
        resetFilters,
        getActiveCategory,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
};
