// Minimal stand-in for a Cloudflare KV binding (get/put/delete/list with metadata).
export function memoryKv(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, { value: JSON.stringify(v), metadata: null }]));
  return {
    store,
    async get(key, type) {
      const hit = store.get(key);
      if (!hit) return null;
      return type === "json" || (type && type.type === "json") ? JSON.parse(hit.value) : hit.value;
    },
    async put(key, value, opts) {
      store.set(key, { value: String(value), metadata: (opts && opts.metadata) || null });
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = "" } = {}) {
      const keys = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([name, v]) => ({ name, metadata: v.metadata }));
      return { keys, list_complete: true };
    },
  };
}
