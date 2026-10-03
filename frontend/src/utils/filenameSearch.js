export function parseFilenameToSearchTerms(filename) {
  if (!filename) return { track: '', artist: '', album: '' };
  let name = filename.replace(/\.[^/.]+$/, '');
  name = name.replace(/^\[[\w-]+\]\s*/, '');
  const dashMatch = name.match(/^(.+?)\s*[-–—]\s*(.+)/);
  if (dashMatch) {
    const first = dashMatch[1].trim();
    const second = dashMatch[2].trim();
    const secondDash = second.match(/^(.+?)\s*[-–—]\s*(.+)/);
    if (secondDash) {
      return { artist: first, album: secondDash[1].trim(), track: secondDash[2].trim() };
    }
    return { artist: first, album: '', track: second };
  }
  return { artist: '', album: '', track: name.trim() };
}
