import { useState, useEffect, useCallback } from 'react';

export function useServiceControl() {
  const [services, setServices] = useState({});
  const [loading, setLoading] = useState(false);

  const fetchServices = useCallback(async () => {
    try {
      const res = await fetch('/api/services');
      if (res.ok) setServices(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchServices();
    const interval = setInterval(fetchServices, 10000);
    return () => clearInterval(interval);
  }, [fetchServices]);

  const doAction = async (name, action) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/services/${name}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        await fetchServices();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  const startService = (name) => doAction(name, 'start');
  const stopService = (name) => doAction(name, 'stop');
  const restartService = (name) => doAction(name, 'restart');

  const restartAll = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/services/restart-all', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        await fetchServices();
        return { success: true, results: data.results };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  return {
    services,
    loading,
    fetchServices,
    startService,
    stopService,
    restartService,
    restartAll,
  };
}
