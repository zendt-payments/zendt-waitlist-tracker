const storage = {
  async get(key) {
    const res = await fetch(`/api/kv?key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error("Could not load from cloud storage");
    const data = await res.json();
    return { value: data.value ?? null };
  },
  async set(key, value) {
    const res = await fetch("/api/kv", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    return res.ok;
  },
};

export default storage;
