let currentRoute = '';

export function getCurrentRoute() {
  return currentRoute;
}

export function startRouteTracking() {
  const update = () => {
    const hash = window.location.hash.replace(/^#/, '') || '/';
    currentRoute = hash;
  };
  update();
  window.addEventListener('hashchange', update);
  return () => window.removeEventListener('hashchange', update);
}
