import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from './supabase';

/**
 * Admin-editable site copy. The public `public_content_overrides` view exposes
 * only `key` and `value`; saving is gated to system administrators by the
 * security-definer `set_content_override` RPC. We load every override once into
 * this provider and look up by key, so wrapping many strings costs one request.
 */
interface ContentOverridesState {
  /** Map of override key → saved value. Empty until the initial load resolves. */
  overrides: Record<string, string>;
  loading: boolean;
  /** Look up the saved value for a key, falling back to the supplied default. */
  getOverride: (key: string, fallback: string) => string;
  /**
   * Persist a new value via the gated RPC and update the local cache on success.
   * Returns an error message on failure (so the caller can revert + surface it).
   */
  saveOverride: (key: string, value: string) => Promise<{ error: string | null }>;
}

const ContentOverridesContext = createContext<ContentOverridesState | undefined>(undefined);

export function ContentOverridesProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      // Overrides are optional polish — every EditableText carries a hard-coded
      // fallback — so a failure must not block the page. It must still clear
      // `loading`, and it must not reject: the previous .then() had no catch, so
      // a failed or aborted request left loading stuck true forever and raised
      // an unhandled rejection.
      try {
        const { data, error } = await supabase
          .from('public_content_overrides')
          .select('key, value');
        if (!active) return;
        if (error) {
          console.error('content overrides load failed:', error.message);
          return;
        }
        const map: Record<string, string> = {};
        for (const row of (data ?? []) as { key: string; value: string }[]) {
          if (row.key != null && row.value != null) map[row.key] = row.value;
        }
        setOverrides(map);
      } catch (e) {
        if (active) console.error('content overrides load threw:', e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const getOverride = useCallback(
    (key: string, fallback: string) =>
      Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : fallback,
    [overrides],
  );

  const saveOverride = useCallback(async (key: string, value: string) => {
    const { error } = await supabase.rpc('set_content_override', {
      _key: key,
      _value: value,
    });
    if (error) return { error: error.message };
    // Optimistically reflect the saved value so every wrapper using this key updates.
    setOverrides((cur) => ({ ...cur, [key]: value }));
    return { error: null };
  }, []);

  const value = useMemo<ContentOverridesState>(
    () => ({ overrides, loading, getOverride, saveOverride }),
    [overrides, loading, getOverride, saveOverride],
  );

  return (
    <ContentOverridesContext.Provider value={value}>
      {children}
    </ContentOverridesContext.Provider>
  );
}

export function useContentOverrides() {
  const ctx = useContext(ContentOverridesContext);
  if (!ctx) throw new Error('useContentOverrides must be used within ContentOverridesProvider');
  return ctx;
}
