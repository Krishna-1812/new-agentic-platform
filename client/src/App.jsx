import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ContentResearchPage from './pages/ContentResearchPage';
import KeywordResearchPage from './pages/KeywordResearchPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/content-research" element={<ContentResearchPage />} />
      <Route path="/keyword-research" element={<KeywordResearchPage />} />
    </Routes>
  );
}
