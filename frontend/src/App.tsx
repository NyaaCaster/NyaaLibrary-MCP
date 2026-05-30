import { Navigate, Route, Routes } from "react-router-dom";
import { isAuthenticated } from "./lib/auth";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { KnowledgeBasesPage } from "./pages/KnowledgeBasesPage";
import { KbDetailPage } from "./pages/KbDetailPage";
import { EmbeddingSettingsPage } from "./pages/EmbeddingSettingsPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<KnowledgeBasesPage />} />
        <Route path="/kb/:id" element={<KbDetailPage />} />
        <Route path="/embedding" element={<EmbeddingSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
