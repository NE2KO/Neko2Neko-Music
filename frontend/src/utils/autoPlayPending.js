let canceled = false;

export function cancelAutoPlayPending() {
  canceled = true;
}

export function isAutoPlayPendingCanceled() {
  return canceled;
}

export function resetAutoPlayPending() {
  canceled = false;
}
