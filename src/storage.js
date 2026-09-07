const storage = {
  async get(key) {
    try {
      return { value: localStorage.getItem(key) };
    } catch {
      return { value: null };
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
};

export default storage;
