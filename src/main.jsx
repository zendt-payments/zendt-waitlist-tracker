import React from "react";
import { createRoot } from "react-dom/client";
import ZendtWaitlistTracker from "./ZendtWaitlistTracker.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ZendtWaitlistTracker />
  </React.StrictMode>
);
