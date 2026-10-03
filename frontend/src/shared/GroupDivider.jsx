import React from 'react';
import FolderIcon from './icons/FolderIcon';

const FileIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <polyline points="13 2 13 9 20 9" />
  </svg>
);

export const GroupDivider = ({ label, folderPath }) => {
  const isFiles = label === 'Files';
  const Icon = isFiles ? FileIcon : FolderIcon;

  return (
    <div className="flex items-center gap-2 px-3 py-2 select-none">
      {folderPath ? (
        <>
          <FolderIcon className="w-4 h-4 text-neutral-500 flex-shrink-0" />
          <span className="truncate max-w-[200px] text-xs font-semibold text-neutral-400 uppercase tracking-wider">{folderPath}</span>
        </>
      ) : null}
      {folderPath && label ? (
        <span className="text-neutral-600 mx-0.5">|</span>
      ) : null}
      {label ? (
        <>
          {!folderPath && <Icon className="w-4 h-4 text-neutral-500 flex-shrink-0" />}
          <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">{label}</span>
          <div className="flex-1 h-px bg-neutral-800 ml-2" />
        </>
      ) : null}
    </div>
  );
};

export default GroupDivider;
