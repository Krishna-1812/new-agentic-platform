import { Routes, Route, Navigate } from 'react-router-dom';
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
import ContentEnhancementPage from './pages/ContentEnhancementPage';
import LocationPageBuilderPage from './pages/LocationPageBuilderPage';
import LocationPageDetailPage from './pages/LocationPageDetailPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/content-research" element={<ContentResearchPage />} />
      <Route path="/keyword-research" element={<KeywordResearchPage />} />
      <Route path="/kb" element={<KnowledgeBasePage />} />
      <Route path="/kb/new" element={<CreateKBPage />} />
      <Route path="/kb/audit" element={<ModuleAuditPage />} />
      <Route path="/kb/feedback/new" element={<ClientFeedbackPage />} />
      <Route path="/kb/:id" element={<KBEditorPage />} />
      <Route path="/article-recommendation" element={<ArticleRecommendationPage />} />
      <Route path="/image-alt-audit" element={<ImageAltAuditPage />} />
      <Route path="/team-insights" element={<TeamInsightsPage />} />
      <Route path="/agent-readiness-audit" element={<AgentReadinessAuditPage />} />
      <Route path="/agent-readiness-audit/summary" element={<AgentReadinessSummaryPage />} />
      <Route path="/seo-geo-audit" element={<SeoGeoAuditPage />} />
      <Route path="/content-enhancement" element={<ContentEnhancementPage />} />
      <Route path="/location-page-builder" element={<LocationPageBuilderPage />} />
      <Route path="/location-page-builder/:id" element={<LocationPageDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
