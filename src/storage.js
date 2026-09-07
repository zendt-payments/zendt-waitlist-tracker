import { initializeApp } from "firebase/app";
import { doc, getDoc, getFirestore, onSnapshot, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyC6a-wFXp_3Qp8uwa0DG365aFp88_bphDQ",
  authDomain: "zendt-app.firebaseapp.com",
  projectId: "zendt-app",
  storageBucket: "zendt-app.firebasestorage.app",
  messagingSenderId: "163534692435",
  appId: "1:163534692435:android:19e1b4773cc2db4dd6a6a6",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const refFor = (key) => doc(db, "waitlist", key);

const storage = {
  async get(key) {
    const snap = await getDoc(refFor(key));
    return { value: snap.exists() ? snap.data().value ?? null : null };
  },
  async set(key, value) {
    await setDoc(refFor(key), { value, updatedAt: Date.now() });
    return true;
  },
  subscribe(key, onValue, onError) {
    return onSnapshot(
      refFor(key),
      (snap) => {
        onValue(snap.exists() ? snap.data().value ?? null : null);
      },
      onError
    );
  },
};

export default storage;
