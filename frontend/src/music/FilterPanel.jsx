import React, { useEffect, useState } from 'react';

export default function FilterPanel({
  open,
  onClose,
  title = 'Filters',
  filterTypeOptions = null,
  filterType = 'all',
  onFilterTypeChange = null,
  sortOptions = [],
  sortBy,
  sortOrder,
  onApply,
}) {
  const [panelFilterType, setPanelFilterType] = useState(filterType);
  const [panelSortBy, setPanelSortBy] = useState(sortBy);
  const [panelSortOrder, setPanelSortOrder] = useState(sortOrder);

  useEffect(() => {
    if (open) {
      setPanelFilterType(filterType);
      setPanelSortBy(sortBy);
      setPanelSortOrder(sortOrder);
    }
  }, [open, filterType, sortBy, sortOrder]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const hasFilterSection = filterTypeOptions && filterTypeOptions.length > 0;
  const hasSortSection = sortOptions.length > 0;

  return (
    <div className="panel-backdrop show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="filter-panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <span>{title}</span>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="panel-content" style={!hasFilterSection || !hasSortSection ? { gridTemplateColumns: '1fr' } : undefined}>
          {hasFilterSection && (
            <div className="filter-section">
              <div className="section-header">FILTER TYPE</div>
              <div className="options-list">
                {filterTypeOptions.map(opt => (
                  <div
                    key={opt.key}
                    className={`option-item ${panelFilterType === opt.key ? 'selected' : ''}`}
                    onClick={() => setPanelFilterType(opt.key)}
                  >
                    <div className="radio-custom"></div>
                    <span className="option-label">{opt.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {hasFilterSection && hasSortSection && <div className="vertical-divider"></div>}
          {hasSortSection && (
            <div className="sort-section">
              <div className="section-header">SORT BY</div>
              <div className="options-list">
                {sortOptions.map(opt => {
                  if (opt.key === null) {
                    return (
                      <div
                        key="none"
                        className={`option-item ${panelSortBy === null ? 'selected' : ''}`}
                        onClick={() => {
                          setPanelSortBy(null);
                          setPanelSortOrder('asc');
                        }}
                      >
                        <div className="radio-custom"></div>
                        <span className="option-label">{opt.label}</span>
                      </div>
                    );
                  }
                  return (
                    <React.Fragment key={String(opt.key)}>
                      <div
                        className={`option-item ${panelSortBy === opt.key && panelSortOrder === 'asc' ? 'selected' : ''}`}
                        onClick={() => {
                          setPanelSortBy(opt.key);
                          setPanelSortOrder('asc');
                        }}
                      >
                        <div className="radio-custom"></div>
                        <span className="option-label">{opt.label}</span>
                        <svg className="option-arrow" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l-8 10h16z" /></svg>
                      </div>
                      <div
                        className={`option-item ${panelSortBy === opt.key && panelSortOrder === 'desc' ? 'selected' : ''}`}
                        onClick={() => {
                          setPanelSortBy(opt.key);
                          setPanelSortOrder('desc');
                        }}
                      >
                        <div className="radio-custom"></div>
                        <span className="option-label">{opt.label}</span>
                        <svg className="option-arrow" viewBox="0 0 24 24" fill="currentColor"><path d="M12 20l8-10H4z" /></svg>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="panel-footer">
          <button className="reset-btn" onClick={() => {
            setPanelFilterType('all');
            setPanelSortBy(null);
            setPanelSortOrder('asc');
          }}>Reset</button>
          <button className="apply-btn" onClick={() => {
            if (onFilterTypeChange) onFilterTypeChange(panelFilterType);
            onApply(panelSortBy, panelSortOrder);
            onClose();
          }}>Apply</button>
        </div>
      </div>
    </div>
  );
}
