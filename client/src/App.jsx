import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import ContentResearchPage from './pages/ContentResearchPage';
import KeywordResearchPage from './pages/KeywordResearchPage';
import KnowledgeBasePage from './pages/KnowledgeBasePage';
import KBEditorPage from './pages/KBEditorPage';
import CreateKBPage from './pages/CreateKBPage';
import ModuleAuditPage from './pages/ModuleAuditPage';
import ClientFeedbackPage from './pages/ClientFeedbackPage';
import ArticleRecommendationPage from './pages/ArticleRecommendationPage';
import ImageAltAuditPage from './pages/ImageAltAuditPage';
import TeamInsightsPage from './pages/TeamInsightsPage';
import AgentReadinessAuditPage from './pages/AgentReadinessAuditPage';
import AgentReadinessSummaryPage from './pages/AgentReadinessSummaryPage';
import SeoGeoAuditPage from './pages/SeoGeoAuditPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      <Route path="/content-research" element={<ProtectedRoute><ContentResearchPage /></ProtectedRoute>} />
      <Route path="/keyword-research" element={<ProtectedRoute><KeywordResearchPage /></ProtectedRoute>} />
      <Route path="/kb" element={<ProtectedRoute><KnowledgeBasePage /></ProtectedRoute>} />
      <Route path="/kb/new" element={<ProtectedRoute><CreateKBPage /></ProtectedRoute>} />
      <Route path="/kb/audit" element={<ProtectedRoute><ModuleAuditPage /></ProtectedRoute>} />
      <Route path="/kb/feedback/new" element={<ProtectedRoute><ClientFeedbackPage /></ProtectedRoute>} />
      <Route path="/kb/:id" element={<ProtectedRoute><KBEditorPage /></ProtectedRoute>} />
      <Route path="/article-recommendation" element={<ProtectedRoute><ArticleRecommendationPage /></ProtectedRoute>} />
      <Route path="/image-alt-audit" element={<ProtectedRoute><ImageAltAuditPage /></ProtectedRoute>} />
      <Route path="/team-insights" element={<ProtectedRoute><TeamInsightsPage /></ProtectedRoute>} />
      <Route path="/agent-readiness-audit" element={<ProtectedRoute><AgentReadinessAuditPage /></ProtectedRoute>} />
      <Route path="/agent-readiness-audit/summary" element={<AgentReadinessSummaryPage />} />
      <Route path="/seo-geo-audit" element={<ProtectedRoute><SeoGeoAuditPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
