import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/user/HomePage";
import { AdminPage } from "./pages/admin/AdminPage";
import "./index.css";

function App() {
  return (
    <Router>
      <Routes>
        {/* User Routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/reports" element={<HomePage />} />
        <Route path="/matches" element={<HomePage />} />
        <Route path="/collection-points" element={<HomePage />} />

        {/* Admin Routes */}
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/*" element={<AdminPage />} />
      </Routes>
    </Router>
  );
}

export default App;
