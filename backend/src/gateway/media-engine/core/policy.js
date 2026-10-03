export function enforcePolicy(policy, file) {
  if (!policy) {
    return { allowed: true };
  }

  if (!file) {
    return { allowed: false, reason: 'File not found' };
  }

  if (!file.exists) {
    return { allowed: false, reason: 'File missing' };
  }

  if (policy.allowedRoots.length > 0) {
    const matched = policy.allowedRoots.some(root => {
      const normalized = root.replace(/\/+$/, '');
      return file.fullPath === normalized || file.fullPath.startsWith(normalized + '/');
    });
    if (!matched) {
      return { allowed: false, reason: 'Path not allowed by policy' };
    }
  }

  if (policy.types.length > 0) {
    const mimeType = guessMimeType(file.ext);
    if (!policy.types.includes(mimeType)) {
      return { allowed: false, reason: 'File type not allowed' };
    }
  }

  return { allowed: true };
}

function guessMimeType(ext) {
  const map = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
  };
  return map[ext?.toLowerCase()] || 'application/octet-stream';
}
